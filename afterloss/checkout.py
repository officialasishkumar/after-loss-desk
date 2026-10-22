"""Certified copies through Alexa+ checkout. The add-on quotes, and exposes the REST checkout endpoints Alexa+ calls:
POST /checkout-sessions (create), PATCH /checkout-sessions/{id} (update fulfilment), POST /checkout-sessions/{id}/complete.
Alexa+ handles confirmation, payment instrument and PIN; it sends an Idempotency-Key on Create and Complete, and we must return
the same result for the same key for 24 hours. Session shapes follow the Universal Commerce Protocol fields the docs name:
line_items, totals, fulfillment, status. (Source: developer.amazon.com, implement-checkout-endpoints, 19 Aug 2026.)
"""

from __future__ import annotations

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


def create_session(case: dict[str, Any], count: int | None = None) -> dict[str, Any]:
    q = quote(case)
    n = count if count is not None else q["count"]
    session = {"id": "cs_" + secrets.token_hex(5), "case_id": case["id"], "status": "created",
               "line_items": [{"id": "death-certificate-certified-copy", "title": "Certified copy of death certificate", "quantity": n, "unit_price": {"amount": q["unit_price"], "currency": q["currency"]}}],
               "totals": [{"type": "subtotal", "amount": round(n * q["unit_price"], 2)}, {"type": "fees", "amount": q["processing"] if n else 0.0}, {"type": "total", "amount": round(n * q["unit_price"] + (q["processing"] if n else 0.0), 2)}],
               "fulfillment": {"method": "mail", "destination": "executor address on file"}, "currency": q["currency"]}
    case["checkout_sessions"].append(session)
    task = next((t for t in case["tasks"] if t["rule"] == "certificates_order"), None)
    if task:
        governor.raise_decision(case, task, "D1", f"Order {n} certified copies for ${session['totals'][-1]['amount']:.2f}.",
                                "Alexa+ confirms the payment with you; the county mails the copies.", "pay")
    governor.receipt(case, actor="agent", action="checkout:create", task_id=task["id"] if task else None, note=session["id"])
    return session


def update_session(case: dict[str, Any], session_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    s = next((x for x in case["checkout_sessions"] if x["id"] == session_id), None)
    if not s or s["status"] == "completed":
        return s
    if "fulfillment" in patch:
        s["fulfillment"].update(patch["fulfillment"])
    s["status"] = "updated"
    return s


def complete_session(case: dict[str, Any], session_id: str) -> dict[str, Any] | None:
    """Alexa+ calls this after the customer confirmed on the device: that confirmation is the executor's D1 approval."""
    s = next((x for x in case["checkout_sessions"] if x["id"] == session_id), None)
    if not s:
        return None
    if s["status"] == "completed":
        return s
    task = next((t for t in case["tasks"] if t["rule"] == "certificates_order"), None)
    if task:
        for d in case["decisions"]:
            if d["task_id"] == task["id"] and d["gate"] == "D1" and d["status"] == "raised":
                d["status"], d["resolved_on"], d["resolved_by"] = "approved", case["today"], "alexa_checkout_confirmation"
        task["status"] = "waiting"
        from .adapters import open_ticket
        open_ticket(case, task)
        case["originals_ordered"] = case.get("originals_ordered", 0) + s["line_items"][0]["quantity"]
        governor.receipt(case, actor="alexa", action="approve", task_id=task["id"], note="customer confirmed checkout on device")
        governor.receipt(case, actor="agent", action="execute:pay", task_id=task["id"], note=f"{session_id} completed")
    s["status"] = "completed"
    s["order_id"] = "ord_" + secrets.token_hex(4)
    return s
