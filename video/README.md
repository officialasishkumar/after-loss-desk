# Video

The three-minute video is built from the running site, the same way Tephra's was: Playwright drives each beat while
Chrome's screencast records it (`record_beats.mjs`), Kokoro speaks the narration (`tts_kokoro.py`, `lines.json`), and
ffmpeg assembles the shots, the voice, burned-in subtitles in Manrope and a ducked music bed (`assemble.mjs`). The story
beat records when each chapter began, so the lines about the first week land on the moment they describe.

```bash
uv run afterloss serve                                             # the site, on :8300
PW=<dir whose node_modules has playwright>
PLAYWRIGHT_NODE_MODULES=$PW node video/record_beats.mjs --base http://127.0.0.1:8300 --out <media>/beats
python3 video/make_cut.py <media>/beats video/cut.json             # lines on their shots and chapter times
python3 video/tts_kokoro.py <lines for kokoro> <media>/voice       # [{"id","voice","text"}] per line, from lines.json
PLAYWRIGHT_NODE_MODULES=$PW node video/assemble.mjs --cut video/cut.json --media <media> --font <Manrope.ttf> --out after-loss-desk.mp4 --max 178
```

Rendered media stays out of the repo. The music bed is a generated ambient pad; the subtitles are the narration lines.
