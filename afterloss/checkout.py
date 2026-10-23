"""Certified copies through Alexa+ checkout. The add-on quotes, and exposes the REST checkout endpoints Alexa+ calls:
POST /checkout-sessions (create), PATCH /checkout-sessions/{id} (update fulfilment), POST /checkout-sessions/{id}/complete.
Alexa+ handles confirmation, payment instrument and PIN; it sends an Idempotency-Key on Create and Complete, and we must return
the same result for the same key for 24 hours. Session shapes follow the Universal Commerce Protocol fields the docs name:
line_items, totals, fulfillment, status. (Source: developer.amazon.com, implement-checkout-endpoints, 19 Aug 2026.)
"""

from __future__ import annotations

import json
import secrets
from typing import Any

from . import governor, ledger, store

PROCESSING_FEE = 13.95  # VitalChek-style processing per order (Galveston County fee schedule, accessed 2026-10-22)


def quote(case: dict[str, Any]) -> dict[str, Any]:
    count = max(ledger.originals_needed(case) - case.get("originals_on_hand", 0), 0)
    fee = case["certificate_fee"]["amount"]
    subtotal = round(count * fee, 2)
    total = round(subtotal + (PROCESSING_FEE if count else 0), 2)
    return {"count": count, "unit_price": fee, "processing": PROCESSING_FEE if count else 0.0, "subtotal": subtotal, "total": total,
            "currency": case["certificate_fee"]["currency"], "fee_note": case["certificate_fee"]["note"], "fee_source": case["certificate_fee"]["source"]}


MAX_COPIES = 30


class CheckoutRefused(Exception):
    """The governor or the quote does not allow this checkout step (the web layer answers 409)."""


def _task(case: dict[str, Any]) -> dict[str, Any] | None:
    return next((t for t in case["tasks"] if t["rule"] == "certificates_order"), None)


def _total(n: int, unit: float, processing: float) -> float:
    return round(n * unit + (processing if n else 0.0), 2)


def create_session(case: dict[str, Any], count: int | None = None) -> dict[str, Any]:
    q = quote(case)
    if count is None and not q["count"]:
        raise ValueError("no certified copies are needed")
    n = q["count"] if count is None else count
    if isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= MAX_COPIES:
        raise ValueError(f"quantity must be a whole number from 1 to {MAX_COPIES}")
    total = _total(n, q["unit_price"], PROCESSING_FEE)
    task = _task(case)
    for old in case["checkout_sessions"]:  # one open order per case: a new quote replaces the old one and its card
        if old["status"] in ("created", "updated"):
            old["status"] = "cancelled"
            for d in case["decisions"]:
                if d["id"] == old.get("decision_id") and d["status"] == "raised":
                    d["status"] = "superseded"
    session = {"id": "cs_" + secrets.token_hex(5), "case_id": case["id"], "status": "created",
               "line_items": [{"id": "death-certificate-certified-copy", "title": "Certified copy of death certificate", "quantity": n, "unit_price": {"amount": q["unit_price"], "currency": q["currency"]}}],
               "totals": [{"type": "subtotal", "amount": round(n * q["unit_price"], 2)}, {"type": "fees", "amount": PROCESSING_FEE}, {"type": "total", "amount": total}],
               "fulfillment": {"method": "mail", "destination": "executor address on file"}, "currency": q["currency"]}
    if task:
        d = governor.raise_decision(case, task, "D1", f"Order {n} certified copies for ${total:.2f}.", "Alexa+ confirms the payment with you; the county mails the copies.", "pay")
        d.update(session_id=session["id"], quantity=n, total=total, summary=f"Order {n} certified copies for ${total:.2f}.")
        session["decision_id"] = d["id"]
    case["checkout_sessions"].append(session)
    governor.receipt(case, actor="agent", action="checkout:create", task_id=task["id"] if task else None, note=f"{session['id']}: {n} copies, ${total:.2f}")
    return session


def update_session(case: dict[str, Any], session_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    s = next((x for x in case["checkout_sessions"] if x["id"] == session_id), None)
    if not s or s["status"] in ("completed", "cancelled"):
        return s
    f = patch.get("fulfillment")
    if f is not None:
        if not isinstance(f, dict) or len(json.dumps(f)) > 1000:
            raise ValueError("fulfillment must be a small object")
        s["fulfillment"].update({k: v for k, v in f.items() if k in ("method", "destination")})
    s["status"] = "updated"
    return s


def _approved_quote(case: dict[str, Any], s: dict[str, Any], task: dict[str, Any]) -> dict[str, Any]:
    """The D1 this session was quoted under must still stand, match the session's amount, and no heir objection may stand."""
    if s["status"] == "cancelled":
        raise CheckoutRefused("this checkout session was replaced or declined")
    if governor.evaluate(case, task, "pay") != ("gate", "D1"):
        raise CheckoutRefused("an heir has objected to this order; it is on hold")
    d = next((x for x in case["decisions"] if x["id"] == s.get("decision_id")), None)
    if not d or d["gate"] != "D1" or d["status"] not in ("raised", "approved"):
        raise CheckoutRefused("the order was declined or is no longer open")
    item = s["line_items"][0]
    total = _total(item["quantity"], item["unit_price"]["amount"], s["totals"][1]["amount"])
    if d.get("session_id") != s["id"] or d.get("quantity") != item["quantity"] or d.get("total") != total or s["totals"][-1]["amount"] != total or not 1 <= item["quantity"] <= MAX_COPIES:
        raise CheckoutRefused("the amount does not match what was quoted")
    return d


def complete_session(case: dict[str, Any], session_id: str) -> dict[str, Any] | None:
    """Alexa+ calls this after the customer confirmed on the device: that confirmation approves the D1 raised for this session's
    quantity and total. Refused when the D1 was declined or replaced, the amount changed, or an heir objects."""
    s = next((x for x in case["checkout_sessions"] if x["id"] == session_id), None)
    if not s:
        return None
    if s["status"] == "completed":
        return s
    task = _task(case)
    if task:
        d = _approved_quote(case, s, task)
        if d["status"] == "raised":
            d["status"], d["resolved_on"], d["resolved_by"] = "approved", case["today"], "alexa_checkout_confirmation"
            governor.receipt(case, actor="alexa", action="approve", task_id=task["id"], decision_id=d["id"], note="customer confirmed checkout on device")
        task["status"] = "waiting"
        from .adapters import open_ticket
        open_ticket(case, task)
        case["originals_ordered"] = case.get("originals_ordered", 0) + s["line_items"][0]["quantity"]
        governor.receipt(case, actor="agent", action="execute:pay", task_id=task["id"], note=f"{session_id} completed: {s['line_items'][0]['quantity']} copies, ${s['totals'][-1]['amount']:.2f}")
    s["status"] = "completed"
    s["order_id"] = "ord_" + secrets.token_hex(4)
    return s
