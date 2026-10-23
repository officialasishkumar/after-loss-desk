// Records the beats of the video as 1080p clips: Playwright drives the running site through each beat while Chrome's
// screencast captures every painted frame with its timestamp; ffmpeg turns each beat into a constant 30 fps clip.
// The story beat also writes story.json: when each chapter began, so the voice lines can sit on the right moment.
//
//   PLAYWRIGHT_NODE_MODULES=<dir with node_modules/playwright> node video/record_beats.mjs --base http://127.0.0.1:8300 --out <dir> [--only story,desk]
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const BASE = (args.base || "http://127.0.0.1:8300").replace(/\/$/, "");
const OUT = path.resolve(args.out || "beats");
const ONLY = args.only ? args.only.split(",") : null;
const require = createRequire(path.join(process.env.PLAYWRIGHT_NODE_MODULES || ".", "x.js"));
const { chromium } = require("playwright");
fs.mkdirSync(OUT, { recursive: true });
const wait = (page, ms) => page.waitForTimeout(ms);

// a smooth, visible cursor, so viewers see what is clicked and held
const CURSOR = `(() => {
  const c = document.createElement("div"); c.id = "rec-cursor";
  Object.assign(c.style, { position: "fixed", left: "0", top: "0", width: "22px", height: "22px", marginLeft: "-11px", marginTop: "-11px", borderRadius: "50%", background: "rgba(47,107,255,0.22)", boxShadow: "0 0 0 2px rgba(47,107,255,0.9), 0 4px 14px rgba(20,26,51,0.35)", zIndex: "2147483647", pointerEvents: "none", transition: "transform 0.12s ease" });
  document.addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
  document.addEventListener("mousedown", () => { c.style.transform = "scale(0.7)"; }, true);
  document.addEventListener("mouseup", () => { c.style.transform = "scale(1)"; }, true);
  const add = () => document.body && !document.getElementById("rec-cursor") && document.body.append(c);
  add(); document.addEventListener("DOMContentLoaded", add);
})();`;
let mouse = { x: 720, y: 405 };
async function glide(page, x, y, ms = 600) {
  const steps = Math.max(8, Math.round(ms / 16)); const from = { ...mouse };
  for (let i = 1; i <= steps; i += 1) { const s = i / steps, e = s * s * (3 - 2 * s); await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e); await wait(page, ms / steps); }
  mouse = { x, y };
}
async function clickOn(page, locator, { hold = 0 } = {}) {
  const box = await locator.first().boundingBox(); if (!box) throw new Error(`nothing to click: ${locator}`);
  await glide(page, box.x + box.width / 2, box.y + box.height / 2); await wait(page, 150);
  await page.mouse.down(); await wait(page, hold || 90); await page.mouse.up();
}
const tokens = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "site", "tokens.css"), "utf8");
// title, problem and end cards: the site's own tokens and font, drawn by the browser
const CARD = (body, extra = "") => `<!doctype html><html><head><meta charset="utf-8"><style>${tokens}
html,body{margin:0;height:100%;font-family:var(--font-sans);color:var(--ink);background:var(--bg)}
.card{position:absolute;inset:0;background:var(--screen-bg);overflow:hidden;display:flex;flex-direction:column;justify-content:center;padding:0 120px}
.amb{position:absolute;inset:-25%;filter:blur(70px);opacity:.9;pointer-events:none}.amb i{position:absolute;border-radius:50%;width:60%;height:60%}
.amb i:nth-child(1){background:var(--blob-1);left:-8%;top:-12%;animation:d1 18s ease-in-out infinite alternate}.amb i:nth-child(2){background:var(--blob-2);right:-12%;top:18%;animation:d2 22s ease-in-out infinite alternate}.amb i:nth-child(3){background:var(--blob-3);left:28%;bottom:-24%;animation:d3 20s ease-in-out infinite alternate}
@keyframes d1{to{transform:translate(12%,10%) scale(1.15)}}@keyframes d2{to{transform:translate(-10%,14%) scale(1.1)}}@keyframes d3{to{transform:translate(-14%,-10%) scale(1.2)}}
.in{position:relative;opacity:0;transform:translateY(18px);animation:rise .9s cubic-bezier(.2,.8,.2,1) forwards}
h1{font-size:92px;font-weight:800;letter-spacing:-.04em;line-height:1;margin:0 0 22px}h2{font-size:40px;font-weight:600;letter-spacing:-.02em;margin:0;color:var(--ink-2);max-width:22ch;line-height:1.2}
.kick{font-size:22px;font-weight:700;color:var(--sim);margin:0 0 26px}
.ring{display:inline-flex;align-items:center;gap:16px;margin-bottom:30px}.ring i{width:30px;height:30px;border-radius:50%;border:5px solid var(--alexa)}.ring span{font-size:26px;font-weight:700;color:var(--ink)}
.stats{display:flex;gap:70px;margin-top:40px}.stats div{opacity:0;animation:rise .9s cubic-bezier(.2,.8,.2,1) forwards}.stats b{display:block;font-size:110px;font-weight:800;letter-spacing:-.05em;line-height:1;background:linear-gradient(135deg,var(--alexa),var(--alexa-2));-webkit-background-clip:text;background-clip:text;color:transparent}.stats span{display:block;font-size:24px;color:var(--ink-2);margin-top:10px;max-width:14ch}.stats small{display:block;font-size:17px;color:var(--ink-3);margin-top:6px}
.bar{position:absolute;left:0;right:0;bottom:0;height:12px;background:rgba(20,26,51,.12)}.bar i{display:block;height:100%;width:40%;margin:0 auto;background:linear-gradient(90deg,transparent,var(--alexa-2),var(--alexa),var(--alexa-2),transparent);animation:br 2.4s ease-in-out infinite}@keyframes br{50%{opacity:.4}}
@keyframes rise{to{opacity:1;transform:none}}
.gates{display:flex;gap:18px;margin-top:40px}.gates div{flex:1;background:var(--glass);border-radius:22px;padding:22px 22px;opacity:0;animation:rise .8s cubic-bezier(.2,.8,.2,1) forwards}.gates b{display:block;color:var(--needs);font-size:34px;font-weight:800}.gates span{display:block;font-size:20px;color:var(--ink-2);margin-top:6px;line-height:1.25}
.url{font-size:26px;color:var(--ink-2);margin-top:34px;font-weight:600}.url b{color:var(--alexa)}
.lines{margin-top:34px;display:grid;gap:10px;font-size:26px;color:var(--ink-2)}.lines b{color:var(--ink);font-weight:700}
${extra}</style></head><body><div class="card"><div class="amb"><i></i><i></i><i></i></div>${body}<div class="bar"><i></i></div></div></body></html>`;
const TITLE = CARD(`<div class="in"><div class="ring"><i></i><span>Alexa+ add-on</span></div><h1>After Loss Desk</h1><h2>The executor's desk on the Echo: who to tell, by when, with what. It asks only at five gates.</h2></div>`);
const PROBLEM = CARD(`<div class="in"><p class="kick">After a death in the family</p><h2 style="max-width:30ch;color:var(--ink)">The person left in charge tells banks, pensions, insurers, utilities, credit bureaus and Social Security, chases replies, and buys certified copies again and again.</h2></div>
  <div class="stats"><div style="animation-delay:.5s"><b>3.1M</b><span>deaths a year in the US</span><small>CDC, 2025</small></div><div style="animation-delay:.9s"><b>500 h</b><span>of paperwork per executor</span><small>Empathy, 2026</small></div><div style="animation-delay:1.3s"><b>18 mo</b><span>to wind an estate down</span><small>Empathy, 2026</small></div></div>`);
