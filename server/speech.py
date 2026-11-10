"""Local speech analysis. Audio is processed in memory on this computer and never stored or uploaded.

Whisper works out what was said. It tends to tidy up accents, so a second, more literal German
model (wav2vec2) then checks how well each word's sound matches its letters.
"""
import io
import math
import re
import threading

import numpy as np

WHISPER_MODEL = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
WHISPER_REVISION = "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"
PRON_MODEL = "oliverguhr/wav2vec2-large-xlsr-53-german-cv9"
PRON_REVISION = "4a28243fe4705396df59e0409613f9a89c4be7b3"
SAMPLE_RATE = 16000
BEAM_SIZE = 3

# Phrases Whisper is known to invent on noise, from the subtitles it was trained on.
HALLUCINATIONS = re.compile(r"untertitel|copyright wdr|vielen dank fürs zuschauen|bis zum nächsten mal", re.I)

status = {"whisper": "loading", "pronunciation": "loading", "error": None}
_whisper = None
_processor = None
_ctc = None
_vocab = None
_blank = 0
_lock = threading.Lock()


def _cached_first(load):
    try:
        return load(True)
    except Exception:  # Not downloaded yet: fetch the pinned version once from Hugging Face.
        return load(False)


def load_models():
    global _whisper, _processor, _ctc, _vocab, _blank
    try:
        from faster_whisper import WhisperModel
        # Use the copy on disk when there is one, so later starts make no network request at all.
        _whisper = _cached_first(lambda local: WhisperModel(
            WHISPER_MODEL, device="cpu", compute_type="int8", revision=WHISPER_REVISION, local_files_only=local))
        status["whisper"] = "ready"

        import torch
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
        _processor = _cached_first(lambda local: Wav2Vec2Processor.from_pretrained(
            PRON_MODEL, revision=PRON_REVISION, local_files_only=local))
        _ctc = _cached_first(lambda local: Wav2Vec2ForCTC.from_pretrained(
            PRON_MODEL, revision=PRON_REVISION, use_safetensors=True, local_files_only=local)).eval()
        _vocab = _processor.tokenizer.get_vocab()
        _blank = _processor.tokenizer.pad_token_id
        torch.set_num_threads(4)
        status["pronunciation"] = "ready"
    except Exception as err:  # Reported through /api/health so the page can explain it.
        status["error"] = str(err)
        for key in ("whisper", "pronunciation"):
            if status[key] == "loading":
                status[key] = "failed"


def decode(data: bytes) -> np.ndarray:
    from faster_whisper import decode_audio
    return decode_audio(io.BytesIO(data), sampling_rate=SAMPLE_RATE)


def transcribe(audio: np.ndarray, context: str = None, vad: bool = True):
    # The question's vocabulary helps Whisper recognise intended words through an accent.
    # score_words then judges how they actually sounded, so this does not hide pronunciation.
    segments, _ = _whisper.transcribe(
        audio, language="de", beam_size=BEAM_SIZE, word_timestamps=True, vad_filter=vad,
        condition_on_previous_text=False, initial_prompt=(context or "")[-600:] or None,
        # An accent lowers Whisper's confidence, and by default it then drops whole sentences.
        # The voice filter above already removes silence, so keep everything it passes on.
        no_speech_threshold=None, log_prob_threshold=None, compression_ratio_threshold=None,
    )
    words = []
    for seg in segments:
        if HALLUCINATIONS.search(seg.text):
            continue
        words += [{"word": w.word.strip().lstrip("-"), "start": w.start, "end": w.end} for w in seg.words or []]
    return words


def _clean(word: str) -> str:
    return re.sub(r"[^a-zäöüß]", "", word.lower())


def _align(log_probs: np.ndarray, tokens: list) -> list:
    """CTC forced alignment. Returns (first_frame, last_frame) for each token."""
    frames, n = log_probs.shape[0], len(tokens)
    trellis = np.full((frames + 1, n + 1), -np.inf)
    trellis[0, 0] = 0
    moved = np.zeros((frames + 1, n + 1), dtype=np.int8)  # 0 stay on blank, 1 next token, 2 repeat token
    for t in range(frames):
        blank = log_probs[t, _blank]
        trellis[t + 1, 0] = trellis[t, 0] + blank
        for j in range(1, n + 1):
            lp = log_probs[t, tokens[j - 1]]
            options = (trellis[t, j] + blank, trellis[t, j - 1] + lp, trellis[t, j] + lp)
            best = int(np.argmax(options))
            trellis[t + 1, j] = options[best]
            moved[t + 1, j] = best
    spans = [[None, None] for _ in tokens]
    j = n
    for t in range(frames, 0, -1):
        if j == 0:
            break
        step = moved[t, j]
        if step in (1, 2):
            spans[j - 1][0] = t - 1
            if spans[j - 1][1] is None:
                spans[j - 1][1] = t - 1
        if step == 1:
            j -= 1
    return spans


