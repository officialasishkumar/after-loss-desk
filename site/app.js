// The simulated Alexa+ client. A real MCP client over Streamable HTTP (initialize, tools/list, tools/call; JSON responses,
// stateless) with four pages: the Echo (what the person hears and sees, and a guided story that drives the real server), the
// Desk (a queue of gates and a dossier to check, then hold to approve), the Record (every receipt, as a chain) and How it
// works. The only pretence is the routing of what you type to a tool: a handful of rules standing in for Alexa+'s understanding.
const MCP = "/mcp";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const state = { devState: "idle", caseId: new URLSearchParams(location.search).get("case"), lastDecision: null, muted: false, rpc: 0, init: false, view: "echo", story: [], deskIndex: 0, snapshot: null, voice: Promise.resolve(), sayToken: 0, playing: false, prevStatus: {}, filter: "all", day: null };
const TELL = "My husband died last week. There is a will. He had a bank account, a pension, life insurance, the power bill, a gym and a car.";
const GATE_WORD = { D0: "your say-so to start", D1: "money leaves the estate", D2: "an original leaves your hands", D3: "your signature or a visit", D4: "cannot be undone", D5: "an heir objects" };
const GATE_SHORT = { D0: "START", D1: "MONEY", D2: "ORIGINAL", D3: "SIGNATURE", D4: "IRREVERSIBLE", D5: "OBJECTION" };

// ---------- MCP client ----------
async function rpc(method, params) {
  const r = await fetch(MCP, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++state.rpc, method, params }) });
  const text = await r.text();
  const msg = (r.headers.get("content-type") || "").includes("text/event-stream") ? JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5)) : JSON.parse(text);
  if (msg.error) throw new Error(msg.error.message || JSON.stringify(msg.error));
  return msg.result;
}
async function ensureInit() {
  if (state.init) return;
  try {
    const init = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "after-loss-desk-web", version: "0.3.0" } });
    await fetch(MCP, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    const tools = await rpc("tools/list", {});
    state.init = true;
    setConn("ok", "Connected"); $("conn").title = `${init.serverInfo.name}, MCP ${init.protocolVersion}`;
    story("agent", `initialize → ${init.serverInfo.name} (${init.protocolVersion}); ${tools.tools.length} tools`);
  } catch (e) { setConn("bad", "MCP unreachable"); throw e; }
}
function setConn(cls, text) { const c = $("conn"); c.className = "conn " + cls; c.querySelector("span").textContent = text; }
async function call(name, args) {
  await ensureInit();
  device("thinking");
  story("alexa", `tools/call <code>${esc(name)}</code> ${esc(JSON.stringify(args))}`);
  let res;
  try { res = await rpc("tools/call", { name, arguments: args }); } catch (e) { device("idle"); story("err", e.message); toast(e.message); throw e; }
  const out = res.structuredContent || JSON.parse(res.content.find((c) => c.type === "text").text);
  if (out.error) { device("idle"); story("err", out.error); say(out.error); return out; }
  if (out.case_id && out.case_id !== state.caseId) { state.caseId = out.case_id; history.replaceState(null, "", `?case=${out.case_id}${location.hash}`); }
  if (out.card?.kind === "due" && out.card.decisions.length) state.lastDecision = out.card.decisions[0].id;
  if (out.card?.kind === "ledger" && out.card.action?.decision_id) state.lastDecision = out.card.action.decision_id;
  renderCard(out); say(out.speak); await refresh();
  return out;
}

// ---------- device states, voice out, voice in ----------
function device(s) {
  state.devState = s;
  const gate = state.snapshot?.due.decisions.length ? "gate" : "idle";
  const v = s === "idle" ? gate : s;
  $("scene").dataset.state = v; document.body.dataset.state = v;
}
// Speaks the reply and lights each word as it is spoken (boundary events when the voice gives them, a timer otherwise).
// Returns a promise that resolves when the voice is done, which the story waits on.
function say(text) {
  const el = $("speak"); const mine = ++state.sayToken; el.classList.remove("done", "full");
  if (!text) { el.innerHTML = ""; device("idle"); return (state.voice = Promise.resolve()); }
  const words = text.split(/\s+/); const starts = []; let pos = 0;
  for (const w of words) { const i = text.indexOf(w, pos); starts.push(i); pos = i + w.length; }
  el.innerHTML = words.map((w) => `<span class="w">${esc(w)}</span>`).join(" ");
  const spans = el.querySelectorAll(".w"); let lit = 0;
  const light = (n) => { for (; lit < n && lit < spans.length; lit++) spans[lit].classList.add("on"); };
  const total = Math.min(9000, Math.max(1200, 62 * text.length));
  state.voice = new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; light(spans.length); el.classList.add("done"); if (state.sayToken === mine) device("idle"); resolve(); };
    const byTimer = () => { const t0 = performance.now(); (function tick() { if (done) return; const p = (performance.now() - t0) / total; light(Math.ceil(p * spans.length)); if (p >= 1) finish(); else requestAnimationFrame(tick); })(); };
    if (state.muted || !("speechSynthesis" in window)) { device("speaking"); byTimer(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.rate = 0.92; u.pitch = 1; const vc = pickVoice(); if (vc) { u.voice = vc; u.lang = vc.lang; } let boundaries = false;
    u.onstart = () => device("speaking");
    u.onboundary = (e) => { boundaries = true; const n = starts.findIndex((s) => s > e.charIndex); light(n === -1 ? spans.length : n); };
    u.onend = finish; u.onerror = finish;
    speechSynthesis.speak(u);
    setTimeout(() => { if (!boundaries && !done) { const t0 = performance.now(); (function tick() { if (done || boundaries) return; const p = (performance.now() - t0) / total; light(Math.ceil(p * spans.length)); if (p < 1) requestAnimationFrame(tick); })(); } }, 600);
    setTimeout(() => { if (!done) finish(); }, total + 5000);
  });
  return state.voice;
}
// Voices: the calmest the browser offers first (Chrome's Google voices, then the better system ones), or the one you picked.
const PREFERRED = ["Google UK English Female", "Google US English", "Samantha", "Karen", "Moira", "Tessa", "Daniel", "Google UK English Male"];
function voices() { return ("speechSynthesis" in window ? speechSynthesis.getVoices() : []).filter((v) => v.lang.startsWith("en") && !/Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Eddy|Flo|Fred|Good News|Grandma|Grandpa|Jester|Junior|Kathy|Organ|Ralph|Reed|Rocko|Sandy|Shelley|Superstar|Trinoids|Whisper|Wobble|Zarvox|Hysterical/.test(v.name)); }
function pickVoice() { const all = voices(); let want = null; try { want = localStorage.getItem("ald-voice"); } catch {} return all.find((v) => v.name === want) || PREFERRED.map((n) => all.find((v) => v.name === n)).find(Boolean) || all[0] || null; }
function fillVoices() { const sel = $("voice"); const all = voices(); if (!all.length) return; const cur = pickVoice(); sel.innerHTML = all.map((v) => `<option value="${esc(v.name)}" ${cur && v.name === cur.name ? "selected" : ""}>${esc(v.name.replace("Google ", "").replace(" English", ""))}</option>`).join(""); }
if ("speechSynthesis" in window) { fillVoices(); speechSynthesis.addEventListener("voiceschanged", fillVoices); }
$("voice").addEventListener("change", () => { try { localStorage.setItem("ald-voice", $("voice").value); } catch {} speechSynthesis.cancel(); say("This is how I will sound."); });
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Rec) { $("mic").disabled = true; $("mic").title = "Speech input needs Chrome"; }
else {
  $("mic").addEventListener("click", () => {
    const rec = new Rec(); rec.lang = "en-US"; rec.interimResults = false;
    $("mic").classList.add("on"); device("listening");
    rec.onresult = (e) => { $("utterance").value = e.results[0][0].transcript; $("ask").requestSubmit(); };
    rec.onend = () => { $("mic").classList.remove("on"); if (state.devState === "listening") device("idle"); };
    rec.onerror = () => { toast("Could not hear that."); };
    rec.start();
  });
}
$("speak").addEventListener("click", () => $("speak").classList.toggle("full")); $("speak").title = "Show the whole reply";
$("mute").addEventListener("click", () => { state.muted = !state.muted; $("mute").innerHTML = `${icon(state.muted ? "i-mute" : "i-sound")}<span>${state.muted ? "Spoken replies off" : "Spoken replies on"}</span>`; $("mute").setAttribute("aria-label", state.muted ? "Spoken replies off" : "Spoken replies on"); if (state.muted) speechSynthesis?.cancel(); });

