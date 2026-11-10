# Vorsprache

A free practice app for the **naturalisation (Einbürgerung) appointment in Berlin**. At the appointment the caseworker talks with you briefly about the free democratic basic order, Germany's history and the leaflets you received. This app helps you prepare in German, with English help next to every sentence.

- **Test**: 33 multiple-choice questions in the style of the Einbürgerungstest, or training by topic.
- **Open questions**: type your answer in German and compare it with a model answer and key ideas.
- **Written interview**: the appointment as a chat, step by step.
- **Audio interview**: the caseworker speaks with a natural German voice and you answer out loud.
- **Listening** (local version only): the app records your answer, writes down what it heard and marks words that were hard to understand.

Every text is available in German, English or both. Your progress is saved in your browser only.

> **Not official.** This project is not connected to the Landesamt für Einwanderung, BAMF or any authority. It is not legal advice. Laws, office-holders and procedures change: check your own invitation letter and official sources. The test questions are original practice questions; the official catalogue is at [oet.bamf.de](https://oet.bamf.de/ords/oetut/f?p=514:1:0).

## Use it online

Open the GitHub Pages site for this repository. Everything works there except listening, because the speech analysis needs your own computer.

## Run it on your computer

This adds listening and pronunciation feedback. Your voice is analysed on your computer and never uploaded.

You need [Python 3.10 or newer](https://www.python.org/downloads/), about 5 GB of free disk space and 8 GB of RAM or more. Download this repository (green **Code** button, then **Download ZIP**) and unzip it.

| System | Start |
| --- | --- |
| macOS | Double-click `start-mac.command`. If macOS blocks it, right-click it, choose **Open**, then **Open** again. |
| Linux | Run `./start-linux.sh` in a terminal. |
| Windows | Double-click `start-windows.bat`. (Not yet tested; please report problems.) |

The first start installs the speech libraries (about 1 GB) and downloads two speech models (about 3 GB). Later starts are offline. The app opens at http://localhost:4173. Keep the terminal window open while you practise; closing it stops the app.

Use a current Chrome, Edge, Firefox or Safari and allow the microphone when asked.

## Privacy

This project collects nothing. There is no account, no cookies, no analytics, no tracking and no advertising.

| | What happens |
| --- | --- |
| Online page | The page loads only files from its own site. A Content Security Policy blocks requests to anyone else, and fonts are included instead of loaded from a font service. GitHub hosts the page and, like any web host, sees your IP address when it is loaded ([GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)). |
| Progress and appointment date | Stored only in your browser (`localStorage`). Clear the site data in your browser to delete it. |
| German voices | Pre-recorded audio files in `audio/`. No speech service is called while you use the app. If a sentence has no recording, your browser reads it with a voice installed on your device; online browser voices are skipped. |
| Microphone (local version) | Recorded in your browser and sent only to the server on your own computer (`127.0.0.1`). It is analysed in memory and never saved or uploaded. The server refuses connections from other computers and other websites. |
| Speech models (local version) | Downloaded once from Hugging Face, at a fixed version, with telemetry switched off. After that the app loads them from disk without any network request. |
| Claude feedback (optional, local version) | **Off by default.** If you have [Claude Code](https://claude.com/claude-code) installed and tick the box in the audio interview, the recognised *text* of your answer (never the recording) is sent to Anthropic through your own Claude account for feedback on content and grammar. Do not tick it if you don't want that. |

Nothing in the repository contains personal data. If you contribute, keep it that way: `content.js` is sent to a speech service when the voices are regenerated.

## How it works

Plain HTML and JavaScript with no build step and no dependencies in the browser.

| Path | What it holds |
| --- | --- |
| `index.html` | Page and styles |
| `content.js` | All questions, the interview script and translations |
| `engine.js` | Voice, interviewer and microphone interfaces |
| `app.js` | Screens and interaction |
| `audio/`, `audio-manifest.js` | Pre-rendered German speech |
| `fonts/` | Barlow Semi Condensed and IBM Plex (SIL Open Font License) |
| `server/` | Local server for listening: Flask, speech analysis, optional feedback |
| `tools/` | Regenerates the voice clips after content changes |

The local version uses two speech models:

| Model | What it does |
| --- | --- |
| [Whisper large-v3-turbo](https://huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo) via [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Works out what you said. The question's vocabulary is given as a hint so accents are understood better. |
| [wav2vec2 German](https://huggingface.co/oliverguhr/wav2vec2-large-xlsr-53-german-cv9) | Listens more literally and scores how clearly each word matched its letters. |

Pronunciation scores are an automatic estimate. In tests with synthetic voices, native German voices scored 0.95 to 0.98 and foreign-accented voices 0.66 to 0.86. An accent is no problem at the appointment as long as you can be understood.

### Regenerate the voices

After editing `content.js`, render new clips with [edge-tts](https://github.com/rany2/edge-tts) (Microsoft Edge's online neural voices Katja and Conrad, no API key). Only the study texts are sent.

    pip install edge-tts
    node tools/list_texts.js > texts.json
    python tools/generate_audio.py texts.json

### Ideas

To let the interviewer ask follow-up questions, replace `ScriptedInterviewer` in `engine.js` with one whose `next(lastAnswer)` generates the next turn. The screens stay the same.

## Licence

Code and content: [MIT](LICENSE). Fonts: SIL Open Font License 1.1. The speech models have their own licences; see their model pages.
