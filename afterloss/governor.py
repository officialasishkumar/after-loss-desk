"""The five-gate governor. Evaluated in code before every action the agent wants to take; a prompt is advice, this is not.

Gates (one card to the executor, once per task and gate):
  D1  money leaves the estate              (pay, return a payment)
  D2  an original certified document leaves her hands
  D3  her signature, a notary, or an in-person visit
  D4  something irreversible                (close an account, elect lump sum over annuity)
  D5  an heir objects to anything about this task
Clerical work (a notice with copies, a phone script, a chase, a certified-mail escalation) is allowed once the executor has given
the standing authorisation at the start of the case, unless an heir has objected on that task. Every evaluation and every executed
action is written to a hash-chained receipt log, so "the agent never acted where the policy said it needed her" is checkable.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from typing import Any

GATES = {"pay": "D1", "deliver_original": "D2", "send_original": "D2", "sign": "D3", "appointment": "D3", "visit": "D3", "close": "D4", "elect": "D4"}
GATE_TEXT = {"D1": "money leaves the estate", "D2": "an original certified document leaves your hands", "D3": "your signature, a notary or a visit",
             "D4": "something that cannot be undone", "D5": "an heir has objected"}
CLERICAL = {"notify", "chase", "escalate", "record"}


def evaluate(case: dict[str, Any], task: dict[str, Any], action: str) -> tuple[str, str | None]:
    """Return ("allow", None), ("gate", "D1".."D5") or ("deny", reason)."""
    if action not in CLERICAL and action not in GATES:
        return "deny", f"unknown action {action}"
    if task["id"] in case.get("objections", []):
        return "gate", "D5"
    if action in CLERICAL:
        return ("allow", None) if case.get("standing_authorisation") else ("gate", "D0")
    return "gate", GATES[action]


def receipt(case: dict[str, Any], *, actor: str, action: str, task_id: str | None = None, decision_id: str | None = None, note: str = "") -> dict[str, Any]:
    prev = case["receipts"][-1]["hash"] if case["receipts"] else "genesis"
    body = {"seq": len(case["receipts"]) + 1, "day": case["today"], "actor": actor, "action": action, "task_id": task_id, "decision_id": decision_id, "note": note, "prev": prev}
    body["hash"] = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    case["receipts"].append(body)
    return body


def verify_chain(case: dict[str, Any]) -> bool:
    prev = "genesis"
    for r in case["receipts"]:
        body = {k: v for k, v in r.items() if k != "hash"}
        if body["prev"] != prev or hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest() != r["hash"]:
            return False
        prev = r["hash"]
    return True


def raise_decision(case: dict[str, Any], task: dict[str, Any], gate: str, summary: str, detail: str, action: str) -> dict[str, Any]:
    """Raise one decision per task and gate; if it already exists and is open, return it unchanged."""
    for d in case["decisions"]:
        if d["task_id"] == task["id"] and d["gate"] == gate and d["status"] == "raised":
            return d
    d = {"id": "d" + secrets.token_hex(3), "task_id": task["id"], "gate": gate, "gate_text": GATE_TEXT.get(gate, "your say-so to start"),
         "summary": summary, "detail": detail, "action": action, "status": "raised", "raised_on": case["today"], "resolved_on": None}
    case["decisions"].append(d)
    task["status"] = "parked"
    receipt(case, actor="agent", action="raise", task_id=task["id"], decision_id=d["id"], note=f"{gate}: {summary}")
    return d


def open_decisions(case: dict[str, Any]) -> list[dict[str, Any]]:
    return [d for d in case["decisions"] if d["status"] == "raised"]


def forbidden_actions(case: dict[str, Any]) -> list[dict[str, Any]]:
    """Receipts where a gated action was executed without an approved decision for that task and gate: must be empty."""
    approved = {(d["task_id"], d["gate"]) for d in case["decisions"] if d["status"] == "approved"}
    bad = []
    for r in case["receipts"]:
        if r["actor"] == "agent" and r["action"].startswith("execute:"):
            act = r["action"].split(":", 1)[1]
            gate = GATES.get(act)
            if gate and (r["task_id"], gate) not in approved:
                bad.append(r)
    return bad