const GATES = CARD(`<div class="in"><p class="kick">Decided in code, before every action</p><h1 style="font-size:72px">Five gates, and nothing else.</h1><h2>Everything else is clerical and runs on one standing authorisation, receipted.</h2></div>
  <div class="gates"><div style="animation-delay:.4s"><b>D1</b><span>money leaves the estate</span></div><div style="animation-delay:.6s"><b>D2</b><span>an original leaves her hands</span></div><div style="animation-delay:.8s"><b>D3</b><span>her signature or a visit</span></div><div style="animation-delay:1s"><b>D4</b><span>anything irreversible</span></div><div style="animation-delay:1.2s"><b>D5</b><span>an heir objects</span></div></div>`);
const END = CARD(`<div class="in"><div class="ring"><i></i><span>Build, Ship, Shape: Amazon Developer Hackathon 2026, Alexa+ track</span></div><h1>After Loss Desk</h1><h2>The executor decides. The desk does the rest.</h2>
  <div class="lines"><div><b>MCP server</b>, spec 2025-11-25, Streamable HTTP, eight tools, one intent each</div><div><b>MCP App card</b>, Alexa+ checkout endpoints with idempotency, an Agent Skill</div><div><b>Simulated Alexa+ client</b>, labelled as such; nothing private is ever spoken</div></div>
  <p class="url">github.com/<b>officialasishkumar/after-loss-desk</b></p></div>`);