// What you said, as a caption under the device. The story types it; typing it yourself shows it at once.
async function caption(text, typed) {
  const cap = $("caption"), el = $("caption-text"); cap.hidden = false; el.textContent = "";
  if (!typed || reduced) { el.textContent = text; return; }
  cap.classList.add("typing"); device("listening");
  for (let i = 1; i <= text.length; i++) { if (!state.playing) break; el.textContent = text.slice(0, i); await sleep(text[i - 1] === " " ? 38 : text[i - 1] === "." ? 260 : 22 + Math.random() * 18); }
  cap.classList.remove("typing"); await sleep(250);
}

// ---------- the log ----------
function story(who, html) {
  const when = state.snapshot?.today || "";
  state.story.unshift({ who, html, when });
  state.story = state.story.slice(0, 80);
  $("story").innerHTML = state.story.map((s) => `<li><span class="when">${esc(s.when)}</span><span><span class="who ${esc(s.who)}">${{ alexa: "Alexa+", exec: "You", inst: "Reply", agent: "Desk", err: "Error" }[s.who] || s.who}</span> <span class="${s.who === "err" ? "err" : ""}">${s.html}</span></span></li>`).join("");
  $("story-n").textContent = `${state.story.length} entries`;
}

// ---------- cards on the Echo ----------
function renderCard(out) {
  const c = out.card; const el = $("card"); el.classList.remove("card"); void el.offsetWidth; el.classList.add("card");
  if (!c) { el.innerHTML = `<p class="sub">${esc(out.speak || out.error)}</p>`; return; }
  const row = (l, r, cls = "") => `<div class="row"><span>${l}</span><b class="${cls}">${r ?? ""}</b></div>`;
  const days = (d) => d == null ? "" : d < 0 ? `<span class="late">${-d} d late</span>` : `${d} d`;
  const lab = (x) => x.label ? `<span class="lab-line">${esc(x.label)}</span>` : "";
  let h = `<h1>${esc(c.title)}</h1>`;
  if (c.kind === "ledger") {
    h += `<dl class="kv"><div><dt>State</dt><dd>${esc(c.state)}</dd></div><div><dt>Certified copies</dt><dd>${c.originals_needed} needed, ${c.originals_on_hand} on hand</dd></div></dl>`;
    h += c.rows.filter((r) => r.status !== "done").slice(0, 3).map((r) => row(esc(r.title) + lab(r), days(r.days_left))).join("");
    if (c.rows.length > 3) h += `<p class="fine">and ${c.rows.length - 3} more around the room.</p>`;
    if (c.action?.decision_id) h += `<button type="button" class="act" data-tool="approve" data-arg='${esc(JSON.stringify({ case_id: out.case_id, decision_id: c.action.decision_id }))}'>${icon("i-check")} ${esc(c.action.label)}</button><button type="button" class="act alt" data-tool="decline" data-arg='${esc(JSON.stringify({ case_id: out.case_id, decision_id: c.action.decision_id }))}'>Not now</button>`;
  } else if (c.kind === "due") {
    h += c.decisions.slice(0, 2).map((d) => `<div class="row"><span><span class="gate">${icon("i-diamond")}${esc(d.gate)}</span>${esc(d.summary)}</span></div>`).join("");
    if (c.decisions.length) h += `<button type="button" class="act" data-tool="approve" data-arg='${esc(JSON.stringify({ case_id: out.case_id, decision_id: c.decisions[0].id }))}'>${icon("i-check")} Approve</button><button type="button" class="act alt" data-go="desk">Check on the Desk ${icon("i-chev")}</button>`;
    if (c.decisions.length > 2) h += `<p class="fine">${c.decisions.length - 2} more on the Desk.</p>`;
    h += c.items.slice(0, 3).map((i) => row(esc(i.title) + lab(i), days(i.days_left))).join("");
    if (!c.decisions.length && !c.items.length) h += `<p class="sub">${c.waiting.length ? `Nothing due. Waiting on ${c.waiting.length} repl${c.waiting.length === 1 ? "y" : "ies"}.` : "Nothing due. Rest."}</p>`;
  } else if (c.kind === "draft") {
    h += `<p class="sub pair">${c.label ? `<span>${esc(c.label)}</span>` : ""}<span class="chip">${esc(c.channel)}</span></p><pre>${esc(c.text)}</pre><p class="fine">Facts filled by code: ${esc(c.facts.join(", ") || "none")}</p>`;
  } else if (c.kind === "quote") {
    h += row(`${c.count} × $${Number(c.unit_price).toFixed(2)} + $${Number(c.processing).toFixed(2)} processing`, `$${Number(c.total).toFixed(2)}`) + `<p class="fine">${esc(c.fee_note)}</p>`;
    if (c.session_id) h += `<p class="sub">Alexa+ now confirms the payment with you. Payment instrument and PIN stay with Alexa.</p><button type="button" class="act" data-checkout="${esc(c.session_id)}">${icon("i-check")} Alexa+: “Yes, place the order”</button>`;
  } else if (c.kind === "progress") {
    h += row("Waiting on replies", c.waiting) + row("Waiting on you", c.parked, "needs-b") + row("Receipt chain", c.chain_ok ? `<span class="ok">${icon("i-check")} intact</span>` : `<span class="bad">${icon("i-x")} broken</span>`) + row("Receipts", c.receipts);
    if (c.missed.length) h += `<p class="late">Past the date: ${esc(c.missed.join("; "))}</p>`;
    if (c.share_url) h += `<button type="button" class="act alt" data-open="${esc(c.share_url)}">Open the sibling's page ${icon("i-chev")}</button>`;
  }
  el.innerHTML = h;
  el.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => call(b.dataset.tool, JSON.parse(b.dataset.arg))));
  el.querySelectorAll("[data-checkout]").forEach((b) => b.addEventListener("click", () => completeCheckout(b.dataset.checkout)));
  el.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  el.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => window.open(b.dataset.open, "_blank")));
}
async function completeCheckout(sessionId) {
  // What Alexa+ does after the customer confirms on the device. Sent twice with the same Idempotency-Key on purpose: the
  // record shows the second call replayed, not re-charged.
  const key = "idem-" + crypto.randomUUID();
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`/checkout-sessions/${sessionId}/complete`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ case_id: state.caseId }) });
    const s = await r.json();
    story("alexa", `POST /checkout-sessions/…/complete<span class="lab-line">Idempotency-Key ${esc(key.slice(5, 13))} returned ${esc(s.status)} ${esc(s.order_id || "")}</span>${r.headers.get("Idempotent-Replayed") === "true" ? "<b>(replayed, not re-charged)</b>" : ""}`);
  }
  say("Ordered. The county mails them; I will tell you when they arrive.");
  await call("whats_due", { case_id: state.caseId });
}

