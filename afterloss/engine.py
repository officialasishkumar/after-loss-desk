"""The agent loop, with the governor in front of every action.

Each day (`advance`): replies arrive; tasks that are ready and clerical are executed on the executor's standing authorisation;
tasks that need money, an original, a signature, a closure, or that an heir has objected to, raise one decision and wait.
`approve` executes the parked action; `decline` hands the task back to the executor. Everything is written to the receipt chain.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from . import adapters, drafts, governor, ledger, policy, speak, store

HORIZON_DAYS = 7


def start(*, date_of_death: str, state: str, relationship: str, has_will: bool, account_kinds: list[str],
          labels: dict[str, list[str]] | None = None, today: str | None = None) -> dict[str, Any]:
    case = ledger.build_case(date_of_death=date_of_death, state=state, relationship=relationship, has_will=has_will,
                             account_kinds=account_kinds, labels=labels, today=today)
    governor.receipt(case, actor="executor", action="start", note=f"{relationship}; will={has_will}; kinds={','.join(account_kinds)}")
    first = next(t for t in case["tasks"])
    governor.raise_decision(case, first, "D0", "Let me send the routine notices with copies on your behalf.",
                            "Routine means: notices enclosing a copy of the certificate, phone scripts for you, and chasing silent institutions. "
                            "I will still ask you before money leaves, an original leaves your hands, you must sign or visit, or anything that cannot be undone.", "authorise")
    first["status"] = "open"
    store.save(case)
    return case


def _summary_for(task: dict[str, Any], gate: str) -> tuple[str, str]:
    sp = task["spoken"]
    if gate == "D1":
        return (f"Money needs to go out for {sp}.", f"{task['title']}. {task['history'][-1]['text'] if task['history'] else ''}".strip())
    if gate == "D2" and task["rule"] == "will_deliver":
        return (f"The original will has to leave your hands: {sp}.", f"{task['title']}, in person, within the statutory 30 days. Keep the clerk's stamped receipt. {task['source']['quote']}")
    if gate == "D2":
        return (f"A certified original has to leave your hands for {sp}.", f"{task['title']}. Send one certified original by tracked mail; keep the tracking number on the card.")
    if gate == "D3":
        return (f"Your signature or a visit is needed for {sp}.", f"{task['title']}. {task['history'][-1]['text'] if task['history'] else drafts.phone_script(task)[:220]}".strip())
    if gate == "D4":
        return (f"Something that cannot be undone is next for {sp}.", f"{task['title']}. {task['history'][-1]['text'] if task['history'] else ''}".strip())
    if gate == "D5":
        return (f"An heir objects to {sp}. Hold it until you agree?", f"{task['title']} is on hold while the objection stands. Approve to hold; decline to proceed anyway.")
    return (f"Start {sp}?", task["title"])


def execute(case: dict[str, Any], task: dict[str, Any]) -> dict[str, Any]:
    """Try the task's next action through the governor. Returns the decision raised, or the executed task."""
    action = task["action"]
    verdict, gate = governor.evaluate(case, task, action)
    if verdict == "deny":
        governor.receipt(case, actor="agent", action="deny", task_id=task["id"], note=gate or "")
        return {"denied": gate}
    if verdict == "gate" and gate == "D0":
        return {"waiting_for_authorisation": True}  # one standing authorisation for the whole case, raised at start; never per task
    if verdict == "gate":
        summary, detail = _summary_for(task, gate)
        return governor.raise_decision(case, task, gate, summary, detail, action)
    return _do(case, task, action)


def _do(case: dict[str, Any], task: dict[str, Any], action: str) -> dict[str, Any]:
    d = drafts.draft(case, task)
    task["last_draft"] = d
    step = task.get("pending_step", 0)
    if action in ("notify", "chase", "escalate"):
        if action == "chase":
            task["history"].append({"day": case["today"], "event": "escalated", "text": "Sent again by certified mail, return receipt requested."})
        adapters.open_ticket(case, task, step)
    elif action == "send_original":
        case["originals_on_hand"] = max(case.get("originals_on_hand", 0) - 1, 0)
        task["history"].append({"day": case["today"], "event": "original sent", "text": "One certified original sent by tracked mail."})
        adapters.open_ticket(case, task, step)
    elif action in ("pay", "deliver_original", "sign", "appointment", "visit", "close", "elect"):
        task["history"].append({"day": case["today"], "event": action, "text": f"{action.replace('_', ' ')} done by the executor."})
        if action == "deliver_original":
            case["originals_on_hand"] = max(case.get("originals_on_hand", 0) - (1 if task["rule"] != "will_deliver" else 0), 0)
        task["status"], task["done_on"] = "done", case["today"]
    governor.receipt(case, actor="agent", action=f"execute:{action}", task_id=task["id"], note=d["channel"])
    return task


