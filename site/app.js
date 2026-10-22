// The simulated Alexa+ client. It is a real MCP client: it initialises a session, lists the tools and calls them over
// Streamable HTTP (JSON responses, stateless). The only pretence is the routing of what you type to a tool, which here is a
// handful of rules; on a real Echo, Alexa+ would do that part. Spoken replies use the browser's speech synthesis.
const MCP = "/mcp";
const state = { caseId: new URLSearchParams(location.search).get("case"), lastDecision: null, muted: false, rpc: 0, initialised: false };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function rpc(method, params) {
  const body = { jsonrpc: "2.0", id: ++state.rpc, method, params };
  const r = await fetch(MCP, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" }, body: JSON.stringify(body) });
  const text = await r.text();
  let msg;
  if ((r.headers.get("content-type") || "").includes("text/event-stream")) {  // SSE: take the last data: line
    const lines = text.split("\n").filter((l) => l.startsWith("data:"));
    msg = JSON.parse(lines[lines.length - 1].slice(5));
  } else {
    msg = JSON.parse(text);
  }
  if (msg.error) throw new Error(msg.error.message || JSON.stringify(msg.error));
  return msg.result;
}

async function ensureInit() {
  if (state.initialised) return;
  const init = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "after-loss-desk-web", version: "0.1.0" } });
  await fetch(MCP, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  const tools = await rpc("tools/list", {});
  log(`initialize → ${init.serverInfo.name} (${init.protocolVersion}); ${tools.tools.length} tools: ${tools.tools.map((t) => t.name).join(", ")}`);
  state.initialised = true;
}

async function call(name, args) {
  await ensureInit();
  log(`<span class="tool">tools/call ${name}</span> ${esc(JSON.stringify(args))}`);
  const res = await rpc("tools/call", { name, arguments: args });
  const out = res.structuredContent || JSON.parse(res.content.find((c) => c.type === "text").text);
  if (out.error) { log(`<span class="err">${esc(out.error)}</span>`); say(out.error); return out; }
  if (out.case_id) { state.caseId = out.case_id; history.replaceState(null, "", `?case=${out.case_id}`); }
  if (out.card && out.card.kind === "due" && out.card.decisions.length) state.lastDecision = out.card.decisions[0].id;
  if (out.card && out.card.kind === "ledger" && out.card.action && out.card.action.decision_id) state.lastDecision = out.card.action.decision_id;
  render(out); say(out.speak); refresh();
  return out;
}

