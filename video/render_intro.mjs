// Renders video/intro frame by frame (each frame is renderAt(t), never wall-clock time) and
// encodes it with ffmpeg. Needs Playwright (PLAYWRIGHT_NODE_MODULES)
// and ffmpeg. Serves the repo root on a local port itself.
//
//   PLAYWRIGHT_NODE_MODULES=<dir> node video/render_intro.mjs --out <file.mp4> [--fps 30] [--size 1920x1080] [--still 12]
//     [--page video/real/index.html]   any page with window.renderAt(t) and window.introReady
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FPS = Number(args.fps || 30);
const [W, H] = (args.size || "1920x1080").split("x").map(Number);
const OUT = path.resolve(args.out || "intro.mp4");
if (!process.env.PLAYWRIGHT_NODE_MODULES) {
  console.error("set PLAYWRIGHT_NODE_MODULES to a folder whose node_modules has playwright");
  process.exit(2);
}
const require = createRequire(path.join(process.env.PLAYWRIGHT_NODE_MODULES, "x.js"));
const { chromium } = require("playwright");

const TYPES = { ".webm": "video/webm", ".mp4": "video/mp4", ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const type = TYPES[path.extname(file)] || "application/octet-stream";
  const size = fs.statSync(file).size;
  // byte ranges, so a page can seek a background video to an exact frame
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}/${(args.page || "video/intro/index.html").replace(/^\//, "")}`;

const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(`${base}${base.includes("?") ? "&" : "?"}record=1`, { waitUntil: "load" });
const duration = await page.evaluate(() => window.introReady);
await page.evaluate(() => document.fonts.ready);

if (args.still !== undefined) {
  await page.evaluate((t) => window.renderAt(t), Number(args.still));
  await page.screenshot({ path: OUT });
  console.log(`wrote ${OUT}`);
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "intro-frames-"));
  const frames = Math.round(duration * FPS);
  for (let f = 0; f < frames; f += 1) {
    await page.evaluate((t) => window.renderAt(t), f / FPS);
    await page.screenshot({ path: path.join(dir, `${String(f).padStart(5, "0")}.jpg`), type: "jpeg", quality: 94 });
    if (f % 150 === 0) console.log(`frame ${f}/${frames}`);
  }
  const ff = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "%05d.jpg"), "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT], { stdio: "inherit" });
  fs.rmSync(dir, { recursive: true, force: true });
  if (ff.status !== 0) process.exit(ff.status || 1);
  console.log(`wrote ${OUT} (${frames} frames at ${FPS} fps)`);
}
await browser.close();
server.close();
