# Khmer video dubber — Full Build Specification

## Project Summary
Build a production-ready, downloadable Windows desktop application (single `.exe` installer) that translates and dubs Chinese videos into Khmer, with a UI matching the reference layout: Video Preview, Subtitle Data Table, Timeline Editor, and Action Footer.

**End-user experience:** Download one `.exe` → run installer → double-click desktop icon → app launches with zero manual setup (no Python, Node, CUDA, or ffmpeg installation required by the user).

---

## 1. Architecture

```
Electron Frontend (Renderer)
   |
   |  WebSocket (ws://127.0.0.1:8765)
   |  - job commands + real-time progress events
   v
Python Backend (spawned as hidden child process / sidecar)
   - FastAPI + websockets server
   - Whisper (CUDA, auto-fallback to CPU)
   - Gemini API client (dual-pass translation + polish)
   - edge-tts (Khmer Male/Female voices)
   - Demucs (BGM/vocal isolation, local, htdemucs model)
   - yt-dlp (video download, watermark-free)
   - ffmpeg (static binary, audio/video muxing)
```

- Electron main process spawns the frozen Python backend on app launch, waits for a WebSocket health-check response, then shows the UI.
- On app quit, Electron explicitly kills the Python child process (avoid orphaned processes).
- All backend communication uses WebSocket (not REST) so long-running jobs (transcription, Demucs separation) can stream live progress (`{"stage": "transcribing", "progress": 42}`).

---

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Desktop shell | Electron |
| Frontend UI | React (or Vue) + WaveSurfer.js for timeline waveforms |
| Backend | Python (FastAPI + websockets) |
| Transcription | OpenAI Whisper — **Base model bundled**, **Large model downloaded on first use** — CUDA with automatic CPU fallback |
| Translation | Google Gemini API — user supplies their own API key (entered in Settings, stored locally, encrypted) — **dual-pass**: pass 1 translates Chinese→Khmer, pass 2 reviews/polishes for natural phrasing |
| TTS | `edge-tts` — Khmer Male/Female voice selection |
| BGM isolation | Demucs (htdemucs model), bundled locally, no cloud dependency |
| Video download | `yt-dlp` — solid support for TikTok/Douyin; RedNote (Xiaohongshu) is best-effort/may need custom extractor — always provide local-upload fallback |
| Video/audio muxing | ffmpeg static binary, bundled |
| Packaging | `electron-builder` (frontend) + `PyInstaller --onedir` (backend), backend bundled into Electron's `resources/` folder |
| Installer | Windows NSIS installer via electron-builder, **unsigned** (SmartScreen warning accepted for now — signing can be added later) |
| Project persistence | Custom `.dubify` project file format (see Section 5) |

---

## 3. Core Workflow / Pipeline

1. **Input Stage** — user pastes a video URL (TikTok/Douyin/RedNote) OR uploads a local video file.
   - URL path: yt-dlp downloads clean, watermark-free video, saves to project's `media/` folder.
   - Local path: file copied into project's `media/` folder.
2. **Confirmation popup**: "Do you want to dub this video?" → Yes → video loads into the Dubber workspace.
3. **Audio extraction** via ffmpeg.
4. **Transcription**: Whisper (CUDA, fallback CPU) transcribes Chinese speech → text + precise timestamps.
5. **Translation**:
   - Pass A: Gemini API translates Chinese transcript → Khmer.
   - Pass B: Second Gemini call reviews/polishes the Khmer script for natural phrasing before showing the user.
6. **BGM isolation**: Demucs splits original audio into vocals (discarded) + background music track.
7. **UI Review & Edit**: user reviews video, subtitle table, and timeline; edits Khmer text, timestamps, and voice per row.
8. **TTS generation**: edge-tts converts finalized Khmer text blocks into audio (Male/Female per row), mapped to timeline.
9. **Export**: ffmpeg combines new Khmer audio + isolated BGM + (optional) burned-in subtitles into final output video.
10. **Save/Load Project**: user can save the full project state (`.dubify` file) and resume editing later without redoing transcription/translation/TTS.

---

## 4. UI/UX Requirements

Match the reference layout exactly — four main panels:

### Video Preview Panel (Left)
- Standard playback controls, volume control, aspect ratio switching.

### Subtitle Data Table (Top Right)
- Columns: `START`, `END`, `KHMER TEXT (EDITABLE)`, `VOICE` (dropdown: Male/Female), `AUDIO STATUS` (e.g. Ready/Generating/Not generated).
- Row double-click enables direct inline editing.
- Toolbar: Add Text, Edit, Delete, Find & Replace, Scan Characters.

### Timeline Editor (Bottom Center/Right)
- Three synced tracks: `TEXT` (Khmer subtitle blocks), `AUDIO` (generated TTS waveforms via WaveSurfer.js), `BGM` (isolated background music waveform).
- Zoom/Fit controls, playhead synced to video preview.
- Language selector, "Translate" and "Generate Audio" action buttons above the timeline.