let caseId = null;
const storyTimes = {};
const BEATS = {
  title: { prep: async (p) => { await p.setContent(TITLE); await p.evaluate(() => document.fonts.ready); }, act: async (p) => { await wait(p, 7000); } },
  problem: { prep: async (p) => { await p.setContent(PROBLEM); await p.evaluate(() => document.fonts.ready); }, act: async (p) => { await wait(p, 9000); } },
  // the Echo before a case: the first screen and the ghost hub
  open: {
    prep: async (p) => { await p.goto(`${BASE}/?v=rec#echo`); await wait(p, 2500); },
    act: async (p) => { await wait(p, 1500); await glide(p, 1060, 420, 900); await wait(p, 1500); await glide(p, 300, 640, 900); await wait(p, 2500); },
  },
  // the first week, live: the story button, then the gate handed over and held to approve
  story: {
    prep: async (p) => {
      await p.goto(`${BASE}/?v=rec#echo`); await wait(p, 1500);
      await p.evaluate(() => document.getElementById("mute").click());
      await wait(p, 600);
    },
    act: async (p) => {
      const t0 = Date.now();
      await clickOn(p, p.locator("#play-inline"));
      const seen = new Set();
      for (let i = 0; i < 1200; i += 1) {
        const st = await p.evaluate(() => { const cap = document.getElementById("caption-text").textContent; const h1 = document.getElementById("card").querySelector("h1")?.textContent || ""; const day = document.getElementById("day-sub").textContent;
          const ch = /^Order/.test(cap) ? "order" : /^Yes/.test(cap) ? "allow" : /open/.test(h1) && cap.length > 100 ? "list" : cap.length > 3 ? "tell" : "";
          return { ch, week: /14/.test(document.getElementById("odo").textContent.replace(/\D/g, "").slice(-2)) || document.body.dataset.state === "gate", confirm: !document.getElementById("alexa-confirm").hidden, handoff: !document.getElementById("handoff").hidden }; });
        for (const k of [st.ch, st.confirm ? "confirm" : null, st.week && seen.has("confirm") ? "week" : null, st.handoff ? "handoff" : null]) if (k && !seen.has(k)) { seen.add(k); storyTimes[k] = (Date.now() - t0) / 1000; }
        if (st.handoff) break;
        await wait(p, 100);
      }
      caseId = new URL(p.url()).searchParams.get("case");
      await wait(p, 2600);
      const hold = p.locator("#handoff .hold");
      await clickOn(p, hold, { hold: 1500 });
      storyTimes.approved = (Date.now() - t0) / 1000;
      await wait(p, 4200);
    },
  },
  desk: {
    prep: async (p) => { await p.goto(`${BASE}/?case=${caseId}&v=rec#desk`); await wait(p, 2200); },
    act: async (p) => {
      await wait(p, 1500);
      const second = p.locator("#desk-queue button[data-i='1']");
      if (await second.isVisible().catch(() => false)) { await clickOn(p, second); await wait(p, 2600); }
      const more = p.locator(".dossier details.more summary").first();
      if (await more.isVisible().catch(() => false)) { await clickOn(p, more); await wait(p, 2200); }
      const hold = p.locator(".dossier .hold").first();
      await hold.scrollIntoViewIfNeeded(); await wait(p, 500);
      await clickOn(p, hold, { hold: 1500 });
      await wait(p, 3200);
      const decline = p.locator("#desk-decline");
      if (await decline.isVisible().catch(() => false)) { await clickOn(p, decline); await wait(p, 1200); const r = p.locator("button[data-reason='i_will_do_it_myself']"); if (await r.isVisible().catch(() => false)) { await clickOn(p, r); await wait(p, 3000); } }
    },
  },
  record: {
    prep: async (p) => { await p.goto(`${BASE}/?case=${caseId}&v=rec#record`); await wait(p, 3500); },
    act: async (p) => {
      await wait(p, 1200); await clickOn(p, p.locator("#verify")); await wait(p, 3200);
      await glide(p, 700, 520, 900); await wait(p, 1500);
      await clickOn(p, p.locator("#rec-filter button[data-f='gate']")); await wait(p, 1500);
      await p.mouse.wheel(0, 420); await wait(p, 1800);
      const row = p.locator("#receipts li.r").first(); if (await row.isVisible().catch(() => false)) { const b = await row.boundingBox(); await glide(p, b.x + 300, b.y + b.height / 2, 700); }
      await wait(p, 2200);
    },
  },
  gates: { prep: async (p) => { await p.setContent(GATES); await p.evaluate(() => document.fonts.ready); }, act: async (p) => { await wait(p, 8000); } },
  how: {
    prep: async (p) => { await p.goto(`${BASE}/?case=${caseId}&v=rec#how`); await wait(p, 2000); },
    act: async (p) => {
      await wait(p, 1500);
      const arch = p.locator("svg.arch"); await arch.scrollIntoViewIfNeeded(); await wait(p, 2600);
      const run = p.locator("#run-sim"); await run.scrollIntoViewIfNeeded(); await wait(p, 600);
      await clickOn(p, run); await wait(p, 5500);
      await glide(p, 760, 480, 900); await wait(p, 2600);
    },
  },
  end: { prep: async (p) => { await p.setContent(END); await p.evaluate(() => document.fonts.ready); }, act: async (p) => { await wait(p, 9000); } },
};

