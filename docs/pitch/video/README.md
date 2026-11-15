# Video tooling

Builds the ≤2:00 submission film described in [../VIDEO.md](../VIDEO.md). Work files live in the main checkout's `scratch/video/` (gitignored).

- `tts_vo.py [voice] [speed]`: draft voice-over with Soniox TTS (EU endpoint, newest model), one WAV per clip plus `vo.json` with sentence-timed captions. Reads only `SONIOX_API_KEY` from `.env` inside the process; the value is never printed.
- `build_cut.py`: writes the HyperFrames root `scratch/video/draft/index.html` from `vo.json`, the deck stills (`deck.html?still#sN`) and any live clips in `draft/assets/clips/` (`A-words-live.mp4`, `B-buffet-live.mp4`); a missing clip falls back to its deck still.
- Render: `npx hyperframes render -o ../draft-cut.mp4` from `scratch/video/draft`, with FFmpeg on PATH.
- The voice is its own audio track per clip, so a re-recorded voice replaces `assets/vo/*.wav` and nothing else.