def tick(case: dict[str, Any]) -> dict[str, Any]:
    """One day's work. Returns what happened for the card."""
    changed = adapters.deliver_replies(case)
    for t in changed:
        if t["rule"] == "certificates_order" and t["status"] == "done":
            case["originals_on_hand"] = case.get("originals_on_hand", 0) + case.get("originals_ordered", 0)
            governor.receipt(case, actor="institution", action="delivered", task_id=t["id"], note=f"{case.get('originals_ordered', 0)} certified originals on hand")
        else:
            governor.receipt(case, actor="institution", action="reply", task_id=t["id"], note=t["history"][-1]["event"])
    today = date.fromisoformat(case["today"])
    for t in case["tasks"]:
        if t["status"] != "open" or date.fromisoformat(t["earliest"]) > today:
            continue
        if t["rule"] == "certificates_order":
            continue  # bought through checkout, never auto-executed
        if governor.GATES.get(t["action"]) and t["deadline"] and not t.get("pending_step") and not t["history"]:
            # a gated task with a date is raised when its date is near, not on day one: fewer interruptions, none missed
            if (date.fromisoformat(t["deadline"]) - today).days > HORIZON_DAYS:
                continue
        execute(case, t)
    return {"replies": [t["id"] for t in changed], "open_decisions": governor.open_decisions(case)}


def advance(case: dict[str, Any], days: int = 1) -> dict[str, Any]:
    out = {}
    for _ in range(days):
        case["today"] = (date.fromisoformat(case["today"]) + timedelta(days=1)).isoformat()
        out = tick(case)
    store.save(case)
    return out


def approve(case: dict[str, Any], decision_id: str) -> dict[str, Any] | None:
    d = next((x for x in case["decisions"] if x["id"] == decision_id and x["status"] == "raised"), None)
    if not d:
        return None
    d["status"], d["resolved_on"], d["resolved_by"] = "approved", case["today"], "executor"
    governor.receipt(case, actor="executor", action="approve", task_id=d["task_id"], decision_id=d["id"])
    task = next(t for t in case["tasks"] if t["id"] == d["task_id"])
    if d["gate"] == "D0":
        case["standing_authorisation"] = True
        task["status"] = "open"
        tick(case)
    elif d["gate"] == "D5":
        task["status"] = "held"
    else:
        task["status"] = "open"
        _do(case, task, d["action"])
    store.save(case)
    return d


def decline(case: dict[str, Any], decision_id: str, reason: str = "executor will handle it") -> dict[str, Any] | None:
    d = next((x for x in case["decisions"] if x["id"] == decision_id and x["status"] == "raised"), None)
    if not d:
        return None
    d["status"], d["resolved_on"], d["reason"] = "declined", case["today"], reason
    governor.receipt(case, actor="executor", action="decline", task_id=d["task_id"], decision_id=d["id"], note=reason)
    task = next(t for t in case["tasks"] if t["id"] == d["task_id"])
    if d["gate"] == "D5":
        case["objections"] = [o for o in case["objections"] if o != task["id"]]
        task["status"] = "open"
        execute(case, task)
    elif d["gate"] == "D0":
        task["status"] = "open"
    else:
        task["status"] = "held"
    store.save(case)
    return d


def object_to(case: dict[str, Any], task_id: str, who: str = "an heir") -> dict[str, Any]:
    task = next(t for t in case["tasks"] if t["id"] == task_id)
    if task_id not in case["objections"]:
        case["objections"].append(task_id)
    governor.receipt(case, actor="heir", action="objection", task_id=task_id, note=who)
    d = execute(case, task)
    store.save(case)
    return d


def lift_objection(case: dict[str, Any], task_id: str, note: str = "the heirs agreed") -> dict[str, Any]:
    """The heirs have agreed: the objection is withdrawn, the task comes off hold and goes back through the governor."""
    task = next(t for t in case["tasks"] if t["id"] == task_id)
    case["objections"] = [o for o in case["objections"] if o != task_id]
    governor.receipt(case, actor="heir", action="objection_withdrawn", task_id=task_id, note=note)
    task["status"] = "open"
    out = execute(case, task)
    store.save(case)
    return out


