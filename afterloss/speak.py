"""Voice phrasing: short, plain, under thirty seconds, at most five items, no private data. Cards carry the rest."""

from __future__ import annotations

from typing import Any

from .policy import LEGAL_LINE, assert_speakable


def _n(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def ledger_summary(case: dict[str, Any], originals: int) -> str:
    from datetime import date
    open_tasks = [t for t in case["tasks"] if t["status"] not in ("done", "cancelled")]
    statutory = sorted((t for t in open_tasks if t["deadline_kind"] == "statutory" and t["deadline"]), key=lambda t: t["deadline"])
    s = (f"I have made your list: {_n(len(open_tasks), 'thing', 'things')}. "
         f"You will need about {_n(originals, 'certified copy', 'certified copies')}. ")
    if statutory:
        left = (date.fromisoformat(statutory[0]["deadline"]) - date.fromisoformat(case["today"])).days
        when = f"overdue by {_n(-left, 'day', 'days')}" if left < 0 else "due today" if left == 0 else f"within {_n(left, 'day', 'days')}"
        s += f"One has a firm date: {statutory[0]['spoken']}, {when}. {LEGAL_LINE} "
    s += "Shall I send the routine notices? I will still ask before money, originals, signatures or closures."
    return assert_speakable(s, case)


def due_summary(case: dict[str, Any], items: list[dict[str, Any]], open_decisions: list[dict[str, Any]]) -> str:
    if not items and not open_decisions:
        return assert_speakable("Nothing is due this week. I am waiting on replies and will tell you when one needs you.", case)
    parts = []
    if open_decisions:
        parts.append(f"{_n(len(open_decisions), 'thing needs', 'things need')} your say-so: " + "; ".join(d["summary"].rstrip(".") for d in open_decisions[:3]) + ".")
    if items:
        names = [t["spoken"] for t in items[:5 - min(len(open_decisions), 3)]]
        overdue = [t for t in items if t["days_left"] is not None and t["days_left"] < 0]
        parts.append(("Also due: " if open_decisions else "This week: ") + "; ".join(names) + ".")
        if overdue:
            parts.append(f"{_n(len(overdue), 'item is', 'items are')} past the date I had; I have moved it to the top.")
    return assert_speakable(" ".join(parts), case)


def decision_prompt(d: dict[str, Any], task: dict[str, Any]) -> str:
    s = f"{d['summary']} This is {d['gate_text']}. Say approve, or decline."
    if task.get("legal"):
        s += " " + LEGAL_LINE
    return assert_speakable(s)


def quote_summary(count: int, total: float) -> str:
    return assert_speakable(f"The open list will use {_n(count, 'certified copy', 'certified copies')}. That is ${total:.2f} at the county's fee. Shall I order them? Alexa will confirm the payment with you.")