// ---------- routing what you say ----------
const KINDS = [["bank", /bank|checking|savings|credit union/], ["pension", /pension|retire|401|calpers/], ["employer", /employer|job|work|hospital/], ["insurance", /insur|policy/], ["utilities", /power|electric|gas|water|utilit|pg&e/], ["phone_internet", /phone|internet|mobile|cell/], ["subscriptions", /gym|subscri|membership|netflix/], ["credit_cards", /credit card|visa|mastercard|amex/], ["vehicle", /\bcar\b|truck|vehicle|camry/]];
const RULE = { bank: "bank_notify", pension: "pension_notify", insurance: "insurance_claim", utilities: "utilities_notify", subscriptions: "subscription_cancel", credit_cards: "credit_card_notify", vehicle: "vehicle_reg5", employer: "employer_notify", phone_internet: "phone_internet_notify" };
function route(text) {
  const t = text.toLowerCase();
  if (/died|passed|death|start/.test(t) && !state.caseId) {
    const rel = /husband|wife|spouse|partner/.test(t) ? "spouse" : /mother|father|mom|dad|parent/.test(t) ? "child" : /brother|sister/.test(t) ? "sibling" : /\bson\b|daughter/.test(t) ? "parent" : /friend/.test(t) ? "friend" : "other";
    const kinds = KINDS.filter(([, re]) => re.test(t)).map(([k]) => k);
    const d = new Date(); d.setDate(d.getDate() - 7);
    return ["start_case", { date_of_death: d.toISOString().slice(0, 10), relationship: rel, has_will: !/no will|without a will/.test(t), account_kinds: kinds.length ? kinds : ["bank"] }];
  }
  if (!state.caseId) return [null, "Start by telling me what happened: who died, whether there is a will, and what accounts there were."];
  if (/approve|^yes|go ahead|do it|allow/.test(t)) return state.lastDecision ? ["approve", { case_id: state.caseId, decision_id: state.lastDecision }] : [null, "Nothing is waiting for your approval."];
  if (/decline|^no\b|not now|i will do it|leave it/.test(t)) return state.lastDecision ? ["decline", { case_id: state.caseId, decision_id: state.lastDecision, reason: "i_will_do_it_myself" }] : [null, "Nothing is waiting for your decision."];
  if (/certificate|copies|order/.test(t)) return ["order_certificates", { case_id: state.caseId }];
  if (/read|draft|letter|script/.test(t)) {
    const kind = KINDS.find(([, re]) => re.test(t));
    const id = /social security|ssa/.test(t) ? "ssa_report" : /equifax|experian|transunion|bureau/.test(t) ? "bureau_equifax" : /will|court/.test(t) ? "will_deliver" : kind ? (state.snapshot?.ledger.rows.find((r) => r.id.startsWith(RULE[kind[0]]))?.id || RULE[kind[0]]) : "bureau_equifax";
    return ["draft_notice", { case_id: state.caseId, task_id: id }];
  }
  if (/progress|how far|share|sibling|sister|brother/.test(t)) return ["share_progress", { case_id: state.caseId }];
  return ["whats_due", { case_id: state.caseId }];
}
async function submitText(text, typed = false) {
  story("exec", esc(text)); await caption(text, typed);
  const [tool, args] = route(text); if (!tool) return say(args);
  return call(tool, args);
}
$("ask").addEventListener("submit", async (e) => { e.preventDefault(); const text = $("utterance").value.trim(); if (!text) return; $("utterance").value = ""; try { await submitText(text); } catch {} });
document.addEventListener("click", (e) => { const b = e.target.closest("button[data-say]"); if (b) { $("utterance").value = b.dataset.say; $("ask").requestSubmit(); } });


