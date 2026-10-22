"""The Alexa+ add-on: an MCP server (spec 2025-11-25, Streamable HTTP) whose tools are one customer intent each.

Alexa+ is the MCP client: it handles speech and calls these tools. Every result carries `speak` (short, checked against the
voice policy) and `card` (structured; rendered by the MCP App resource `ui://afterloss/card.html` on hosts that support MCP
Apps, by Alexa's native components otherwise, and by the simulated client in `site/`).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Literal

from mcp.server.fastmcp import FastMCP

from . import checkout, engine, governor, ledger, policy, speak, store

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://127.0.0.1:8300").rstrip("/")
CARD_URI = "ui://afterloss/card.html"
UI = {"ui": {"resourceUri": CARD_URI}}
mcp = FastMCP("after-loss-desk", instructions="Helps an executor settle a loved one's affairs over months: who to tell, by when, with what, and asks only at five gates.",
              host="0.0.0.0", port=int(os.environ.get("PORT", "8300")), streamable_http_path="/mcp", stateless_http=True, json_response=True)

Relationship = Literal["spouse", "child", "sibling", "parent", "friend", "other"]
Kind = Literal["bank", "pension", "employer", "insurance", "utilities", "phone_internet", "subscriptions", "credit_cards", "vehicle"]
State = Literal["CA"]
Reason = Literal["i_will_do_it_myself", "not_now", "wrong_institution", "ask_my_sibling"]
ReplyKind = Literal["done", "needs_original", "needs_signature", "final_bill", "silence", "ready_to_close", "election"]


def _case(case_id: str) -> dict[str, Any]:
    c = store.load(case_id)
    if not c:
        raise ValueError("No case with that id. Start one first.")
    return c


@mcp.tool(name="start_case", title="Start a case", meta=UI)
def start_case(date_of_death: str, relationship: Relationship, has_will: bool, account_kinds: list[Kind], state: State = "CA") -> dict[str, Any]:
    """Start settling someone's affairs. Needs only: the date of death, your relationship, whether there is a will, and which
    kinds of accounts exist. No names, no account numbers: those go on the web client, never by voice."""
    case = engine.start(date_of_death=date_of_death, state=state, relationship=relationship, has_will=has_will, account_kinds=list(account_kinds))
    card = engine.ledger_card(case)
    return {"case_id": case["id"], "speak": speak.ledger_summary(case, card["originals_needed"]) + " " + policy.CRISIS_LINE, "card": card,
            "web": f"{PUBLIC_URL}/?case={case['id']}"}


@mcp.tool(name="whats_due", title="What is due", meta=UI)
def whats_due(case_id: str) -> dict[str, Any]:
    """What needs you this week: decisions waiting for your say-so, then notices due, then what we are waiting on."""
    case = _case(case_id)
    card = engine.due_card(case)
    items = ledger.due(case, horizon_days=engine.HORIZON_DAYS)
    return {"case_id": case_id, "speak": speak.due_summary(case, items, governor.open_decisions(case)), "card": card}


@mcp.tool(name="draft_notice", title="Draft a notice", meta=UI)
def draft_notice(case_id: str, task_id: str) -> dict[str, Any]:
    """Read the draft letter, form notes or phone script for one task on the list."""
    case = _case(case_id)
    task = next((t for t in case["tasks"] if t["id"] == task_id), None)
    if not task:
        return {"error": "No task with that id."}
    from . import drafts
    d = drafts.draft(case, task)
    task["last_draft"] = d
    store.save(case)
    return {"case_id": case_id, "speak": policy.assert_speakable(f"Here is {task['spoken']}, as a {('phone script' if d['channel'] == 'phone' else 'letter' if d['channel'] == 'mail' else 'note')}. It is on your screen.", case),
            "card": {"kind": "draft", "title": task["title"], "label": task["label"], "channel": d["channel"], "text": d["text"], "facts": d["facts"], "source": task["source"], "task_id": task_id}}


@mcp.tool(name="approve", title="Approve a decision", meta=UI)
def approve(case_id: str, decision_id: str) -> dict[str, Any]:
    """Approve one of the decisions that is waiting for you. The action is then carried out and written to the receipt log."""
    case = _case(case_id)
    d = engine.approve(case, decision_id)
    if not d:
        return {"error": "No open decision with that id."}
    return {"case_id": case_id, "speak": policy.assert_speakable("Done. I have written it down. " + speak.due_summary(case, ledger.due(case, horizon_days=engine.HORIZON_DAYS), governor.open_decisions(case)), case),
            "card": engine.due_card(case)}


@mcp.tool(name="decline", title="Decline a decision", meta=UI)
def decline(case_id: str, decision_id: str, reason: Reason = "i_will_do_it_myself") -> dict[str, Any]:
    """Decline a decision: the task goes back to you and the agent will not touch it."""
    case = _case(case_id)
    d = engine.decline(case, decision_id, reason.replace("_", " "))
    if not d:
        return {"error": "No open decision with that id."}
    return {"case_id": case_id, "speak": policy.assert_speakable("Understood. I have left that one with you.", case), "card": engine.due_card(case)}


@mcp.tool(name="record_reply", title="Record a reply", meta=UI)
def record_reply(case_id: str, task_id: str, kind: ReplyKind) -> dict[str, Any]:
    """Tell the desk what an institution replied (a letter came): done, needs an original, needs a signature, a final bill, silence."""
    case = _case(case_id)
    if not any(t["id"] == task_id for t in case["tasks"]):
        return {"error": "No task with that id."}
    engine.record_reply(case, task_id, kind)
    return {"case_id": case_id, "speak": policy.assert_speakable("Noted. " + speak.due_summary(case, ledger.due(case, horizon_days=engine.HORIZON_DAYS), governor.open_decisions(case)), case), "card": engine.due_card(case)}


@mcp.tool(name="order_certificates", title="Order certified copies", meta=UI)
def order_certificates(case_id: str) -> dict[str, Any]:
    """Count how many certified copies of the death certificate the open list needs, quote the county fee and open an Alexa+
    checkout session. Alexa+ then confirms the payment with you; the add-on never handles the card or PIN."""
    case = _case(case_id)
    q = checkout.quote(case)
    if q["count"] == 0:
        return {"case_id": case_id, "speak": policy.assert_speakable("You already have enough certified copies for the open list.", case), "card": {"kind": "quote", "title": "No copies needed", **q}}
    s = checkout.create_session(case)
    store.save(case)
    return {"case_id": case_id, "speak": speak.quote_summary(q["count"], q["total"]),
            "card": {"kind": "quote", "title": f"{q['count']} certified copies", **q, "session_id": s["id"], "checkout": {"create": f"{PUBLIC_URL}/checkout-sessions", "complete": f"{PUBLIC_URL}/checkout-sessions/{s['id']}/complete"},
                     "handoff": "Alexa+ handles confirmation, payment instrument and PIN"}}


@mcp.tool(name="share_progress", title="Share progress", meta=UI)
def share_progress(case_id: str) -> dict[str, Any]:
    """A read-only progress page for a sibling or helper: what is done, what is waiting, what is parked. No documents, no numbers."""
    case = _case(case_id)
    card = engine.progress_card(case)
    return {"case_id": case_id, "speak": policy.assert_speakable(f"{card['done']} of {card['total']} done, {card['waiting']} waiting on replies, {card['parked']} waiting on you. The link is on your screen.", case),
            "card": {**card, "share_url": f"{PUBLIC_URL}/share/{case['share_token']}"}}


@mcp.resource(CARD_URI, name="After Loss Desk card", mime_type="text/html;profile=mcp-app", meta={"ui": {"prefersBorder": True}})
def card_resource() -> str:
    """The MCP App that renders every tool result as one card: a title, one or two fields, one action."""
    return (ROOT / "mcp-app" / "card.html").read_text()


def run() -> None:
    mcp.run(transport="streamable-http")


if __name__ == "__main__":
    run()
