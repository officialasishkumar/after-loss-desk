"""The ledger engine: deterministic. Which notices exist, in what channel, by when, and how many certified originals they need,
all from a versioned rule table with a source line per row. The model never decides any of this.

A case starts with facts the executor gives by voice (relationship, state, will or not, which kinds of accounts exist) and
institution labels typed on the web client. The engine expands the rule table into tasks, computes every deadline from the
date of death, and counts the originals the ledger will consume.
"""

from __future__ import annotations

import json
import secrets
from datetime import date, timedelta
from pathlib import Path
from typing import Any

RULES_DIR = Path(__file__).resolve().parent / "rules"
ACCOUNT_KINDS = ("bank", "pension", "employer", "insurance", "utilities", "phone_internet", "subscriptions", "credit_cards", "vehicle")
RELATIONSHIPS = ("spouse", "child", "sibling", "parent", "friend", "other")
DEFAULT_LABELS = {"bank": "Bank", "pension": "Pension plan", "employer": "Employer", "insurance": "Life insurer", "utilities": "Power company",
                  "phone_internet": "Phone and internet", "subscriptions": "Gym or subscription", "credit_cards": "Credit card", "vehicle": "Vehicle"}


def rules(state: str) -> dict[str, Any]:
    p = RULES_DIR / f"{state.lower()}.json"
    if not p.exists():
        p = RULES_DIR / "california.json"
    return json.loads(p.read_text())


def _applies(rule: dict[str, Any], relationship: str, has_will: bool, kinds: list[str]) -> list[str | None]:
    """Return the account kinds this rule produces a task for (None = one task, not per account)."""
    a = rule["applies"]
    if a == "always":
        return [None]
    if a == "has_will":
        return [None] if has_will else []
    if a.startswith("relationship:"):
        return [None] if relationship in a.split(":", 1)[1].split(",") else []
    if a.startswith("kind:"):
        kind = a.split(":", 1)[1]
        return [kind] if kind in kinds else []
    return []


def build_case(*, date_of_death: str, state: str, relationship: str, has_will: bool, account_kinds: list[str],
               labels: dict[str, list[str]] | None = None, today: str | None = None) -> dict[str, Any]:
    """Create a case document with its task ledger. `labels` maps an account kind to the executor's labels for each account."""
    dod = date.fromisoformat(date_of_death)
    if relationship not in RELATIONSHIPS:
        raise ValueError(f"relationship must be one of {RELATIONSHIPS}")
    kinds = [k for k in account_kinds if k in ACCOUNT_KINDS]
    labels = labels or {}
    table = rules(state)
    tasks: list[dict[str, Any]] = []
    for rule in table["tasks"]:
        for kind in _applies(rule, relationship, has_will, kinds):
            names = labels.get(kind) or ([DEFAULT_LABELS[kind]] if kind else [None])
            for n, label in enumerate(names, 1):
                tid = rule["id"] if kind is None or len(names) == 1 else f"{rule['id']}_{n}"
                deadline = (dod + timedelta(days=rule["deadline_days"])).isoformat() if rule.get("deadline_days") else None
                earliest = (dod + timedelta(days=rule["earliest_day"])).isoformat() if rule.get("earliest_day") else dod.isoformat()
                tasks.append({"id": tid, "rule": rule["id"], "title": rule["title"], "label": label, "category": rule["category"], "channel": rule["channel"],
                              "action": rule["action"], "deadline": deadline, "deadline_kind": rule["deadline_kind"], "earliest": earliest,
                              "needs_original": rule["needs_original"], "legal": rule.get("legal", False), "spoken": rule["spoken"],
                              "chase_after_days": rule.get("chase_after_days"), "status": "open", "ticket": None, "history": [], "source": rule["source"]})
    return {"id": secrets.token_hex(6), "share_token": secrets.token_urlsafe(12), "state": table["state"], "state_name": table["state_name"],
            "date_of_death": dod.isoformat(), "today": today or date.today().isoformat(), "relationship": relationship, "has_will": has_will,
            "account_kinds": kinds, "tasks": tasks, "decisions": [], "receipts": [], "checkout_sessions": [], "originals_on_hand": 0,
            "standing_authorisation": False, "objections": [], "rules_updated": table["updated"], "certificate_fee": table["certificate_fee"]}


def originals_needed(case: dict[str, Any]) -> int:
    """Certified originals the open ledger will consume: one per institution that asks for an original, plus one for the court
    if there is a will, plus two spare (institutions lose them)."""
    n = sum(1 for t in case["tasks"] if t["needs_original"] and t["status"] not in ("done", "cancelled"))
    return n + (1 if case["has_will"] else 0) + 2


def due(case: dict[str, Any], as_of: str | None = None, horizon_days: int = 7) -> list[dict[str, Any]]:
    """Open tasks that are ready (earliest day reached) and due within the horizon, soonest first; overdue first of all."""
    today = date.fromisoformat(as_of or case["today"])
    out = []
    for t in case["tasks"]:
        if t["status"] in ("done", "cancelled", "sent", "waiting"):
            continue
        if date.fromisoformat(t["earliest"]) > today:
            continue
        dl = date.fromisoformat(t["deadline"]) if t["deadline"] else None
        days_left = (dl - today).days if dl else None
        if days_left is None or days_left <= horizon_days:
            out.append({**t, "days_left": days_left})
    return sorted(out, key=lambda t: (t["days_left"] is None, t["days_left"] if t["days_left"] is not None else 0))


def missed_deadlines(case: dict[str, Any]) -> list[dict[str, Any]]:
    today = date.fromisoformat(case["today"])
    return [t for t in case["tasks"] if t["deadline"] and t["status"] not in ("done", "cancelled") and date.fromisoformat(t["deadline"]) < today]