const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
for (const name of ONLY || Object.keys(BEATS)) {
  const beat = BEATS[name]; if (!beat) { console.error(`FAILED ${name}: no such beat`); process.exitCode = 1; continue; }
  if (["desk", "record", "how"].includes(name) && !caseId) { const saved = fs.existsSync(path.join(OUT, "story.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "story.json"), "utf8")).caseId : null; caseId = saved; if (!caseId) { console.error(`FAILED ${name}: no case; record the story first`); process.exitCode = 1; continue; } }
  // the UI drawn at 1440x810 and scaled to 1080p: a third larger on screen, still sharp
  const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3, colorScheme: "light", reducedMotion: "no-preference" });
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(`[${name}] page error: ${e.message}`));
  try {
    await beat.prep(page);
    await page.mouse.move(mouse.x, mouse.y);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `beat-${name}-`));
    const cdp = await context.newCDPSession(page);
    const frames = []; let live = true;
    cdp.on("Page.screencastFrame", async (f) => {
      if (!live) return;
      const file = path.join(dir, `${String(frames.length).padStart(5, "0")}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, "base64")); frames.push({ file, ts: f.metadata.timestamp });
      await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    const started = Date.now() / 1000;
    await beat.act(page);
    const ended = Date.now() / 1000;
    live = false; await cdp.send("Page.stopScreencast"); await wait(page, 200);
    const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, (frames[i + 1]?.ts ?? ended) - f.ts).toFixed(4)}`).join("\n");
    fs.writeFileSync(path.join(dir, "list.txt"), `${list}\nfile '${frames.at(-1).file}'\n`);
    const out = path.join(OUT, `${name}.mp4`);
    spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"), "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "fast", "-crf", "16", out], { stdio: "inherit" });
    fs.rmSync(dir, { recursive: true, force: true });
    if (name === "story") fs.writeFileSync(path.join(OUT, "story.json"), JSON.stringify({ caseId, ...storyTimes }, null, 2));
    console.log(`ok ${name}: ${frames.length} frames, ${(ended - started).toFixed(1)} s -> ${out}`);
  } catch (e) { console.error(`FAILED ${name}: ${e.message.split("\n")[0]}`); process.exitCode = 1; }
  await context.close();
}
await browser.close();