// ---------- the story: six chapters against the real server, then it hands the gate to you ----------
function chapter(id) {
  if (!$("chapters")) return;
  const items = [...$("chapters").children]; let seen = false;
  for (const li of items) { const on = li.dataset.ch === id; li.classList.toggle("on", on); li.classList.toggle("done", !on && !seen); if (on) seen = true; }
  $("scene").dataset.chapter = id || "";
}
function setPlay(on) { $("play").querySelector("b").textContent = on ? "Stop the story" : "Watch the first week"; }
async function playStory() {
  if (state.playing) { state.playing = false; speechSynthesis?.cancel(); return; }
  state.playing = true; $("scene").classList.add("playing"); $("scene").classList.remove("handing"); setPlay(true); $("handoff").hidden = true;
  state.caseId = null; state.lastDecision = null; state.snapshot = null; state.prevStatus = {}; state.story = [];
  history.replaceState(null, "", location.pathname + location.hash);
  const check = () => { if (!state.playing) throw new Error("stopped"); };
  try {
    await ensureInit();
    chapter("tell"); await submitText(TELL, true); check();
    chapter("list"); await state.voice; check(); await sleep(500);
    chapter("allow"); await submitText("Yes, go ahead.", true); check(); await state.voice; check(); await sleep(500);
    chapter("order"); const q = await submitText("Order the certificates.", true); check(); await state.voice; check();
    if (q?.card?.session_id) { $("alexa-confirm").hidden = false; await sleep(2300); $("alexa-confirm").hidden = true; check(); await completeCheckout(q.card.session_id); await state.voice; check(); }
    chapter("week"); await sleep(600); await advance(7); check(); await sleep(1600); check(); await state.voice; check();
    chapter("gate"); await handoff();
  } catch (e) { if (e.message !== "stopped") toast(e.message); chapter(""); }
  finally { state.playing = false; $("scene").classList.remove("playing"); setPlay(false); $("alexa-confirm").hidden = true; }
}
$("play").addEventListener("click", playStory);
async function handoff() {
  await refresh();
  const d = state.snapshot?.due.decisions[0]; const box = $("handoff"); if (!d) { box.hidden = true; return; }
  $("scene").classList.add("handing");
  state.lastDecision = d.id;
  box.innerHTML = `<span class="k">${icon("i-diamond")}<b>${esc(d.gate)}</b><span>${esc(GATE_WORD[d.gate] || "")}</span></span><h3>This one is yours.</h3><p>${esc(d.summary)} The desk stopped here and will not move until you do.</p><div id="handoff-slot"></div><div class="desk-actions"><button type="button" id="handoff-desk">Check it on the Desk first ${icon("i-chev")}</button><button type="button" id="handoff-skip">Leave it for now</button></div>`;
  box.hidden = false;
  $("handoff-slot").appendChild(holdButton({ label: `Approve: ${d.summary.split(".")[0].slice(0, 48)}`, onHold: async () => { await call("approve", { case_id: state.caseId, decision_id: d.id }); box.innerHTML = `<span class="k">${icon("i-check")} Written down</span><p>Carried out and receipted. The rest of the week's gates are on the Desk.</p><div class="desk-actions"><button type="button" id="handoff-desk" class="primary">Open the Desk ${icon("i-chev")}</button></div>`; $("handoff-desk").addEventListener("click", () => go("desk")); setTimeout(() => { box.hidden = true; $("scene").classList.remove("handing"); }, 5000); }, onTap: () => go("desk") }));
  $("handoff-desk").addEventListener("click", () => go("desk"));
  $("handoff-skip").addEventListener("click", () => { box.hidden = true; $("scene").classList.remove("handing"); });
}

// ---------- the hub: the desk in the middle, every institution around it (SVG; pulses ride the spokes) ----------
const NAMES = { ssa_report: "Social Security", ssa_return_payment: "SSA payment", ssa_survivor: "Survivor benefits", will_deliver: "Probate court", certificates_order: "County clerk", bureau_equifax: "Equifax", bureau_experian: "Experian", bureau_transunion: "TransUnion", bank_notify: "Bank", pension_notify: "Pension", employer_notify: "Employer", insurance_claim: "Insurer", utilities_notify: "Utility", phone_internet_notify: "Phone", subscription_cancel: "Gym", credit_card_notify: "Card issuer", vehicle_reg5: "DMV" };
const CATS = [["ssa", "ssa"], ["will", "court"], ["certificates", "clerk"], ["bureau", "bureau"], ["bank", "bank"], ["pension", "pension"], ["employer", "employer"], ["insurance", "insurer"], ["utilities", "utility"], ["phone", "phone"], ["subscription", "gym"], ["credit_card", "card"], ["vehicle", "dmv"]];
const catOf = (id) => (CATS.find(([p]) => id.replace(/^ghost_/, "").startsWith(p)) || [0, "other"])[1];
const nameOf = (id, label) => label || NAMES[Object.keys(NAMES).find((p) => id.replace(/^ghost_/, "").startsWith(p))] || id.replace(/_/g, " ");
const GHOSTS = ["ssa_report", "will_deliver", "certificates_order", "bureau_equifax", "bank_notify", "pension_notify", "insurance_claim", "utilities_notify", "subscription_cancel", "vehicle_reg5"].map((id) => ({ id: "ghost_" + id, status: "ghost", label: null }));
const HUB = { cx: 320, cy: 272, rx: 258, ry: 198 };
function renderHub(rows, prev) {
  const n = rows.length; const first = !Object.keys(prev).length; let spokes = "", avs = "";
  rows.forEach((r, i) => {
    const a = -Math.PI / 2 + (i + 0.5) / n * Math.PI * 2; const x = (HUB.cx + Math.cos(a) * HUB.rx).toFixed(1), y = (HUB.cy + Math.sin(a) * HUB.ry).toFixed(1);
    const changed = prev[r.id] && prev[r.id] !== r.status; const badge = { done: "i-check", parked: "i-diamond", held: "i-hand", waiting: "i-half" }[r.status];
    spokes += `<path class="spoke ${esc(r.status)}" data-id="${esc(r.id)}" d="M${HUB.cx} ${HUB.cy} L${x} ${y}"/>`;
    avs += `<g class="av ${esc(r.status)} ${changed ? "pop" : ""} ${first ? "born" : ""}" style="--i:${i}" transform="translate(${x} ${y})"><g class="in"><circle class="ring" r="30"/><circle class="disc" r="26"/><use href="#c-${catOf(r.id)}" x="-14" y="-14" width="28" height="28"/><g class="badge" transform="translate(19 -19)"><circle r="10"/>${badge ? `<use href="#${badge}" x="-6" y="-6" width="12" height="12"/>` : ""}</g></g><text y="${Math.sin(a) < -0.2 ? -42 : 52}">${esc(nameOf(r.id, r.label))}</text></g>`;
  });
  $("hub").innerHTML = `<g class="spokes">${spokes}</g><g class="hubc" transform="translate(${HUB.cx} ${HUB.cy})"><circle class="hub-ring" r="40"/><rect class="hub-bar" x="-16" y="24" width="32" height="4" rx="2"/><circle class="hub-dot" r="6"/></g><g class="avs">${avs}</g><g id="pulses"></g>`;
}
function pulse(id, dir) {
  const sp = $("hub").querySelector(`.spoke[data-id="${CSS.escape(id)}"]`); if (!sp) return;
  const m = sp.getAttribute("d").match(/M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)/); if (!m) return;
  const path = dir === "out" ? `M${m[1]} ${m[2]} L${m[3]} ${m[4]}` : `M${m[3]} ${m[4]} L${m[1]} ${m[2]}`;
  const c = document.createElementNS("http://www.w3.org/2000/svg", "circle"); c.setAttribute("r", "6"); c.setAttribute("class", `pulse ${dir}`);
  c.innerHTML = `<animateMotion dur="0.9s" fill="freeze" path="${path}" calcMode="spline" keySplines="0.3 0 0.2 1" keyTimes="0;1" keyPoints="0;1"/>`;
  $("pulses").appendChild(c); setTimeout(() => c.remove(), 1200);
}
renderHub(GHOSTS, {});

