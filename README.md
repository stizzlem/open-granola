# 🥣 OpenGranola

A free, fully-local, private alternative to [Granola.ai](https://granola.ai) for macOS (Apple Silicon).
Captures your mic **and** system audio (so it hears both sides of a Zoom/Meet/Teams call — no bot joins),
transcribes live on-device with whisper.cpp, lets you jot sparse notes during the meeting, then merges
your notes with the transcript into clean structured notes using a local LLM via Ollama.

**Nothing ever leaves your machine.** No accounts, no telemetry, no cloud calls.

## What's implemented

- ✅ Live transcription of **mic + system audio** (ScreenCaptureKit + AVAudioEngine → whisper.cpp `base.en`, Metal-accelerated, ~8s chunks)
- ✅ **Me/Them speaker labels** — mic and system audio are transcribed as separate streams, so your lines are tagged **Me** and the other side **Them** (with echo cancellation so speaker output doesn't bleed into "Me")
- ✅ Sparse notes editor alongside the live transcript
- ✅ **Enhance**: your notes + transcript → structured Markdown notes via Ollama (`llama3.1:8b`), with AI content visually distinct from your own notes
- ✅ 5 templates: Generic, 1:1, Standup, Sales call, Customer discovery
- ✅ **Chat with the transcript — during the meeting** (against the transcript-so-far, without stopping capture) **and after**
- ✅ Local persistence (one JSON file per meeting in `~/Library/Application Support/open-granola/meetings/`), sidebar with full-text search
- ✅ Graceful fallback to mic-only capture if Screen Recording permission is missing
- ✅ Packaged **OpenGranola.app** (installed in /Applications — double-click, no terminal needed)
- ✅ **Meeting detection** — watches for any app starting to use the microphone (Zoom, browser tabs, Teams…) and offers "meeting starting — start recording?" via banner + notification
- ✅ **Obsidian sync** — every meeting auto-exports as a Markdown note (frontmatter, your notes, enhanced notes, Q&A, Me/Them transcript) into a vault folder you pick (🔮 button in the sidebar)
- ✅ Delete asks for confirmation and moves files to the **Trash** (recoverable), including the Obsidian export
- ❌ Not done (stretch): calendar auto-detection, follow-up email drafts

## Setup (one time)

```bash
# 1. Dependencies (Homebrew)
brew install whisper-cpp ffmpeg node ollama

# 2. Local LLM
ollama serve &            # or just open the Ollama menu-bar app
ollama pull llama3.1

# 3. This app
cd granola-local
npm install

# 4. Whisper model (~148 MB, one-time download)
curl -L -o models/ggml-base.en.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"

# 5. Build the native audio helper (needs Xcode or Command Line Tools)
npm run build:native
```

### Permissions (macOS will ask, or grant manually)

For the installed **OpenGranola.app**, permissions belong to OpenGranola itself:

- **Microphone** — macOS prompts on your first recording; accept it.
- **Screen Recording** (needed for *system* audio via ScreenCaptureKit) — System Settings →
  Privacy & Security → Screen & System Audio Recording → enable **OpenGranola**, then quit and reopen the app.

If you run from the terminal with `npm start` instead, macOS attributes both permissions to your
**terminal app** (Terminal/iTerm/etc.) — grant them there.

If Screen Recording isn't granted, the app tells you and falls back to **mic-only** automatically.

## Run

Double-click **OpenGranola** in /Applications (first launch of an unsigned app may need
right-click → Open). Or run from source:

```bash
npm start
```

After changing code, rebuild the installed app with:

```bash
npm run package && ditto release/OpenGranola-darwin-arm64/OpenGranola.app /Applications/OpenGranola.app
```

## Use

1. **● Start** — begins capturing mic + system audio; transcript streams into the left panel.
2. Type fragments in **My notes** ("pricing concern", "follow up re: contract") while it records.
3. Ask the **chat box** (bottom-left) questions mid-meeting — "what price did they just quote?" —
   it answers from the transcript-so-far without interrupting capture.
4. **■ Stop**, pick a **template**, then **✨ Enhance** — structured notes (summary, decisions,
   action items with owners, your fragments expanded with supporting quotes) appear under your notes,
   in gray with an accent rule so AI content stays distinct from what you typed.
5. Everything autosaves; find past meetings in the sidebar (search covers titles, notes, and transcripts).

## Test it without a real meeting

```bash
samples/make_sample.sh        # generates a 2-min two-voice fake sales call (macOS `say`)
afplay samples/sample.wav     # play it through your speakers while recording in the app
```

## Architecture

```
Electron (React/TS UI)
 ├─ native/audiocap (Swift): AVAudioEngine mic (echo-cancelled) + ScreenCaptureKit system audio
 │    → interleaved 16 kHz stereo PCM on stdout (L = me, R = them)
 ├─ main process: 8s chunks, each channel transcribed separately by whisper-cli (Metal)
 │    → transcript segments tagged me/them → UI + JSON store
 └─ Ollama @ localhost:11434 (llama3.1:8b): Enhance + transcript chat (sees Me:/Them: labels)
```

Meetings live in `~/Library/Application Support/open-granola/meetings/*.json` — plain JSON,
trivially greppable/backupable (📁 Data folder button in the sidebar opens it). Audio is never
written to disk (only 8-second temp chunks during transcription, deleted immediately).

Obsidian export target is stored in `~/Library/Application Support/open-granola/settings.json`;
meeting detection polls CoreAudio process objects every 2s (the same signal as the orange mic dot).