def record_reply(case: dict[str, Any], task_id: str, kind: str, text: str = "") -> dict[str, Any]:
    """The executor reports what an institution said (a letter arrived). Kinds: done, needs_original, needs_signature, final_bill, silence."""
    task = next(t for t in case["tasks"] if t["id"] == task_id)
    follow = {"done": None, "needs_original": "send_original", "needs_signature": "sign", "final_bill": "pay", "silence": "chase", "ready_to_close": "close", "election": "elect"}[kind]
    task["history"].append({"day": case["today"], "event": f"reply: {kind}", "text": text or kind.replace("_", " ")})
    if task.get("ticket"):
        task["ticket"]["reply"] = {"on": case["today"], "kind": kind, "text": text}
    governor.receipt(case, actor="institution", action="reply", task_id=task_id, note=kind)
    if follow is None:
        task["status"], task["done_on"] = "done", case["today"]
    else:
        task["status"], task["action"] = "open", follow
        task["pending_step"] = (task.get("ticket") or {}).get("step", 0) + 1
        execute(case, task)
    store.save(case)
    return task


# ---- cards: the structured shape both the MCP App and the web client render -----------------------------------------

def _days_left(t: dict[str, Any], today: str) -> int | None:
    return (date.fromisoformat(t["deadline"]) - date.fromisoformat(today)).days if t["deadline"] else None


def ledger_card(case: dict[str, Any]) -> dict[str, Any]:
    rows = [{"id": t["id"], "title": t["title"], "label": t["label"], "status": t["status"], "deadline": t["deadline"], "deadline_kind": t["deadline_kind"],
             "days_left": _days_left(t, case["today"]), "channel": t["channel"], "needs_original": t["needs_original"], "source": t["source"]["url"]} for t in case["tasks"]]
    done = sum(1 for t in case["tasks"] if t["status"] == "done")
    return {"kind": "ledger", "title": f"{len(rows) - done} open, {done} done", "today": case["today"], "date_of_death": case["date_of_death"], "state": case["state_name"],
            "originals_needed": ledger.originals_needed(case), "originals_on_hand": case.get("originals_on_hand", 0), "rows": rows,
            "action": {"label": "Allow routine notices", "tool": "approve", "decision_id": next((d["id"] for d in case["decisions"] if d["gate"] == "D0" and d["status"] == "raised"), None)}}


def due_card(case: dict[str, Any]) -> dict[str, Any]:
    items = ledger.due(case, horizon_days=HORIZON_DAYS)
    dec = governor.open_decisions(case)
    return {"kind": "due", "title": f"{len(dec)} to decide, {len(items)} due this week", "today": case["today"],
            "decisions": [{"id": d["id"], "gate": d["gate"], "gate_text": d["gate_text"], "summary": d["summary"], "detail": d["detail"], "task_id": d["task_id"]} for d in dec],
            "items": [{"id": t["id"], "title": t["title"], "label": t["label"], "days_left": t["days_left"], "channel": t["channel"]} for t in items],
            "waiting": [{"id": t["id"], "title": t["title"], "label": t["label"], "reply_due": t["ticket"]["reply_due"]} for t in case["tasks"] if t["status"] == "waiting" and t.get("ticket")],
            "action": {"label": "Approve", "tool": "approve", "decision_id": dec[0]["id"] if dec else None}}


def progress_card(case: dict[str, Any]) -> dict[str, Any]:
    total = len(case["tasks"])
    done = sum(1 for t in case["tasks"] if t["status"] == "done")
    waiting = sum(1 for t in case["tasks"] if t["status"] == "waiting")
    return {"kind": "progress", "title": f"{done} of {total} done", "today": case["today"], "done": done, "waiting": waiting,
            "parked": len(governor.open_decisions(case)), "total": total, "missed": [t["title"] for t in ledger.missed_deadlines(case)],
            "receipts": len(case["receipts"]), "chain_ok": governor.verify_chain(case),
            "recent": [{"day": r["day"], "who": r["actor"], "what": r["action"], "note": r["note"][:80]} for r in case["receipts"][-8:]]}
