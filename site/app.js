// The simulated Alexa+ client. A real MCP client over Streamable HTTP (initialize, tools/list, tools/call; JSON responses,
// stateless) with four pages: the Echo (what the person hears and sees), the Desk (check, then hold to approve), the Record
// (every receipt) and How it works (the pipeline and the live scoreboard). The only pretence is the routing of what you type
// to a tool, a handful of rules standing in for Alexa+'s understanding.
const MCP = "/mcp";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
const state = { caseId: new URLSearchParams(location.search).get("case"), lastDecision: null, muted: false, rpc: 0, init: false, view: "echo", story: [], deskIndex: 0, snapshot: null };

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
    const init = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "after-loss-desk-web", version: "0.2.0" } });
    await fetch(MCP, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    const tools = await rpc("tools/list", {});
    state.init = true;
    setConn("ok", `${init.serverInfo.name} · ${init.protocolVersion}`);
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
  renderCard(out); say(out.speak); refresh();
  return out;
}

// ---------- voice out / in, device states ----------
function device(s) { $("device").dataset.state = s; }
function say(text) {
  $("speak").textContent = text || "";
  if (!text) return device("idle");
  if (state.muted || !("speechSynthesis" in window)) { device("speaking"); setTimeout(() => device("idle"), Math.min(6000, 60 * text.length)); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.rate = 0.98; u.onstart = () => device("speaking"); u.onend = () => device("idle"); u.onerror = () => device("idle");
  speechSynthesis.speak(u);
}
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Rec) { $("mic").disabled = true; $("mic").title = "Speech input needs Chrome"; }
else {
  $("mic").addEventListener("click", () => {
    const rec = new Rec(); rec.lang = "en-US"; rec.interimResults = false;
    $("mic").classList.add("on"); device("listening");
    rec.onresult = (e) => { $("utterance").value = e.results[0][0].transcript; $("ask").requestSubmit(); };
    rec.onend = () => { $("mic").classList.remove("on"); if ($("device").dataset.state === "listening") device("idle"); };
    rec.onerror = () => { toast("Could not hear that."); };
    rec.start();
  });
}
$("mute").addEventListener("click", () => { state.muted = !state.muted; $("mute").innerHTML = icon(state.muted ? "i-mute" : "i-sound"); $("mute").setAttribute("aria-label", state.muted ? "Spoken replies off" : "Spoken replies on"); if (state.muted) speechSynthesis?.cancel(); });

// ---------- the story panel ----------
function story(who, html) {
  const when = state.snapshot?.today || "";
  state.story.unshift({ who, html, when });
  state.story = state.story.slice(0, 60);
  $("story").innerHTML = state.story.map((s) => `<li><span class="when">${esc(s.when)}</span><span><span class="who ${esc(s.who)}">${{ alexa: "Alexa+", exec: "You", inst: "Reply", agent: "Desk", err: "Error" }[s.who] || s.who}</span> <span class="${s.who === "err" ? "err" : ""}">${s.html}</span></span></li>`).join("");
  $("story-n").textContent = `${state.story.length} entries`;
}

