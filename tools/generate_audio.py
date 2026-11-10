#!/usr/bin/env python3
"""Renders German speech clips with edge-tts (free Microsoft neural voices, no API key).

Usage: node tools/list_texts.js > /tmp/texts.json && python tools/generate_audio.py /tmp/texts.json
Clips are named by a hash of voice + text, so changed texts are the only ones re-rendered.
Only study content is sent to the speech service. Do not add personal data to content.js.
"""
import asyncio, hashlib, json, pathlib, sys
import edge_tts

VOICES = {"officer": "de-DE-KatjaNeural", "answer": "de-DE-ConradNeural"}
ROOT = pathlib.Path(__file__).resolve().parent.parent
AUDIO = ROOT / "audio"

async def render(item, sem, manifest):
    voice = VOICES[item["role"]]
    name = hashlib.sha1(f"{voice}|{item['text']}".encode()).hexdigest()[:12] + ".mp3"
    target = AUDIO / name
    manifest[f"{item['role']}|{item['text']}"] = f"audio/{name}"
    if target.exists() and target.stat().st_size > 0:
        return
    async with sem:
        for attempt in range(4):
            try:
                await edge_tts.Communicate(item["text"], voice).save(str(target))
                return
            except Exception as err:
                if attempt == 3:
                    raise
                print("retry", name, err, file=sys.stderr)
                await asyncio.sleep(2 * (attempt + 1))

async def main(path):
    AUDIO.mkdir(exist_ok=True)
    items = json.load(open(path, encoding="utf-8"))
    sem, manifest = asyncio.Semaphore(6), {}
    await asyncio.gather(*(render(i, sem, manifest) for i in items))
    used = set(pathlib.Path(v).name for v in manifest.values())
    for f in AUDIO.glob("*.mp3"):
        if f.name not in used:
            f.unlink()
    (ROOT / "audio-manifest.js").write_text(
        "window.AUDIO_MANIFEST = " + json.dumps(manifest, ensure_ascii=False, indent=0) + ";\n", encoding="utf-8")
    print(len(items), "clips,", sum(f.stat().st_size for f in AUDIO.glob("*.mp3")) // 1024, "KB")

asyncio.run(main(sys.argv[1]))
