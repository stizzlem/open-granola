# Fable 5 Build Prompt — "OpenGranola" (free local Granola clone for macOS)

> Paste everything below the line into Fable 5 as the task prompt. Recommended: `effort: xhigh`.
> It is written as a self-contained spec: goal, architecture, constraints, build order, and acceptance tests.

---

## Context (the why)

I'm building a **free, fully-local, private alternative to Granola.ai** for my own use on my Mac. Granola is an AI meeting notepad: it captures meeting audio from the device (no bot joins the call), transcribes it, lets me jot sparse notes during the meeting, and after the meeting merges my rough notes with the transcript into clean, structured notes using an LLM. I want the same core loop but running **100% on my machine with no subscription and no cloud calls** — audio, transcription, and the AI "enhance" step all local. This is a personal tool, so favor a working end-to-end loop over polish or configurability.

## What "done" looks like (core user loop to replicate)

1. I open the app and click **Start** (or it auto-detects a meeting from my calendar — calendar is a stretch goal, not required for v1).
2. It captures **both my microphone and system audio** (so it hears me *and* the other people on Zoom/Meet/Teams) and transcribes live, on-device, into a running transcript panel.
3. While it records, I type **sparse notes** in an editor panel (just fragments — "pricing concern", "follow up re: contract").
4. I click **Stop**, then **Enhance**.
5. **Enhance** sends my sparse notes + the full transcript to a **local LLM** and produces clean, structured meeting notes: a summary, key decisions, action items (with owners if mentioned), and my note fragments expanded with supporting quotes from the transcript. My original typed notes stay visible/distinguishable from the AI-generated content.
6. Notes are saved locally (one meeting = one record), searchable, and I can pick a **template** (1:1, standup, sales call, customer discovery, generic) that changes the structure of the enhanced output.
7. **Chat against the transcript — both during and after the meeting.** While recording is still running, I can ask questions against the transcript captured *so far* ("what number did they just quote?", "summarize the last 5 minutes") and get an answer from the local LLM without stopping the recording. The same chat works after the meeting against the full saved transcript. This live in-meeting Q&A is a required feature, not a stretch goal — it's one of the things I most want.

## Hard constraints

- **macOS, Apple Silicon.** Assume an M-series Mac.
- **Everything local and free.** No paid APIs, no cloud LLM, no telemetry. If a dependency needs a one-time free download (a model file, Homebrew formula), that's fine — script it.
- **Privacy-first:** audio and transcripts never leave the machine. Notes stored in a local SQLite DB (or plain files) under the app's data dir.
- Use a stack you can actually stand up end-to-end. Recommended (but choose what you can make work reliably):
  - **App shell:** Electron + React + TypeScript (recommended — more example code exists for the whisper.cpp + ScreenCaptureKit combo, which lowers build risk), or a Tauri app (lighter, Rust backend). Pick one and commit to it.
  - **Transcription:** `whisper.cpp` (Metal/CoreML build, `base.en` or `small.en` model) for fast on-device speech-to-text. Stream audio to it in chunks for near-live transcript.
  - **Audio capture:** system audio + mic via macOS **ScreenCaptureKit** (this needs the Screen Recording permission) mixed with the default input device. A small native/Swift or CoreAudio helper is acceptable; if that's too heavy for v1, a documented fallback is capturing via an aggregate device or `ffmpeg` with an audio loopback — but state clearly what you chose and its setup steps.
  - **Local LLM for Enhance + Chat:** **Ollama** running a small instruct model (e.g. `llama3.1:8b` or `qwen2.5:7b`). Call its local HTTP API at `http://localhost:11434`. Detect if Ollama isn't installed/running and show a clear setup message.

## Build order (do these in sequence, verify each before moving on)

1. **Scaffold** the chosen app shell with two-panel layout: left = live transcript, right = my notes editor. Wire Start/Stop/Enhance buttons and a meeting list sidebar. Get it launching.
2. **Transcription pipeline first, with a file.** Before touching live audio, prove whisper.cpp works: transcribe a sample `.wav` and render the text. This de-risks the hardest dependency early.
3. **Live audio capture.** Add mic capture, verify live transcript. Then add system-audio (ScreenCaptureKit) and mix the two streams. Handle the Screen Recording / microphone permission prompts and document how to grant them.
4. **Persistence.** Save each meeting (title, timestamp, transcript, my notes, enhanced notes) to local storage. Sidebar lists past meetings; clicking one loads it.
5. **Enhance.** Build the Ollama call: a prompt that takes {template, my sparse notes, full transcript} and returns structured Markdown notes. Render enhanced notes with my original typed notes kept visually distinct (Granola shows user notes in black, AI in gray — do something equivalent).
6. **Templates.** Ship 5 templates (1:1, standup, sales call, customer discovery, generic) as prompt variations controlling output structure.
7. **Transcript chat (during + after).** A chat box that answers questions against the transcript via Ollama. Wire it to work **while recording is live** against the transcript-so-far (don't block or stop capture to answer), and against the full saved transcript after the meeting. Same box, same code path — the only difference is whether recording is still active. This is required.
8. **Stretch (only if 1–7 are solid):** calendar detection (macOS Calendar / .ics) to auto-title meetings and prompt to start; follow-up email draft generator.

## Working agreements for you (the builder)

- When you have enough information to act, act. Don't re-litigate the stack choice or narrate options you won't pursue — pick the approach most likely to run end-to-end on this Mac and go. If a genuine fork appears (e.g. ScreenCaptureKit helper turns out to need heavy native code), give me a one-line recommendation and proceed with the reversible default rather than stopping.
- Do the simplest thing that works. This is a personal v1 — no feature flags, no plugin systems, no abstraction for hypothetical future backends. One transcription engine, one LLM backend, hardcoded local paths are fine.
- **Verify each stage against real behavior, not just that it compiles.** Actually run whisper.cpp on a sample file and show the transcript; actually hit the Ollama endpoint and show a response. Before reporting a stage done, point to the command output that proves it. If something isn't working yet, say so plainly with the error — don't claim progress you can't show.
- Permissions and native audio on macOS are the riskiest part. If system-audio capture via ScreenCaptureKit blocks you after a couple of real attempts, fall back to a documented simpler capture path and note the limitation rather than burning the whole build on it.
- Pause for me only when you genuinely need something I alone can provide (e.g. "grant Screen Recording permission in System Settings, then tell me when done") — ask, then end the turn. Otherwise keep building.
- Provide, at the end: a **README** with exact setup steps (install Homebrew deps, download the whisper model, `ollama pull <model>`, grant permissions, run the app) and a note on what's implemented vs stretch/not-done. Open your final summary with what actually runs today.

## Acceptance test (how I'll judge it)

Play a 2-minute sample conversation through my speakers while typing three note fragments. **Mid-playback (recording still running), ask the chat a question about something already said and get a correct answer without stopping capture.** Then click Stop → Enhance. I should get: a live transcript that captured both sides, structured enhanced notes reflecting my fragments plus transcript quotes, the record saved and reloadable from the sidebar, and the chat still answering questions about the audio after the meeting — all with no network calls to any external service.
