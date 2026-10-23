"""Writes the cut file from the recorded beats: one shot per beat in order, each voice line on its shot, and the story's
lines at the chapter times the recorder wrote to story.json.

    python3 video/make_cut.py <beats dir> <out cut.json> [--voice af_heart]
"""
import json
import sys
from pathlib import Path

beats = Path(sys.argv[1])
out = Path(sys.argv[2])
voice = sys.argv[sys.argv.index("--voice") + 1] if "--voice" in sys.argv else "af_heart"
ORDER = ["title", "problem", "open", "story", "desk", "record", "gates", "how", "end"]
lines = json.loads((Path(__file__).parent / "lines.json").read_text())
story = json.loads((beats / "story.json").read_text()) if (beats / "story.json").exists() else {}
# the week advances about ten seconds before the hand-off (the reply is spoken in between); the recorder's own guess is rough
if "handoff" in story:
    story["week"] = story["handoff"] - 10.0
shots = [{"src": f"beats/{name}.mp4", **({"captions": True} if name in ("title", "problem", "gates", "end") else {})} for name in ORDER]
cut_lines = []
for line in lines:
    i = ORDER.index(line["shot"])
    after = line.get("after", 0.0)
    if "at" in line:
        after = max(0.0, story.get(line["at"], 0.0) - 0.2)
    cut_lines.append({"id": line["id"], "shot": i, "after": round(after, 2), "text": line["text"], "sub": line.get("sub", line["text"])})
cut = {"title": "After Loss Desk, the three-minute video", "voice": voice, "music": {"src": "score-ambient.wav", "gain": -17}, "crossfade": 0.5, "shots": shots, "lines": cut_lines}
out.write_text(json.dumps(cut, indent=2))
print(f"wrote {out}: {len(shots)} shots, {len(cut_lines)} lines; story chapters at", {k: v for k, v in story.items() if k != "caseId"})