// ---------- snapshot: the wall, the clock, the day row, the desk count ----------
function odometer(n) {
  const el = $("odo"); const s = String(Math.max(0, n)); const need = Math.max(s.length, 1);
  while (el.children.length < 3) { const d = document.createElement("b"); d.className = "odo-d"; d.innerHTML = `<span>${"0123456789".split("").map((x) => `<i>${x}</i>`).join("")}</span>`; el.appendChild(d); }
  const cols = [...el.children]; const padded = s.padStart(3, " ");
  cols.forEach((c, i) => { const ch = padded[i]; c.classList.toggle("hide", ch === " " && i < 3 - need); c.querySelector("span").style.setProperty("--d", ch === " " ? 0 : ch); });
}
async function refresh() {
  if (!state.caseId) return;
  const r = await fetch(`/api/cases/${state.caseId}`); if (!r.ok) return;
  const c = await r.json(); state.snapshot = c;
  $("day-sub").textContent = fmtDate(c.today); document.body.dataset.case = "on";
  const since = Math.round((new Date(c.today) - new Date(c.ledger.date_of_death)) / 864e5);
  odometer(since);
  const rows = c.ledger.rows; const first = !Object.keys(state.prevStatus).length; const n = c.due.decisions.length;
  $("ledger-n").textContent = `${rows.filter((x) => x.status === "done").length} of ${rows.length} done`;
  const word = { done: "done", waiting: "waiting", parked: "needs you", held: "held", open: "open" };
  $("ledger").innerHTML = rows.map((x, i) => { const ic = { done: "i-check", waiting: "i-half", parked: "i-diamond", held: "i-hand" }[x.status] || "i-open"; const changed = state.prevStatus[x.id] && state.prevStatus[x.id] !== x.status; const dl = x.deadline ? `<span class="dl ${x.days_left < 0 && x.status !== "done" ? "late" : ""} ${x.deadline_kind === "statutory" ? "stat" : ""}" title="${x.deadline_kind} date">${x.status === "done" ? "" : x.days_left == null ? "" : x.days_left < 0 ? `${-x.days_left} d late` : `${x.days_left} d left`}</span>` : `<span class="dl"></span>`;
    return `<li class="${esc(x.status)} ${first ? "new" : ""} ${changed ? "changed" : ""}" style="--i:${i}" title="${esc(x.status)}"><span class="st">${icon(ic)}${word[x.status] || esc(x.status)}</span><span><span class="t">${esc(x.title)}</span>${x.label ? `<span class="lab lab-line">${esc(x.label)}</span>` : ""}</span>${dl}</li>`; }).join("");
  // the hub: one avatar per institution; a pulse runs out when a notice goes and back when a reply lands
  renderHub(rows.length ? rows : GHOSTS, state.prevStatus);
  let k = 0; for (const x of rows) { const was = state.prevStatus[x.id]; if (!was || was === x.status) continue; const out = was === "open", back = x.status === "parked" || x.status === "done" || x.status === "held"; if (out) setTimeout(() => pulse(x.id, "out"), k++ * 160); if (back && was !== "open") setTimeout(() => pulse(x.id, x.status === "done" ? "in" : "gate"), k++ * 160); }
  state.prevStatus = Object.fromEntries(rows.map((x) => [x.id, x.status]));
  $("desk-count").hidden = !n; $("desk-count").textContent = n;
  if (state.devState === "idle") device("idle");
  $("chain").className = "chip " + (c.chain_ok ? "done" : "bad"); $("chain").innerHTML = `${icon(c.chain_ok ? "i-check" : "i-x")} Chain ${c.chain_ok ? "intact" : "broken"}`; $("chain-n").textContent = `${c.progress.receipts} receipts`;
  renderReceipts();
  if (c.progress.share) $("share-link").href = c.progress.share;
  drawDaybar();
  if (state.view === "desk") renderDesk();
  if (state.view === "record") mountRecord3d();
}
async function drawDaybar() {
  const r = await fetch(`/api/cases/${state.caseId}/timeline`); if (!r.ok) return;
  const tl = await r.json(); const start = new Date(tl.start); const today = new Date(tl.today);
  const span = Math.max(60, Math.round((today - start) / 864e5) + 14);
  const x = (d) => `${(Math.round((new Date(d) - start) / 864e5) / span) * 100}%`;
  let h = `<div class="rail"></div><div class="past" style="width:${x(tl.today)}"></div>`;
  for (let d = 0; d <= span; d += 7) { const dd = new Date(start); dd.setDate(dd.getDate() + d); h += `<div class="tick" style="left:${(d / span) * 100}%"><label>${d === 0 ? "death" : "d" + d}</label></div>`; }
  const ic = { deadline: "i-tri", reply: "i-dot", gate: "i-diamond", decision: "i-check", heir: "i-hand", sent: "i-dot" };
  for (const day of tl.days) for (const [i, e] of day.events.entries()) {
    const left = x(day.day); h += `<span class="ev ${esc(e.kind)}" style="left:calc(${left} + ${(i % 3) * 5}px)" title="${esc(e.kind)} on ${esc(day.day)}: ${esc(e.what)}">${icon(ic[e.kind] || "i-dot")}</span>`;
  }
  h += `<div class="now" style="left:${x(tl.today)}"></div>`;
  $("track").innerHTML = h;
  state.nextEvent = tl.days.map((d) => d.day).find((d) => d > tl.today) || null;
}
async function advance(days) {
  if (!state.caseId) return say("Start a case first.");
  device("thinking");
  const r = await fetch(`/api/cases/${state.caseId}/advance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }) });
  const o = await r.json();
  story("inst", `${days} day${days > 1 ? "s" : ""} pass → ${esc(o.today)}${o.replies.length ? `; replies: ${esc(o.replies.join(", "))}` : ""}; decisions waiting: ${o.open_decisions.length}`);
  if (o.replies.length) toast(`${o.replies.length} repl${o.replies.length === 1 ? "y" : "ies"} arrived while the days passed.`);
  await call("whats_due", { case_id: state.caseId });
}
$("next-day").addEventListener("click", () => advance(1)); $("next-week").addEventListener("click", () => advance(7));
$("next-event").addEventListener("click", () => { if (!state.nextEvent) return toast("No later event on the bar."); advance(Math.max(1, Math.round((new Date(state.nextEvent) - new Date(state.snapshot.today)) / 864e5))); });

// ---------- the Desk: a queue of gates, a dossier to check, then hold to approve ----------
async function renderDesk() {
  const body = $("desk-body");
  const dec = state.snapshot?.due.decisions || [];
  const recent = (state.snapshot?.receipts || []).filter((x) => x.action === "approve" || x.action === "decline").slice(-6).reverse();
  $("desk-decided").innerHTML = recent.length ? recent.map((x) => `<li class="${x.action === "decline" ? "declined" : ""}">${icon(x.action === "approve" ? "i-check" : "i-x")}<span><span>${esc(x.action)} ${esc(x.task_id || "")}</span><span class="lab-line">${esc(x.day)}</span></span></li>`).join("") : `<li class="muted">Nothing decided yet.</li>`;
  if (!dec.length) {
    $("desk-pos").textContent = "";
    $("desk-queue").innerHTML = `<li class="empty muted">Nothing waiting.</li>`;
    body.innerHTML = `<div class="empty-desk">${icon("i-hand").replace('class="icon"', 'class="icon big"')}<h3>Nothing needs you.</h3><p>The desk fills when a gate is reached: money leaving the estate, an original leaving your hands, your signature, anything that cannot be undone, an heir who objects. Everything else runs on the one authorisation you gave.</p><div class="desk-actions">${state.caseId ? `<button type="button" class="primary" id="desk-week">Let a week pass</button>` : `<button type="button" class="primary" id="desk-echo0">Start a case on the Echo</button>`}</div></div>`;
    $("desk-week")?.addEventListener("click", async () => { await advance(7); renderDesk(); });
    $("desk-echo0")?.addEventListener("click", () => go("echo"));
    return;
  }
  state.deskIndex = Math.min(state.deskIndex, dec.length - 1);
  const d = dec[state.deskIndex]; state.lastDecision = d.id;
  $("desk-pos").textContent = `Decision ${state.deskIndex + 1} of ${dec.length}`;
  $("desk-queue").innerHTML = dec.map((x, i) => `<li class="${i === state.deskIndex ? "on" : ""}"><button type="button" data-i="${i}"><span class="g">${esc(x.gate)}</span><span><span class="s">${esc(x.summary)}</span><span class="d">${esc(GATE_WORD[x.gate] || "")}</span></span></button></li>`).join("");
  $("desk-queue").querySelectorAll("button[data-i]").forEach((b) => b.addEventListener("click", () => { state.deskIndex = Number(b.dataset.i); renderDesk(); }));
  const det = await (await fetch(`/api/cases/${state.caseId}/decisions/${d.id}`)).json();
  const t = det.task;
  const amount = (det.decision.detail.match(/\$[\d,]+\.?\d*/) || [])[0];
  body.innerHTML = `<div class="stamp"><b>${esc(d.gate)}</b>${esc(GATE_SHORT[d.gate] || "")}</div><div class="meta">${t.label ? `<span class="chip">${esc(t.label)}</span>` : ""}<span>Raised ${esc(det.decision.raised_on)}</span></div>
    <h1>${esc(d.summary)}</h1>
    <div class="facts3">
      <div><span>${amount ? "Amount" : "Channel"}</span><b class="${amount ? "needs" : ""}">${esc(amount || t.channel || "mail")}</b><small>${amount ? "leaves the estate" : "how it goes out"}</small></div>
      <div><span>Date</span><b class="${t.days_left < 0 ? "needs" : ""}">${t.deadline ? (t.days_left < 0 ? `${-t.days_left} d late` : `${t.days_left} d`) : "none"}</b><small>${t.deadline ? `${esc(t.deadline_kind)} date, ${esc(t.deadline)}` : "no date"}</small></div>
      <div><span>${t.needs_original ? "Originals on hand" : "Written by"}</span><b>${t.needs_original ? det.originals_on_hand : esc(det.written_by)}</b><small>${t.needs_original ? "certified copies" : `${det.text_lines} line${det.text_lines === 1 ? "" : "s"} to approve`}</small></div>
    </div>
    <p class="needs-line">${esc(det.decision.detail)}</p>
    <details class="more"><summary>The rule it follows${t.history.length ? " and what happened lately" : ""}</summary><div><p class="small">${esc(t.source.quote).slice(0, 220)}${t.source.quote.length > 220 ? "…" : ""} <a href="${esc(t.source.url)}" target="_blank" rel="noopener">source ${icon("i-chev")}</a></p>${t.legal ? `<p class="fine legal">That is the court's own rule, not legal advice.</p>` : ""}${t.history.length ? `<dl class="dl-grid small">${t.history.map((x) => `<dt>${esc(x.day)}</dt><dd>${esc(x.text)}</dd>`).join("")}</dl>` : ""}</div></details>
    <details class="more" open><summary>Text to approve</summary><div class="approve-text">${t.needs_original ? `<div class="by pair"><span>Written by ${esc(det.written_by)}</span><span>${det.text_lines} line${det.text_lines === 1 ? "" : "s"}</span></div>` : ""}${esc(det.text)}</div></details>
    <div id="hold-slot"></div><p class="hold-hint">Hold to approve, or tap to confirm. Check before you approve: the facts above, the text below.</p>
    <div class="desk-actions"><button type="button" id="desk-decline">Decline…</button></div><div id="desk-extra"></div>`;
  $("hold-slot").appendChild(holdButton({ label: `Approve: ${d.gate === "D0" ? "send routine notices" : t.title.split(" (")[0].slice(0, 40)}`, onHold: () => decide("approve", d.id), onTap: () => confirmStep(d.id, t) }));
  $("desk-decline").addEventListener("click", () => declineStep(d.id));
}
function confirmStep(id, t) {
  $("desk-extra").innerHTML = `<div class="confirm"><p><b>Approve this?</b> ${esc(t.title)}.</p><div class="desk-actions"><button type="button" id="c-yes" class="primary">Yes, approve</button><button type="button" id="c-no">Back</button></div></div>`;
  $("c-yes").addEventListener("click", () => decide("approve", id)); $("c-no").addEventListener("click", () => ($("desk-extra").innerHTML = ""));
}
function declineStep(id) {
  const reasons = [["i_will_do_it_myself", "I will do it myself"], ["not_now", "Not now"], ["wrong_institution", "Wrong institution"], ["ask_my_sibling", "Ask my sibling first"]];
  $("desk-extra").innerHTML = `<div class="confirm"><p><b>Decline.</b> The desk leaves it with you and writes that down.</p><div class="reasons">${reasons.map(([k, v]) => `<button type="button" data-reason="${k}">${v}</button>`).join("")}<button type="button" id="r-back">Back</button></div></div>`;
  $("desk-extra").querySelectorAll("[data-reason]").forEach((b) => b.addEventListener("click", () => decide("decline", id, b.dataset.reason)));
  $("r-back").addEventListener("click", () => ($("desk-extra").innerHTML = ""));
}
async function decide(tool, id, reason) {
  const args = { case_id: state.caseId, decision_id: id }; if (reason) args.reason = reason;
  const out = await call(tool, args);
  const last = state.snapshot?.receipts?.slice(-1)[0]; const ex = $("desk-extra");
  if (ex) ex.innerHTML = `<div class="receipt">${icon("i-check")} <b>Written down.</b> ${esc(tool === "approve" ? "Carried out and receipted." : "Left with you.")}${last ? `<div class="mono pair"><span>#${last.seq}</span><span>${esc(last.hash.slice(0, 16))}…</span></div>` : ""}</div>`;
  setTimeout(() => { state.deskIndex = 0; renderDesk(); }, 1500);
  return out;
}
// Hold-to-approve: press and hold; a fill sweeps across; at full the label reads "Release to approve" and releasing completes
// it (the up-event decides). A tap, Enter or Space never approves: it opens the confirmation step instead.
function holdButton({ label, onHold, onTap }) {
  const HOLD_MS = 1100, TAP_MS = 250;
  const b = document.createElement("button"); b.type = "button"; b.className = "hold"; b.innerHTML = `${icon("i-check")}<span>${esc(label)}</span>`;
  let phase = "idle", started = 0, frame = 0;
  const text = b.querySelector("span");
  const paint = () => { if (phase === "idle") return; const p = Math.min(1, (performance.now() - started) / HOLD_MS); b.style.setProperty("--hold", p.toFixed(3)); if (p >= 1 && phase === "holding") { phase = "armed"; b.classList.add("is-armed"); text.textContent = "Release to approve"; } if (phase === "holding") frame = requestAnimationFrame(paint); };
  const reset = () => { cancelAnimationFrame(frame); phase = "idle"; b.classList.remove("is-armed"); b.style.setProperty("--hold", "0"); text.textContent = label; };
  b.addEventListener("pointerdown", (e) => { if (!e.isPrimary || e.button !== 0) return; if (b.hasPointerCapture(e.pointerId)) b.releasePointerCapture(e.pointerId); phase = "holding"; started = performance.now(); frame = requestAnimationFrame(paint); });
  b.addEventListener("pointerup", () => { const held = performance.now() - started; const armed = phase === "armed"; reset(); if (armed) onHold(); else if (held < TAP_MS) onTap(); else toast("Keep holding to approve, or tap for a confirmation step."); });
  b.addEventListener("pointerleave", reset); b.addEventListener("pointercancel", reset);
  b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } });
  return b;
}
$("desk-skip").addEventListener("click", () => { const n = state.snapshot?.due.decisions.length || 0; if (n) { state.deskIndex = (state.deskIndex + 1) % n; renderDesk(); } });

// ---------- the Record: receipts by day, filtered; the 3D chain; verify ----------
const kindOf = (x) => x.action === "raise" || x.action === "objection" ? "gate" : x.action === "approve" || x.action === "decline" ? "decision" : x.action.startsWith("execute") ? "exec" : x.actor === "institution" ? "reply" : "other";
function renderReceipts() {
  const rs = (state.snapshot?.receipts || []).slice().reverse(); let day = null; let h = "";
  for (const x of rs) {
    const k = kindOf(x); if (state.filter !== "all" && k !== state.filter) continue;
    if (x.day !== day) { day = x.day; h += `<li class="dayh">${esc(day)}</li>`; }
    h += `<li class="r" data-seq="${x.seq}"><span class="seq">#${x.seq}</span><span class="who ${esc(x.actor)}">${esc(x.actor)}</span><span class="act ${k === "gate" ? "gate" : k === "exec" ? "exec" : x.action === "approve" ? "approve" : ""}">${esc(x.action)} ${x.task_id ? `<span class="fine">${esc(x.task_id)}</span>` : ""} ${x.note ? `<span class="note">${esc(x.note)}</span>` : ""}</span><span class="hash" title="${esc(x.hash)}">${esc(x.hash.slice(0, 10))}</span></li>`;
  }
  $("receipts").innerHTML = h || `<li class="r"><span class="muted">No receipts yet.</span></li>`;
  $("receipts").querySelectorAll("li.r[data-seq]").forEach((li) => { li.addEventListener("mouseenter", () => chain?.focus(Number(li.dataset.seq))); li.addEventListener("mouseleave", () => chain?.focus(null)); });
}
$("rec-filter").addEventListener("click", (e) => { const b = e.target.closest("button[data-f]"); if (!b) return; state.filter = b.dataset.f; $("rec-filter").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); renderReceipts(); });
$("verify").addEventListener("click", async () => {
  if (!state.caseId) return toast("Start a case first.");
  $("verify").disabled = true; await refresh();
  if (chain) await chain.sweep(); else await sleep(600);
  toast(state.snapshot.chain_ok ? `Every hash checks out: ${state.snapshot.progress.receipts} receipts, one chain.` : "The chain does not verify.");
  $("verify").disabled = false;
});
let chain = null;
async function mountRecord3d() {
  $("chain-empty").hidden = !!state.snapshot;
  if (!state.snapshot || reduced) return;
  const { mountChain } = await import("/chain3d.js");
  chain?.dispose();
  chain = await mountChain($("chain3d"), state.snapshot.receipts, state.snapshot.chain_ok, (r) => {
    $("chain3d-hover").innerHTML = r ? `<span class="pair"><b>#${r.seq}</b><span>${esc(r.day)}</span><span>${esc(r.actor)}</span><span>${esc(r.action)}</span>${r.task_id ? `<span>${esc(r.task_id)}</span>` : ""}${r.note ? `<span>${esc(r.note)}</span>` : ""}</span>` : "Drag to orbit, pinch or ctrl+wheel to zoom, hover a block for its receipt. A cube is a receipt, a diamond is a gate, the newest breathes.";
    $("receipts").querySelectorAll("li.r").forEach((li) => li.classList.toggle("hi", !!r && Number(li.dataset.seq) === r.seq));
  });
}