### Action Footer
- Buttons: Add to Batch, Batch Processing, Load BGM, Isolate BGM, Import SRT, Export SRT, **Export Video** (prominent/primary).

### Settings Panel
- Gemini API key input field (required before first translation call).

---

## 5. Project File Format (`.dubify`)

A zipped project bundle (folder structure before zipping):

```
MyVideo.dubify/
├── project.json
│   {
│     "source": {"type": "url" | "local", "original_path": "..."},
│     "video_path": "media/source.mp4",
│     "subtitles": [
│       {
│         "id": 1,
│         "start": "01:05.10",
│         "end": "01:07.02",
│         "khmer_text": "...",
│         "voice": "male",
│         "audio_status": "ready",
│         "audio_path": "audio/seg_001.wav"
│       }
│     ],
│     "bgm_path": "media/bgm_isolated.wav",
│     "last_modified": "ISO8601 timestamp"
│   }
├── media/     # source video, isolated BGM
├── audio/     # generated TTS segments
└── exports/   # final rendered output(s)
```

Electron registers `.dubify` as a file association during install so users can double-click to reopen a project.

---

## 6. Folder Structure

```
dubify-ai-pro/
├── electron/                    # Main process, preload script, window management,
│                                 #   Python child-process spawn/kill logic
├── src/                          # React/Vue renderer (all UI components)
│   ├── components/
│   │   ├── VideoPreview/
│   │   ├── SubtitleTable/
│   │   ├── TimelineEditor/
│   │   └── Settings/
│   └── App.jsx
├── python-backend/
│   ├── main.py                   # FastAPI + WebSocket server entrypoint
│   ├── modules/
│   │   ├── downloader.py         # yt-dlp wrapper (TikTok/Douyin/RedNote)
│   │   ├── transcriber.py        # Whisper (CUDA/CPU fallback, Base/Large only)
│   │   ├── translator.py         # Gemini dual-pass translate + polish
│   │   ├── tts.py                # edge-tts Khmer voice generation
│   │   ├── bgm_isolator.py       # Demucs vocal/BGM separation
│   │   ├── project_manager.py    # .dubify save/load
│   │   └── exporter.py           # ffmpeg mux (video + TTS audio + BGM + subs)
│   └── dubify_backend.spec       # PyInstaller build spec
├── build/                        # electron-builder.yml, installer icons, NSIS config
└── package.json
```

---

## 7. Packaging & Distribution Requirements

- **Python backend**: freeze with `PyInstaller --onedir` (faster startup than `--onefile`), output placed in Electron's `resources/` directory.
- **Whisper models**: Base model bundled inside the installer; Large model downloaded on first use with a clear progress UI (do not bundle Large by default — keeps base installer size manageable).
- **CUDA**: do NOT bundle CUDA runtime. Detect via `torch.cuda.is_available()` at runtime; fall back to CPU automatically and silently.
- **ffmpeg**: bundle a static Windows binary directly — zero user setup.
- **Demucs**: bundle model weights locally as part of the backend freeze.
- **Final output**: `electron-builder` produces a single Windows installer, e.g. `Dubify-AI-Pro-Setup-1.0.0.exe` (NSIS installer, unsigned for now).
- **File association**: register `.dubify` extension to reopen projects on double-click.

---

## 8. Build Order (Recommended Milestones)

1. Electron shell + WebSocket handshake with a minimal "hello world" Python backend (prove the plumbing works end-to-end).
2. Local file upload → Whisper transcription → display results in the Subtitle Data Table.
3. Gemini dual-pass translation wired into the pipeline.
4. edge-tts generation + waveform display on the Timeline Editor's AUDIO track.
5. Demucs BGM isolation + final ffmpeg export/mux.
6. yt-dlp URL import (TikTok/Douyin first, RedNote best-effort with fallback).
7. `.dubify` project save/load.
8. PyInstaller + electron-builder packaging into the final installer.

---

## 9. Known Risk Areas to Flag During Build

- **RedNote (Xiaohongshu) downloads**: yt-dlp support is less mature than TikTok/Douyin — implement graceful failure with a clear "please upload the video file manually" fallback message.
- **Installer size**: Base Whisper model + ffmpeg + Demucs weights will likely put the base installer in the 500MB–1GB range; Large Whisper model add-on should be a separate on-demand download, not bundled.
- **Unsigned installer**: users will see the Windows SmartScreen "Windows protected your PC" warning on first run — this is expected and accepted for the current phase; code-signing can be added later without architecture changes.
- **GPU detection**: must be robust — test both the CUDA-available and CUDA-unavailable code paths, since most end-user machines will not have a compatible GPU.