function say(text) {
  $("speak").textContent = text || "";
  if (!text || state.muted || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.rate = 0.98; speechSynthesis.speak(u);
}

function log(html) { const li = document.createElement("li"); li.innerHTML = html; $("log").prepend(li); }

function render(out) {
  const c = out.card; const el = $("card");
  if (!c) { el.innerHTML = `<h1>After Loss Desk</h1><p class="muted">${esc(out.speak || out.error)}</p>`; return; }
  let h = `<h1>${esc(c.title)}</h1>`;
  const row = (left, right) => `<div class="row"><span>${left}</span><b>${right ?? ""}</b></div>`;
  const days = (d) => d == null ? "" : d < 0 ? `<span class="warn">${-d} d late</span>` : `${d} d`;
  if (c.kind === "ledger") {
    h += `<p class="muted">${esc(c.state)} · as of ${esc(c.today)} · ${c.originals_needed} certified copies needed, ${c.originals_on_hand} on hand</p>`;
    h += c.rows.filter((r) => r.status !== "done").slice(0, 7).map((r) => row(`${esc(r.title)}${r.label ? ` <span class="muted">· ${esc(r.label)}</span>` : ""}`, days(r.days_left))).join("");
    if (c.rows.length > 7) h += `<p class="fine muted">and ${c.rows.length - 7} more on the desk page.</p>`;
    if (c.action && c.action.decision_id) h += `<button data-tool="approve" data-arg='${esc(JSON.stringify({ case_id: out.case_id, decision_id: c.action.decision_id }))}'>${esc(c.action.label)}</button><button class="alt" data-tool="decline" data-arg='${esc(JSON.stringify({ case_id: out.case_id, decision_id: c.action.decision_id }))}'>Not now</button>`;
  } else if (c.kind === "due") {
    h += c.decisions.map((d) => `<div class="row"><span><span class="gate">${esc(d.gate)}</span>${esc(d.summary)}<br><span class="muted fine">${esc(d.detail)}</span></span></div>
      <button data-tool="approve" data-arg='${esc(JSON.stringify({ case_id: out.case_id, decision_id: d.id }))}'>Approve</button><button class="alt" data-tool="decline" data-arg='${esc(JSON.stringify({ case_id: out.case_id, decision_id: d.id }))}'>Decline</button>`).join("");
    h += c.items.slice(0, 5).map((i) => row(`${esc(i.title)}${i.label ? ` <span class="muted">· ${esc(i.label)}</span>` : ""}`, days(i.days_left))).join("");
    if (c.waiting.length) h += `<p class="muted fine">Waiting on ${c.waiting.length} repl${c.waiting.length === 1 ? "y" : "ies"}: ${c.waiting.slice(0, 4).map((w) => esc(w.label || w.title)).join(", ")}.</p>`;
    if (!c.decisions.length && !c.items.length && !c.waiting.length) h += `<p class="muted">Nothing due. Rest.</p>`;
  } else if (c.kind === "draft") {
    h += `<p class="muted">${esc(c.label || "")} · ${esc(c.channel)}</p><pre>${esc(c.text)}</pre><p class="fine muted">Facts checked by code: ${esc(c.facts.join(", ") || "none")}. Source: ${esc(c.source.url)}</p>`;
  } else if (c.kind === "quote") {
    h += row(`${c.count} × $${Number(c.unit_price).toFixed(2)} + $${Number(c.processing).toFixed(2)} processing`, `$${Number(c.total).toFixed(2)}`) + `<p class="muted fine">${esc(c.fee_note)}</p>`;
    if (c.session_id) h += `<p class="muted">Alexa+ now confirms the payment with you (payment instrument and PIN stay with Alexa).</p><button data-checkout="${esc(c.session_id)}">Alexa+: “Yes, place the order”</button>`;
  } else if (c.kind === "progress") {
    h += row("Waiting on replies", c.waiting) + row("Waiting on you", c.parked) + row("Receipt chain", `${c.chain_ok ? '<span class="ok">intact</span>' : '<span class="warn">broken</span>'} · ${c.receipts}`);
    if (c.missed.length) h += `<p class="warn fine">Past the date: ${esc(c.missed.join("; "))}</p>`;
    if (c.share_url) h += `<p class="fine"><a href="${esc(c.share_url)}" target="_blank" rel="noopener" style="color:#9cc0ff">${esc(c.share_url)}</a></p>`;
  }
  el.innerHTML = h;
  el.querySelectorAll("button[data-tool]").forEach((b) => b.addEventListener("click", () => call(b.dataset.tool, JSON.parse(b.dataset.arg))));
  el.querySelectorAll("button[data-checkout]").forEach((b) => b.addEventListener("click", () => completeCheckout(b.dataset.checkout)));
}

async function completeCheckout(sessionId) {
  // What Alexa+ does after the customer confirms on the device: POST .../complete with an Idempotency-Key. Sent twice on
  // purpose, so the log shows the second call replayed, not re-charged.
  const key = "idem-" + crypto.randomUUID();
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`/checkout-sessions/${sessionId}/complete`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ case_id: state.caseId }) });
    const s = await r.json();
    log(`POST /checkout-sessions/${sessionId}/complete (Idempotency-Key ${key.slice(0, 13)}…) → ${s.status} ${s.order_id || ""} ${r.headers.get("Idempotent-Replayed") === "true" ? "(replayed)" : ""}`);
  }
  say("Ordered. The county mails them; I will tell you when they arrive.");
  await call("whats_due", { case_id: state.caseId });
}

// Routing what you type to a tool: a handful of rules standing in for Alexa+'s understanding.
const KINDS = [["bank", /bank|checking|savings|credit union/], ["pension", /pension|retire|401|calpers/], ["employer", /employer|job|work|hospital/], ["insurance", /insur|policy/],
  ["utilities", /power|electric|gas|water|utilit|pg&e/], ["phone_internet", /phone|internet|mobile|cell/], ["subscriptions", /gym|subscri|membership|netflix/], ["credit_cards", /credit card|visa|mastercard|amex/], ["vehicle", /car|truck|vehicle|camry/]];
function route(text) {
  const t = text.toLowerCase();
  if (/died|passed|death|start a case/.test(t) && !state.caseId) {
    const rel = /husband|wife|spouse|partner/.test(t) ? "spouse" : /mother|father|mom|dad|parent/.test(t) ? "child" : /brother|sister/.test(t) ? "sibling" : /son|daughter/.test(t) ? "parent" : /friend/.test(t) ? "friend" : "other";
    const kinds = KINDS.filter(([, re]) => re.test(t)).map(([k]) => k);
    const d = new Date(); d.setDate(d.getDate() - 7);
    return ["start_case", { date_of_death: d.toISOString().slice(0, 10), relationship: rel, has_will: !/no will|without a will/.test(t), account_kinds: kinds.length ? kinds : ["bank"] }];
  }
  if (!state.caseId) return [null, "Start by telling me what happened: who died, whether there is a will, and what accounts there were."];
  if (/approve|yes|go ahead|do it|allow/.test(t)) return state.lastDecision ? ["approve", { case_id: state.caseId, decision_id: state.lastDecision }] : [null, "Nothing is waiting for your approval."];
  if (/decline|no\b|not now|i will do it|leave it/.test(t)) return state.lastDecision ? ["decline", { case_id: state.caseId, decision_id: state.lastDecision, reason: "i_will_do_it_myself" }] : [null, "Nothing is waiting for your decision."];
  if (/certificate|copies|order/.test(t)) return ["order_certificates", { case_id: state.caseId }];
  if (/read|draft|letter|script/.test(t)) {
    const kind = KINDS.find(([, re]) => re.test(t));
    const map = { bank: "bank_notify", pension: "pension_notify", insurance: "insurance_claim", utilities: "utilities_notify", subscriptions: "subscription_cancel", credit_cards: "credit_card_notify", vehicle: "vehicle_reg5", employer: "employer_notify", phone_internet: "phone_internet_notify" };
    const id = /social security|ssa/.test(t) ? "ssa_report" : /equifax|experian|transunion|bureau/.test(t) ? "bureau_equifax" : /will|court/.test(t) ? "will_deliver" : kind ? map[kind[0]] : "bureau_equifax";
    return ["draft_notice", { case_id: state.caseId, task_id: id }];
  }
  if (/progress|how far|share|sibling|sister|brother/.test(t)) return ["share_progress", { case_id: state.caseId }];
  return ["whats_due", { case_id: state.caseId }];
}