// ---------- how it works: live scoreboard, counting stats ----------
$("run-sim").addEventListener("click", async () => {
  $("run-sim").disabled = true; $("run-sim").textContent = "Running eight weeks…";
  const r = await fetch("/api/scoreboard"); const sb = await r.json();
  const key = new Set(["interruption precision", "decision recall", "forbidden actions", "chain verified", "voice policy violations"]);
  $("score").innerHTML = `<tbody>${sb.rows.map((x, i) => `<tr style="--i:${i}" class="${key.has(x.key) ? "key" : ""} ${!sb.ok && key.has(x.key) ? "bad" : ""}"><td>${esc(x.key)}</td><td>${esc(x.value)}</td></tr>`).join("")}</tbody>`;
  const v = Object.fromEntries(sb.rows.map((x) => [x.key, x.value])); const ours = Number(v["interruptions raised"]), base = Number(v["confirm everything baseline"]), max = Math.max(ours, base, 1);
  const gauge = (p, label, text) => `<div class="gauge"><svg viewBox="0 0 84 84"><circle class="bg" cx="42" cy="42" r="36"/><circle class="fg" cx="42" cy="42" r="36" style="--p:0"/></svg><b>${esc(text)}</b><span>${esc(label)}</span></div>`;
  $("chart").hidden = false;
  $("chart").innerHTML = `<div class="bars"><div class="bar ours"><span>This desk asked</span><i style="--w:0"></i><b>${ours}</b></div><div class="bar"><span>Confirm-everything would</span><i style="--w:0"></i><b>${base}</b></div><div class="bar ours"><span>Tasks done</span><i style="--w:0"></i><b>${esc(v["tasks done"])}</b></div><div class="bar"><span>Forbidden actions</span><i style="--w:0"></i><b>${esc(v["forbidden actions"])}</b></div></div>
    <div class="gauges">${gauge(Number(v["interruption precision"]), "precision", v["interruption precision"])}${gauge(Number(v["decision recall"]), "recall", v["decision recall"])}${gauge(v["chain verified"] === "True" ? 1 : 0, `${esc(v["receipts"])} receipts`, v["chain verified"] === "True" ? "chain ✓" : "chain ✗")}</div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => { const bars = $("chart").querySelectorAll(".bar i"); bars[0].style.setProperty("--w", ours / max); bars[1].style.setProperty("--w", base / max); bars[2].style.setProperty("--w", 1); bars[3].style.setProperty("--w", 0.01); $("chart").querySelectorAll(".gauge .fg").forEach((c, i) => c.style.setProperty("--p", [Number(v["interruption precision"]), Number(v["decision recall"]), v["chain verified"] === "True" ? 1 : 0][i])); }));
  $("run-sim").disabled = false; $("run-sim").textContent = sb.ok ? "Ran clean. Run it again" : "A check failed. Run it again";
});
function countStats() {
  document.querySelectorAll(".hero-stats dd[data-n]").forEach((dd) => {
    const target = Number(dd.dataset.n), unit = dd.dataset.unit || "", dec = String(dd.dataset.n).includes(".") ? 2 : 0; const t0 = performance.now();
    (function tick() { const p = Math.min(1, (performance.now() - t0) / 1100); const v = target * (1 - Math.pow(1 - p, 3)); dd.textContent = v.toFixed(dec) + unit; if (p < 1) requestAnimationFrame(tick); })();
  });
}

// ---------- labels dialog ----------
$("edit-labels").addEventListener("click", () => {
  if (!state.snapshot) return toast("Start a case first.");
  $("labels").innerHTML = state.snapshot.ledger.rows.filter((r) => r.label).map((r) => `<label><span>${esc(r.title.split(" (")[0].slice(0, 34))}</span><input data-task="${esc(r.id)}" value="${esc(r.label)}"></label>`).join("");
  $("labels-dlg").showModal();
});
$("labels-cancel").addEventListener("click", () => $("labels-dlg").close());
$("labels-dlg").querySelector("form").addEventListener("submit", async () => { const body = {}; $("labels").querySelectorAll("input[data-task]").forEach((i) => (body[i.dataset.task] = i.value)); await fetch(`/api/cases/${state.caseId}/labels`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); toast("Names saved (cards only)."); refresh(); });

// ---------- pages, theme, keys, toast ----------
function go(view) {
  state.view = view; document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== view)); document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.view === view));
  if (location.hash !== "#" + view) history.replaceState(null, "", `${location.search}#${view}`);
  window.scrollTo({ top: 0 });
  if (view === "desk") renderDesk();
  if (view === "record") mountRecord3d(); else { chain?.dispose(); chain = null; }
  if (view === "how") countStats();
}
window.addEventListener("hashchange", () => go(location.hash.slice(1) || "echo"));
$("theme").addEventListener("click", () => { const cur = document.documentElement.dataset.theme || "light"; const next = cur === "light" ? "dark" : "light"; document.documentElement.dataset.theme = next; try { localStorage.setItem("ald-theme2", next); } catch {} $("theme").innerHTML = icon(next === "light" ? "i-moon" : "i-sun"); });
if (document.documentElement.dataset.theme === "dark") $("theme").innerHTML = icon("i-sun");
document.addEventListener("keydown", (e) => { if (e.target.closest("input,textarea,select") || e.metaKey || e.ctrlKey) return; if (e.key === "?") { $("keys-dlg").showModal(); return; } const k = e.key.toLowerCase(); if (k === "n") advance(1); else if (k === "w") advance(7); else if (k === "1") go("echo"); else if (k === "2") go("desk"); else if (k === "3") go("record"); else if (k === "4") go("how"); else if (k === "a" && state.view === "desk" && state.lastDecision) { const t = state.snapshot?.due.decisions[state.deskIndex]; if (t) confirmStep(t.id, { title: t.summary }); } });
$("keys").addEventListener("click", () => $("keys-dlg").showModal());
document.addEventListener("click", (e) => { const p = $("voice-pop"); if (p.open && !e.composedPath().includes(p)) p.open = false; });
document.addEventListener("keydown", (e) => { const p = $("voice-pop"); if (e.key === "Escape" && p.open) { p.open = false; p.querySelector("summary").focus(); } });
let toastTimer; function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2800); }

// ---------- boot: the device powers on, then the page waits for you ----------
odometer(0);
go(location.hash.slice(1) || "echo");
document.addEventListener("click", (e) => { if (e.target.closest("#play-inline")) playStory(); });
ensureInit().then(() => { if (state.caseId) call("whats_due", { case_id: state.caseId }); }).catch(() => {});
