"""Speaks a batch of voice-over lines with Kokoro-82M (run on the machine with the model).

python tts_kokoro.py lines.json out/   # lines.json: [{"id", "voice", "text"}]
"""

import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline

SR = 24_000
SPEED = 0.96
PAUSE = np.zeros(int(0.12 * SR), dtype=np.float32)

lines = json.loads(Path(sys.argv[1]).read_text())
out = Path(sys.argv[2])
pipes: dict[str, KPipeline] = {}
for line in lines:
    lang = line["voice"][0]
    pipe = pipes.setdefault(lang, KPipeline(lang_code=lang, device="cpu"))
    audio = np.concatenate(
        [
            np.asarray(a, dtype=np.float32)
            for _, _, a in pipe(line["text"], voice=line["voice"], speed=SPEED)
        ]
    )
    target = out / line["voice"] / f"{line['id']}.wav"
    target.parent.mkdir(parents=True, exist_ok=True)
    sf.write(target, np.concatenate([PAUSE, audio, PAUSE]), SR)
    print(line["id"], round(len(audio) / SR, 2))
