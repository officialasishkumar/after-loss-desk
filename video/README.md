# Video

The three-minute video opens with `intro/`, a three.js scene rendered frame by frame (`render_intro.mjs`; every frame is
`renderAt(t)` of the time alone, so a render is the same every time): an Echo on a table, the letters raining into a pile,
the pile lifting into a ring of institutions, five amber gates, then the camera pushing into the screen. The rest is the
running site: Playwright drives each beat while Chrome's screencast records it (`record_beats.mjs`), Kokoro speaks the
narration (`tts_kokoro.py`, `lines.json`), and ffmpeg assembles the shots, the voice and a ducked music bed
(`assemble.mjs`). Subtitles are not burned in: the assembler writes an `.srt` beside the video, and the release MP4 carries
it as a soft track a player can switch on. The story beat records when each chapter began, so the lines about the first
week land on the moment they describe.

```bash
uv run afterloss serve                                             # the site, on :8300
PW=<dir whose node_modules has playwright>
PLAYWRIGHT_NODE_MODULES=$PW node video/render_intro.mjs --out <media>/intro.mp4       # the 3D opening, 32 s
PLAYWRIGHT_NODE_MODULES=$PW node video/record_beats.mjs --base http://127.0.0.1:8300 --out <media>/beats
python3 video/make_cut.py <media>/beats video/cut.json             # lines on their shots and chapter times
python3 video/tts_kokoro.py <lines for kokoro> <media>/voice       # [{"id","voice","text"}] per line, from lines.json
PLAYWRIGHT_NODE_MODULES=$PW node video/assemble.mjs --cut video/cut.json --media <media> --font <Manrope.ttf> --out after-loss-desk.mp4 --max 180
ffmpeg -i after-loss-desk.mp4 -i after-loss-desk.srt -c copy -c:s mov_text -metadata:s:s:0 language=eng final.mp4
```

Rendered media stays out of the repo. The music bed is a generated ambient pad; the subtitles are the narration lines.