def frame_scores(audio: np.ndarray) -> np.ndarray:
    import torch
    with _lock, torch.no_grad():
        inputs = _processor(audio, sampling_rate=SAMPLE_RATE, return_tensors="pt", padding=True)
        logits = _ctc(inputs.input_values, attention_mask=inputs.get("attention_mask")).logits[0]
        return torch.log_softmax(logits, dim=-1).numpy()


def score_words(log_probs: np.ndarray, words: list) -> list:
    """Adds `score` (0 to 1) and `weak` (positions of doubtful letters) to each word."""
    scorable = [w for w in words if len(_clean(w["word"])) >= 2 and not w["word"].strip(".,!?").isupper()]
    tokens, owner = [], []
    for i, w in enumerate(scorable):
        for ch in _clean(w["word"]):
            if ch in _vocab:
                tokens.append(_vocab[ch])
                owner.append((i, ch))
    if not tokens or len(tokens) >= log_probs.shape[0]:
        return words

    spans = _align(log_probs, tokens)
    letters = [[] for _ in scorable]
    for (i, ch), (first, last), tok in zip(owner, spans, tokens):
        if first is None:
            letters[i].append((ch, 0.0))
            continue
        # How close the expected letter comes to the model's own favourite sound in those frames.
        frames = log_probs[first:last + 1]
        gap = float(np.mean(frames[:, tok] - frames.max(axis=1)))
        letters[i].append((ch, math.exp(gap)))
    for w, chars in zip(scorable, letters):
        if chars:
            w["score"] = round(float(np.mean([c[1] for c in chars])), 3)
            w["weak"] = [i for i, c in enumerate(chars) if c[1] < 0.35]
            # Short words are swallowed in fast speech, even by native speakers, so they need a lower score.
            w["unclear"] = w["score"] < (0.7 if len(chars) >= 5 else 0.3)
    return words


def literal(log_probs: np.ndarray) -> str:
    """What the literal model hears, without any tidying up."""
    return _processor.decode(log_probs.argmax(axis=-1))


def _letters(text: str) -> int:
    return len(re.findall(r"[a-zäöüß]", text.lower()))


def clarity(words: list) -> dict:
    """Overall band. Native test voices scored 0.95 to 0.98, accented ones 0.66 to 0.86."""
    scores = [w["score"] for w in words if "score" in w]
    if not scores:
        return {"score": None, "band": None}
    mean = float(np.mean(scores))
    band = "very_clear" if mean >= 0.92 else "clear" if mean >= 0.84 else "accented" if mean >= 0.72 else "hard"
    return {"score": round(mean, 2), "band": band}


def analyze(data: bytes, reference: str = None, context: str = None) -> dict:
    try:
        audio = decode(data)
    except Exception:  # A recording stopped straight away holds no decodable audio.
        return {"text": "", "words": [], "seconds": 0}
    seconds = len(audio) / SAMPLE_RATE
    if len(audio) < SAMPLE_RATE // 4:
        return {"text": "", "words": [], "seconds": round(seconds, 1)}
    if reference:
        # Repeating a known sentence: score against that sentence, so missing words show up.
        words = [{"word": w} for w in reference.split()]
    else:
        words = transcribe(audio, context)
        if not words:
            return {"text": "", "words": [], "seconds": round(seconds, 1)}
    log_probs = frame_scores(audio)
    heard = literal(log_probs)
    if not reference and _letters(" ".join(w["word"] for w in words)) < 0.7 * _letters(heard):
        # Whisper can skip the start of an accented answer. The literal model shows that happened.
        second_try = transcribe(audio, None, vad=False)
        if _letters(" ".join(w["word"] for w in second_try)) > _letters(" ".join(w["word"] for w in words)):
            words = second_try
    score_words(log_probs, words)
    result = {
        "text": " ".join(w["word"] for w in words),
        "words": words,
        "seconds": round(seconds, 1),
        "heard_literally": heard,
        "clarity": clarity(words),
        "maybe_incomplete": not reference and _letters(" ".join(w["word"] for w in words)) < 0.7 * _letters(heard),
    }
    if not reference and words:
        spoken = max(words[-1]["end"] - words[0]["start"], 0.1)
        result["words_per_minute"] = round(len(words) / spoken * 60)
        result["longest_pause"] = round(max(
            [b["start"] - a["end"] for a, b in zip(words, words[1:])] or [0]), 1)
    return result