// ---------- cards on the Echo ----------
function renderCard(out) {
  const c = out.card; const el = $("card"); el.classList.remove("card"); void el.offsetWidth; el.classList.add("card");
  if (!c) { el.innerHTML = `<h1>After Loss Desk</h1><p class="sub">${esc(out.speak || out.error)}</p>`; return; }
  $("plate-chip").textContent = { ledger: "Who to tell", due: "This week", draft: "A notice", quote: "Certified copies", progress: "Progress" }[c.kind] || "After Loss Desk";
  const row = (l, r, cls = "") => `<div class="row"><span>${l}</span><b class="${cls}">${r ?? ""}</b></div>`;
  const days = (d) => d == null ? "" : d < 0 ? `<span class="late">${-d} d late</span>` : `${d} d`;
  const lab = (x) => x.label ? ` <span class="fine">· ${esc(x.label)}</span>` : "";
  let h = `<h1>${esc(c.title)}</h1>`;
  if (c.kind === "ledger") {
    h += `<p class="sub">${esc(c.state)} · ${c.originals_needed} certified copies needed, ${c.originals_on_hand} on hand</p>`;
    h += c.rows.filter((r) => r.status !== "done").slice(0, 5).map((r) => row(esc(r.title) + lab(r), days(r.days_left))).join("");
    if (c.rows.length > 5) h += `<p class="fine">and ${c.rows.length - 5} more under “Who to tell”.</p>`;
    if (c.action?.decision_id) h += `<button type="button" class="act" data-tool="approve" data-arg='${esc(JSON.stringify({ case_id: out.case_id, decision_id: c.action.decision_id }))}'>${icon("i-check")} ${esc(c.action.label)}</button><button type="button" class="act alt" data-tool="decline" data-arg='${esc(JSON.stringify({ case_id: out.case_id, decision_id: c.action.decision_id }))}'>Not now</button>`;
  } else if (c.kind === "due") {
    h += c.decisions.slice(0, 2).map((d) => `<div class="row"><span><span class="gate">${icon("i-diamond")}${esc(d.gate)}</span>${esc(d.summary)}</span></div>`).join("");
    if (c.decisions.length) h += `<button type="button" class="act" data-tool="approve" data-arg='${esc(JSON.stringify({ case_id: out.case_id, decision_id: c.decisions[0].id }))}'>${icon("i-check")} Approve</button><button type="button" class="act alt" data-go="desk">Check on the Desk ${icon("i-chev")}</button>`;
    if (c.decisions.length > 2) h += `<p class="fine">${c.decisions.length - 2} more on the Desk.</p>`;
    h += c.items.slice(0, 3).map((i) => row(esc(i.title) + lab(i), days(i.days_left))).join("");
    if (!c.decisions.length && !c.items.length) h += `<p class="sub">${c.waiting.length ? `Nothing due. Waiting on ${c.waiting.length} repl${c.waiting.length === 1 ? "y" : "ies"}.` : "Nothing due. Rest."}</p>`;
  } else if (c.kind === "draft") {
    h += `<p class="sub">${esc(c.label || "")} · ${esc(c.channel)}</p><pre>${esc(c.text)}</pre><p class="fine">Facts filled by code: ${esc(c.facts.join(", ") || "none")}</p>`;
  } else if (c.kind === "quote") {
    h += row(`${c.count} × $${Number(c.unit_price).toFixed(2)} + $${Number(c.processing).toFixed(2)} processing`, `$${Number(c.total).toFixed(2)}`) + `<p class="fine">${esc(c.fee_note)}</p>`;
    if (c.session_id) h += `<p class="sub">Alexa+ now confirms the payment with you. Payment instrument and PIN stay with Alexa.</p><button type="button" class="act" data-checkout="${esc(c.session_id)}">${icon("i-check")} Alexa+: “Yes, place the order”</button>`;
  } else if (c.kind === "progress") {
    h += row("Waiting on replies", c.waiting) + row("Waiting on you", c.parked, "needs-b") + row("Receipt chain", c.chain_ok ? `<span class="ok">${icon("i-check")} intact · ${c.receipts}</span>` : `broken · ${c.receipts}`);
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
    story("alexa", `POST /checkout-sessions/…/complete · Idempotency-Key ${esc(key.slice(5, 13))} → ${esc(s.status)} ${esc(s.order_id || "")} ${r.headers.get("Idempotent-Replayed") === "true" ? "<b>(replayed)</b>" : ""}`);
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
$("ask").addEventListener("submit", async (e) => { e.preventDefault(); const text = $("utterance").value.trim(); if (!text) return; $("utterance").value = ""; story("exec", esc(text)); const [tool, args] = route(text); if (!tool) return say(args); try { await call(tool, args); } catch {} });
document.addEventListener("click", (e) => { const b = e.target.closest("button[data-say]"); if (b) { $("utterance").value = b.dataset.say; $("ask").requestSubmit(); } });

// ---------- snapshot: ledger, clock, day bar, desk count ----------
async function refresh() {
  if (!state.caseId) return;
  const r = await fetch(`/api/cases/${state.caseId}`); if (!r.ok) return;
  const c = await r.json(); state.snapshot = c;
  $("today").textContent = c.today; $("plate-time").textContent = c.today;
  const since = Math.round((new Date(c.today) - new Date(c.ledger.date_of_death)) / 864e5); $("since").textContent = `day ${since} · replay clock`;
  const rows = c.ledger.rows;
  $("ledger-n").textContent = `${rows.filter((x) => x.status === "done").length} of ${rows.length} done`;
  $("ledger").innerHTML = rows.map((x) => { const ic = { done: "i-check", waiting: "i-half", parked: "i-diamond", held: "i-hand" }[x.status] || "i-open"; const dl = x.deadline ? `<span class="dl ${x.days_left < 0 && x.status !== "done" ? "late" : ""} ${x.deadline_kind === "statutory" ? "stat" : ""}" title="${x.deadline_kind} date">${x.days_left == null ? "" : x.days_left < 0 ? `${-x.days_left} d late` : `${x.days_left} d`}</span>` : `<span class="dl"></span>`;
    return `<li class="${esc(x.status)}" title="${esc(x.status)}"><span class="st">${icon(ic)}</span><span><span class="t">${esc(x.title)}</span>${x.label ? `<span class="lab"> · ${esc(x.label)}</span>` : ""}</span>${dl}</li>`; }).join("");
  const n = c.due.decisions.length; $("desk-count").hidden = !n; $("desk-count").textContent = n;
  $("chain").className = "chip " + (c.chain_ok ? "done" : "bad"); $("chain").innerHTML = `${icon(c.chain_ok ? "i-check" : "i-x")} chain ${c.chain_ok ? "intact" : "BROKEN"} · ${c.progress.receipts}`;
  $("receipts").innerHTML = c.receipts.slice().reverse().map((x) => `<li><span class="seq">#${x.seq}</span><span class="day">${esc(x.day)}</span><span class="who ${esc(x.actor)}">${esc(x.actor)}</span><span class="act ${x.action === "raise" ? "gate" : x.action.startsWith("execute") ? "exec" : x.action === "approve" ? "approve" : ""}">${esc(x.action)} ${x.task_id ? `<span class="fine">${esc(x.task_id)}</span>` : ""} ${x.note ? `<span class="muted">· ${esc(x.note)}</span>` : ""}</span><span class="hash" title="${esc(x.hash)}">${esc(x.hash.slice(0, 8))}</span></li>`).join("");
  if (c.progress.share) $("share-link").href = c.progress.share;
  drawDaybar();
  if (state.view === "desk") renderDesk();
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
    const left = x(day.day); h += `<span class="ev ${esc(e.kind)}" style="left:calc(${left} + ${(i % 3) * 5}px)" title="${esc(day.day)} · ${esc(e.kind)}: ${esc(e.what)}">${icon(ic[e.kind] || "i-dot")}</span>`;
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
  story("inst", `${days} day${days > 1 ? "s" : ""} pass → ${esc(o.today)}; replies: ${esc(o.replies.join(", ") || "none")}; decisions waiting: ${o.open_decisions.length}`);
  await call("whats_due", { case_id: state.caseId });
}
$("next-day").addEventListener("click", () => advance(1)); $("next-week").addEventListener("click", () => advance(7));
$("next-event").addEventListener("click", () => { if (!state.nextEvent) return toast("No later event on the bar."); advance(Math.max(1, Math.round((new Date(state.nextEvent) - new Date(state.snapshot.today)) / 864e5))); });

// ---------- the Desk ----------
async function renderDesk() {
  const body = $("desk-body");
  const dec = state.snapshot?.due.decisions || [];
  if (!dec.length) { $("desk-pos").textContent = "nothing waiting"; body.innerHTML = `<p class="muted center">Nothing needs you. The desk fills when a gate is reached: money, an original, a signature, a closure, or an objection.</p>`; return; }
  state.deskIndex = Math.min(state.deskIndex, dec.length - 1);
  const d = dec[state.deskIndex]; state.lastDecision = d.id;
  $("desk-pos").textContent = `${state.deskIndex + 1} of ${dec.length}`;
  const det = await (await fetch(`/api/cases/${state.caseId}/decisions/${d.id}`)).json();
  const t = det.task; const gateWord = { D0: "your say-so to start", D1: "money leaves the estate", D2: "an original leaves your hands", D3: "your signature or a visit", D4: "cannot be undone", D5: "an heir objects" }[d.gate];
  body.innerHTML = `<div class="meta"><span>${esc(t.id)}${t.label ? " · " + esc(t.label) : ""}</span><span>${esc(det.decision.raised_on)}</span></div>
    <h1>${esc(d.summary)}</h1><p class="gate">${icon("i-diamond")} ${esc(d.gate)} · ${esc(gateWord)}</p>
    <div class="check"><h4>Check before you approve</h4><table><tr><td>Task</td><td>${esc(t.title)}</td></tr>
      <tr><td>Needs</td><td>${esc(det.decision.detail)}</td></tr>
      <tr><td>Date</td><td>${t.deadline ? `${esc(t.deadline)} · ${t.days_left < 0 ? `<span class="needs">${-t.days_left} d late</span>` : `${t.days_left} d left`} · ${esc(t.deadline_kind)}` : "none"}</td></tr>
      ${t.needs_original ? `<tr><td>Originals</td><td>${det.originals_on_hand} certified cop${det.originals_on_hand === 1 ? "y" : "ies"} on hand</td></tr>` : ""}
      <tr><td>Rule</td><td>${esc(t.source.quote).slice(0, 140)}${t.source.quote.length > 140 ? "…" : ""} <a href="${esc(t.source.url)}" target="_blank" rel="noopener">source ${icon("i-chev")}</a>${t.legal ? `<div class="fine">The court's own rule, not legal advice.</div>` : ""}</td></tr>
      ${t.history.length ? `<tr><td>Lately</td><td>${t.history.map((x) => `${esc(x.day)} · ${esc(x.text)}`).join("<br>")}</td></tr>` : ""}</table></div>
    <h4 class="text-h">Text to approve</h4><div class="approve-text"><div class="by">Written by ${esc(det.written_by)} · ${det.text_lines} line${det.text_lines === 1 ? "" : "s"}</div>${esc(det.text)}</div>
    <div id="hold-slot"></div><p class="hold-hint">Hold to approve, or tap to confirm.</p>
    <div class="desk-actions"><button type="button" id="desk-decline">Decline…</button><button type="button" id="desk-echo">Back to the Echo</button></div><div id="desk-extra"></div>`;
  $("hold-slot").appendChild(holdButton({ label: `Approve: ${d.gate === "D0" ? "send routine notices" : t.title.split(" (")[0].slice(0, 40)}`, onHold: () => decide("approve", d.id), onTap: () => confirmStep(d.id, t) }));
  $("desk-decline").addEventListener("click", () => declineStep(d.id));
  $("desk-echo").addEventListener("click", () => go("echo"));
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
  const last = state.snapshot?.receipts?.slice(-1)[0];
  $("desk-extra").innerHTML = `<div class="receipt">${icon("i-check")} <b>Written down.</b> ${esc(tool === "approve" ? "Carried out and receipted." : "Left with you.")}<div class="mono">${last ? `#${last.seq} · ${esc(last.hash.slice(0, 16))}…` : ""}</div></div>`;
  setTimeout(() => { state.deskIndex = 0; renderDesk(); }, 1400);
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

// ---------- how it works: live scoreboard ----------
$("run-sim").addEventListener("click", async () => {
  $("run-sim").disabled = true; $("run-sim").textContent = "Running…";
  const r = await fetch("/api/scoreboard"); const sb = await r.json();
  const key = new Set(["interruption precision", "decision recall", "forbidden actions", "chain verified", "voice policy violations"]);
  $("score").innerHTML = `<tbody>${sb.rows.map((x) => `<tr class="${key.has(x.key) ? "key" : ""} ${!sb.ok && key.has(x.key) ? "bad" : ""}"><td>${esc(x.key)}</td><td>${esc(x.value)}</td></tr>`).join("")}</tbody>`;
  $("run-sim").disabled = false; $("run-sim").textContent = sb.ok ? "Ran clean. Run again" : "Run failed a check. Run again";
});

// ---------- labels dialog ----------
$("edit-labels").addEventListener("click", () => {
  if (!state.snapshot) return toast("Start a case first.");
  $("labels").innerHTML = state.snapshot.ledger.rows.filter((r) => r.label).map((r) => `<label><span>${esc(r.title.split(" (")[0].slice(0, 34))}</span><input data-task="${esc(r.id)}" value="${esc(r.label)}"></label>`).join("");
  $("labels-dlg").showModal();
});
$("labels-cancel").addEventListener("click", () => $("labels-dlg").close());
$("labels-dlg").querySelector("form").addEventListener("submit", async () => { const body = {}; $("labels").querySelectorAll("input[data-task]").forEach((i) => (body[i.dataset.task] = i.value)); await fetch(`/api/cases/${state.caseId}/labels`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); toast("Names saved (cards only)."); refresh(); });

// ---------- pages, theme, keys, toast ----------
function go(view) { state.view = view; document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== view)); document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.view === view)); if (location.hash !== "#" + view) history.replaceState(null, "", `${location.search}#${view}`); if (view === "desk") renderDesk(); }
window.addEventListener("hashchange", () => go(location.hash.slice(1) || "echo"));
$("theme").addEventListener("click", () => { const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"); const next = cur === "light" ? "dark" : "light"; document.documentElement.dataset.theme = next; try { localStorage.setItem("ald-theme", next); } catch {} $("theme").innerHTML = icon(next === "light" ? "i-moon" : "i-sun"); });
document.addEventListener("keydown", (e) => { if (e.target.closest("input,textarea") || e.metaKey || e.ctrlKey) return; const k = e.key.toLowerCase(); if (k === "n") advance(1); else if (k === "w") advance(7); else if (k === "1") go("echo"); else if (k === "2") go("desk"); else if (k === "3") go("record"); else if (k === "4") go("how"); else if (k === "a" && state.view === "desk" && state.lastDecision) { const t = state.snapshot?.due.decisions[state.deskIndex]; if (t) confirmStep(t.id, { title: t.summary }); } });
let toastTimer; function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2600); }

// ---------- boot ----------
go(location.hash.slice(1) || "echo");
ensureInit().then(() => { if (state.caseId) call("whats_due", { case_id: state.caseId }); }).catch(() => {});
