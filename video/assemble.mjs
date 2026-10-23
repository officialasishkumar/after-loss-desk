// Builds one cut of the video from a cut file (video/cuts/<name>.json): the shots in order with
// cross-fades, the voice-over lines at their times, burned-in subtitles drawn by the browser in
// Manrope, and the score ducked under the voice. Voice lines are WAVs made beforehand
// (video/tts_kokoro.py); every input lives in the media folder. Adapted from Tephra's assemble.mjs.
//
//   PLAYWRIGHT_NODE_MODULES=<dir> node video/assemble.mjs --cut video/cut.json --media <dir> --font <Manrope.ttf> --out <file.mp4> [--max 178] [--min 150]
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEDIA = path.resolve(args.media);
const cut = JSON.parse(fs.readFileSync(args.cut, "utf8"));
const OUT = path.resolve(args.out);
const FONT = path.resolve(args.font || path.join(ROOT, "site/fonts/Manrope.ttf"));
const require = createRequire(path.join(process.env.PLAYWRIGHT_NODE_MODULES || ".", "x.js"));

const run = (cmd, a) => {
  const r = spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${r.stderr?.slice(-2000)}`);
  return r.stdout;
};
const duration = (file) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim());
const src = (s) => path.join(MEDIA, s);

// 1. the voice lines' lengths first: each shot is stretched to hold its own lines
const GAP = 0.3, TAIL = 0.5, MAX_SLOW = 1.6;
const XF = cut.crossfade ?? 0.5;
const lens = new Map(cut.lines.map((l) => [l.id, duration(src(`voice/${cut.voice}/${l.id}.wav`))]));
const shotLen = (s, own) => {
  const clip = ((s.to ?? duration(src(s.src))) - (s.from ?? 0)) / (s.speed ?? 1);
  const needed = own.length ? (own[0].after ?? 0) + own.reduce((n, l) => n + lens.get(l.id) + GAP, 0) + TAIL : 0;
  return Math.max(clip, needed) + (s.pad ?? 0);
};
const planned = () => cut.shots.reduce((n, s, i) => n + shotLen(s, cut.lines.filter((l) => l.shot === i)), 0) - XF * (cut.shots.length - 1);
// --max: a cut that would run longer drops its optional shots, lowest priority first, with their lines
const MAX = Number(args.max || Infinity);
while (planned() > MAX) {
  const pick = cut.shots.map((s, i) => [s.optional, i]).filter(([o]) => o !== undefined).sort((x, y) => x[0] - y[0])[0];
  if (!pick) { console.warn(`planned ${planned().toFixed(1)} s is over --max ${MAX} with nothing optional left`); break; }
  const gone = pick[1];
  console.log(`dropping ${cut.shots[gone].src} to stay under ${MAX} s`);
  cut.shots.splice(gone, 1);
  cut.lines = cut.lines.filter((l) => l.shot !== gone).map((l) => ({ ...l, shot: l.shot > gone ? l.shot - 1 : l.shot }));
  cut.beds = (cut.beds ?? []).filter((x) => x.shot !== gone).map((x) => ({ ...x, shot: x.shot > gone ? x.shot - 1 : x.shot }));
}
// --min: a cut that would run shorter holds its last shot (the end card) for the difference
const MIN = Number(args.min || 0);
if (planned() < MIN) {
  const last = cut.shots.at(-1);
  last.pad = MIN - planned();
  console.log(`holding ${last.src} ${last.pad.toFixed(1)} s longer to reach ${MIN} s`);
}
const lines = cut.lines.map((l, i) => ({ ...l, wav: src(`voice/${cut.voice}/${l.id}.wav`), i, len: lens.get(l.id) }));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cut-"));
const parts = cut.shots.map((s, i) => {
  const file = src(s.src);
  const from = s.from ?? 0;
  const to = s.to ?? duration(file);
  const own = lines.filter((l) => l.shot === i);
  const needed = own.length ? (own[0].after ?? 0) + own.reduce((n, l) => n + l.len + GAP, 0) + TAIL : 0;
  const clip = (to - from) / (s.speed ?? 1);
  // slow the footage a little first; past that, hold the last frame
  const slow = Math.min(MAX_SLOW, Math.max(1, needed / clip));
  const len = Math.max(clip, needed) + (s.pad ?? 0);
  const hold = Math.max(0, len - clip * slow);
  const out = path.join(tmp, `shot-${String(i).padStart(2, "0")}.mp4`);
  const vf = `setpts=(PTS-STARTPTS)*${slow / (s.speed ?? 1)},fps=30,scale=1920:1080:flags=lanczos,format=yuv420p,tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}`;
  run("ffmpeg", ["-y", "-v", "error", "-ss", String(from), "-to", String(to), "-i", file, "-vf", vf, "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "14", out]);
  return { out, len };
});
let filter = "";
let last = "[0:v]";
let offset = parts[0].len;
for (let i = 1; i < parts.length; i += 1) {
  offset -= XF;
  const label = i === parts.length - 1 ? "[v]" : `[x${i}]`;
  filter += `${last}[${i}:v]xfade=transition=fade:duration=${XF}:offset=${offset.toFixed(3)}${label};`;
  last = label;
  offset += parts[i].len;
}
const total = offset;
const joined = path.join(tmp, "joined.mp4");
run("ffmpeg", ["-y", "-v", "error", ...parts.flatMap((p) => ["-i", p.out]), "-filter_complex", filter.replace(/;$/, "") || "[0:v]copy[v]", "-map", "[v]", "-c:v", "libx264", "-preset", "fast", "-crf", "14", joined]);

// 2. each line at its shot's start plus "after", and never before the previous line has ended
const starts = [];
parts.reduce((at, p, i) => { starts[i] = at; return at + p.len - XF; }, 0);
let free = 0;
for (const l of lines) {
  l.at = Math.max(starts[l.shot] + (l.after ?? 0), free);
  free = l.at + l.len + GAP;
}
if (free > total) console.warn(`the voice runs ${(free - total).toFixed(1)} s past the picture`);
// beds: voices that may overlap and carry no subtitles (the news anchors), each with its gain
const beds = (cut.beds ?? []).map((b) => ({ ...b, at: starts[b.shot] + (b.after ?? 0), wav: src(`voice/${b.voice}/${b.id}.wav`) }));

// 3. subtitles: one transparent PNG per line, drawn by the browser
const { chromium } = require("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const fontUrl = `data:font/ttf;base64,${fs.readFileSync(FONT).toString("base64")}`;
for (const l of lines.filter((l) => cut.shots[l.shot].captions !== true)) {
  await page.setContent(`<style>@font-face{font-family:P;src:url(${fontUrl})}html,body{margin:0;background:transparent}
    p{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);max-width:1300px;margin:0;padding:10px 22px;border-radius:12px;
    background:rgba(20,26,51,.84);color:#ffffff;font:600 34px/1.32 P,sans-serif;text-align:center;letter-spacing:-.005em}</style><p></p>`);
  await page.$eval("p", (el, t) => { el.textContent = t; }, l.sub ?? l.text);
  l.png = path.join(tmp, `sub-${l.i}.png`);
  await page.screenshot({ path: l.png, omitBackground: true });
}
// a shot's badge (unused here, kept for parity)
const badges = [];
for (const [i, s] of cut.shots.entries()) {
  if (!s.badge) continue;
  await page.setContent(`<style>@font-face{font-family:P;src:url(${fontUrl})}html,body{margin:0;background:transparent}
    p{position:absolute;right:96px;top:150px;margin:0;padding:9px 18px 9px 14px;border-radius:999px;background:rgba(8,12,18,.86);
    border:1.5px solid transparent;background-clip:padding-box;color:#f4f7fa;font:500 22px/1 P,sans-serif;display:flex;align-items:center;gap:10px;
    box-shadow:0 0 0 1.5px #7f7ff5,0 8px 30px rgba(0,0,0,.5)}
    i{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,#4f8cff,#9b72f2,#d96570)}
    b{background:linear-gradient(90deg,#7aa7ff,#b49bff);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:600}</style><p><i></i><b>Gemini</b><span></span></p>`);
  await page.$eval("span", (el, t) => { el.textContent = t; }, s.badge);
  const png = path.join(tmp, `badge-${i}.png`);
  await page.screenshot({ path: png, omitBackground: true });
  badges.push({ png, from: starts[i] + 0.3, to: starts[i] + parts[i].len - 0.3 });
}
await browser.close();