async function refresh() {
  if (!state.caseId) return;
  const r = await fetch(`/api/cases/${state.caseId}`); if (!r.ok) return;
  const c = await r.json();
  $("today").textContent = c.today;
  $("chain").textContent = `${c.receipts.length} shown of ${c.progress.receipts}; chain ${c.chain_ok ? "intact" : "BROKEN"}.`;
  $("receipts").innerHTML = c.receipts.slice().reverse().map((x) => `<li>${esc(x.day)} ${esc(x.actor)} ${esc(x.action)} ${esc(x.task_id || "")} ${esc(x.note || "")} <span class="muted">${esc(x.hash.slice(0, 10))}</span></li>`).join("");
  const labelsEl = $("labels");
  if (!labelsEl.children.length) {
    labelsEl.innerHTML = c.ledger.rows.filter((row) => row.label).map((row) => `<label><span>${esc(row.title.split(" (")[0].slice(0, 28))}</span><input data-task="${esc(row.id)}" value="${esc(row.label)}"></label>`).join("") + `<button type="button" class="small" id="save-labels">Save</button>`;
    $("save-labels").addEventListener("click", async () => { const body = {}; labelsEl.querySelectorAll("input[data-task]").forEach((i) => (body[i.dataset.task] = i.value)); await fetch(`/api/cases/${state.caseId}/labels`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); log("labels saved (cards only)"); });
  }
}

$("ask").addEventListener("submit", async (e) => { e.preventDefault(); const text = $("utterance").value.trim(); if (!text) return; $("utterance").value = ""; log(`you: ${esc(text)}`);
  const [tool, args] = route(text); if (!tool) { say(args); return; } try { await call(tool, args); } catch (err) { log(`<span class="err">${esc(err.message)}</span>`); } });
$("chips").addEventListener("click", (e) => { const b = e.target.closest("button[data-say]"); if (b) { $("utterance").value = b.dataset.say; $("ask").requestSubmit(); } });
$("mute").addEventListener("click", () => { state.muted = !state.muted; $("mute").textContent = state.muted ? "🔇" : "🔊"; if (state.muted) speechSynthesis.cancel(); });
const advance = async (days) => { if (!state.caseId) return say("Start a case first."); const r = await fetch(`/api/cases/${state.caseId}/advance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }) }); const o = await r.json();
  log(`advanced ${days} day${days > 1 ? "s" : ""} → ${o.today}; replies: ${o.replies.join(", ") || "none"}; decisions open: ${o.open_decisions.length}`); await call("whats_due", { case_id: state.caseId }); };
$("next-day").addEventListener("click", () => advance(1)); $("next-week").addEventListener("click", () => advance(7));
$("objection").addEventListener("click", async () => { if (!state.caseId) return; await fetch(`/api/cases/${state.caseId}/objection`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task_id: "vehicle_reg5", who: "her brother wants to keep the car" }) }); log("heir objection recorded on vehicle_reg5"); await call("whats_due", { case_id: state.caseId }); });
$("letter-bank").addEventListener("click", async () => { if (!state.caseId) return; const c = await (await fetch(`/api/cases/${state.caseId}`)).json(); const bank = c.ledger.rows.find((r) => r.id.startsWith("bank_notify")); if (!bank) return say("There is no bank on the list."); await call("record_reply", { case_id: state.caseId, task_id: bank.id, kind: "needs_original" }); });
$("share").addEventListener("click", async () => { if (!state.caseId) return; const o = await call("share_progress", { case_id: state.caseId }); if (o.card && o.card.share_url) window.open(o.card.share_url, "_blank"); });
if (state.caseId) { ensureInit().then(() => call("whats_due", { case_id: state.caseId })).catch((e) => log(`<span class="err">${esc(e.message)}</span>`)); }
