"""Simulated institutions. Each notice the agent sends opens a ticket; replies arrive on later days with the kinds of answers
real institutions give: "we need a certified original", "sign and notarise this form", "final bill", "choose lump sum or
annuity", or silence that needs a chase. The behaviours are per category and deterministic, so the eight-week simulation is
replayable and its scoreboard means something. A real deployment replaces this module with letters, forms and phone calls.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

# category -> list of (days after send, reply kind, follow-up action or None, text shown on the card)
BEHAVIOUR: dict[str, list[tuple[int, str, str | None, str]]] = {
    "government": [(3, "acknowledged", None, "Reported. They will stop the next payment and note the date of death.")],
    "court": [(0, "acknowledged", None, "Filed with the clerk; keep the stamped receipt.")],
    "documents": [(5, "delivered", None, "Certified copies delivered by mail.")],
    "credit": [(10, "flagged", None, "File marked 'deceased, do not issue credit'. A copy of the report was mailed to the executor.")],
    "bank": [(5, "needs_original", "send_original", "They will release the account once they hold a certified original of the death certificate."),
             (7, "ready_to_close", "close", "Original received. The account can be closed and the balance paid to the estate account; say the word.")],
    "pension": [(6, "needs_signature", "sign", "They need the survivor form signed and notarised before any benefit is paid.")],
    "employer": [(4, "acknowledged", None, "Final pay and benefits paperwork will be mailed to the executor.")],
    "insurance": [(8, "needs_original", "send_original", "Claim opened. They need a certified original and the signed claim form."),
                  (10, "election", "elect", "Claim approved. Choose a lump sum or an annuity; this cannot be changed later.")],
    "utilities": [(3, "final_bill", "pay", "Final bill issued: $142.17. The account closes when it is paid.")],
    "services": [(21, "silence", "chase", "No reply after three weeks. Send the cancellation again by certified mail."),
                 (5, "cancelled", None, "Cancelled, effective the date of the first notice.")],
    "vehicle": [(0, "acknowledged", None, "Title transferred.")],
}


def open_ticket(case: dict[str, Any], task: dict[str, Any], step: int = 0) -> dict[str, Any]:
    """Create or advance the ticket for a task after a notice is sent."""
    steps = BEHAVIOUR.get(task["category"], [(3, "acknowledged", None, "Acknowledged.")])
    step = min(step, len(steps) - 1)
    days, kind, follow, text = steps[step]
    if task.get("chase_after_days") and step == 0:
        days = task["chase_after_days"]
    due = (date.fromisoformat(case["today"]) + timedelta(days=days)).isoformat()
    task["ticket"] = {"step": step, "sent_on": case["today"], "reply_due": due, "reply": None, "kind_expected": kind, "follow": follow, "text": text}
    task["status"] = "waiting"
    return task["ticket"]


def deliver_replies(case: dict[str, Any]) -> list[dict[str, Any]]:
    """Materialise every reply whose day has come. Returns the tasks that changed."""
    today = date.fromisoformat(case["today"])
    changed = []
    for t in case["tasks"]:
        tk = t.get("ticket")
        if not tk or tk.get("reply") or date.fromisoformat(tk["reply_due"]) > today:
            continue
        tk["reply"] = {"on": case["today"], "kind": tk["kind_expected"], "text": tk["text"]}
        t["history"].append({"day": case["today"], "event": f"reply: {tk['kind_expected']}", "text": tk["text"]})
        if tk["follow"] is None:
            t["status"] = "done"
            t["done_on"] = case["today"]
        else:
            t["status"] = "open"
            t["action"] = tk["follow"]
            t["pending_step"] = tk["step"] + 1
        changed.append(t)
    return changed