// 4. picture + subtitles + voice + ducked score -> the cut
const blank = path.join(tmp, "blank.png");
run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black@0.0:s=1920x1080,format=rgba", "-frames:v", "1", blank]);
const inputs = ["-i", joined, ...badges.flatMap((b) => ["-i", b.png]), ...lines.flatMap((l) => ["-i", l.png ?? blank]), ...lines.flatMap((l) => ["-i", l.wav]), "-i", src(cut.music.src), ...beds.flatMap((b) => ["-i", b.wav])];
const n = lines.length;
const B = badges.length;
let fc = "";
let v = "[0:v]";
badges.forEach((b, i) => {
  fc += `${v}[${1 + i}:v]overlay=0:0:enable='between(t,${b.from.toFixed(2)},${b.to.toFixed(2)})'[g${i}];`;
  v = `[g${i}]`;
});
// a shot that carries its own captions (the openings) gets no subtitles; its input is still read
lines.forEach((l, i) => {
  const o = i === n - 1 ? "[vout]" : `[s${i}]`;
  const on = l.png ? `between(t,${l.at.toFixed(2)},${(l.at + l.len + 0.25).toFixed(2)})` : "0";
  fc += `${v}[${1 + B + i}:v]overlay=0:0:enable='${on}'${o};`;
  v = o;
});
lines.forEach((l, i) => { fc += `[${1 + B + n + i}:a]aresample=48000,adelay=${Math.round(l.at * 1000)}|${Math.round(l.at * 1000)},apad[a${i}];`; });
beds.forEach((b, i) => { fc += `[${2 + B + 2 * n + i}:a]aresample=48000,volume=${b.gain ?? -6}dB,adelay=${Math.round(b.at * 1000)}|${Math.round(b.at * 1000)},apad[b${i}];`; });
fc += `${lines.map((_, i) => `[a${i}]`).join("")}${beds.map((_, i) => `[b${i}]`).join("")}amix=inputs=${n + beds.length}:normalize=0:duration=longest,atrim=0:${total.toFixed(2)},asplit[voice][key];`;
fc += `[${1 + B + 2 * n}:a]aresample=48000,atrim=0:${total.toFixed(2)},volume=${cut.music.gain ?? -14}dB[mus];`;
fc += "[mus][key]sidechaincompress=threshold=0.02:ratio=8:attack=60:release=600[ducked];";
fc += "[voice][ducked]amix=inputs=2:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=11[aout]";
run("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", fc, "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", total.toFixed(2), OUT]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${OUT}: ${total.toFixed(1)} s, ${parts.length} shots, ${n} lines`);
