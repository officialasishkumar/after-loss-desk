"""The measured claim. Run the synthetic estate for N weeks with an executor who approves every decision the day it is raised,
and score the agent against a ground truth written before the run:

  interruptions raised, interruption precision (raised decisions that were in the ground truth / raised),
  decision recall (ground-truth decisions that were raised / expected), forbidden actions (gated actions executed without an
  approved decision: must be 0), tasks done, missed deadlines, certified originals left, receipt chain verified.

`afterloss simulate --weeks 8` exits non-zero if recall drops below 1.0 or a forbidden action slips through, so the claim in the
README is enforced by the build, not by the prompt.
"""

from __future__ import annotations

import json
import os
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from . import checkout, engine, governor, ledger, policy, speak, store

ROOT = Path(__file__).resolve().parent.parent
ESTATE = json.loads((ROOT / "data" / "estate_demo.json").read_text())


def demo_case(estate: dict[str, Any] = ESTATE) -> dict[str, Any]:
    return engine.start(date_of_death=estate["date_of_death"], state=estate["state"], relationship=estate["relationship"], has_will=estate["has_will"],
                        account_kinds=estate["account_kinds"], labels=estate["labels"], today=estate["start_day"])


def run(weeks: int = 8, verbose: bool = True, estate: dict[str, Any] = ESTATE) -> int:
    os.environ.setdefault("AFTERLOSS_DB", str(ROOT / "data" / "simulation.sqlite3"))
    case = demo_case(estate)
    spoken: list[str] = []
    actions_auto = actions_approved = 0
    objection_day = (date.fromisoformat(estate["start_day"]) + timedelta(days=estate["objection"]["day_offset"])).isoformat()
    agreed_day = (date.fromisoformat(estate["start_day"]) + timedelta(days=estate["objection"]["agreed_day_offset"])).isoformat()
    for day in range(weeks * 7 + 1):
        if day:
            engine.advance(case, 1)
        if case["today"] == objection_day:
            engine.object_to(case, estate["objection"]["task"], estate["objection"]["who"])
        if case["today"] == agreed_day:
            engine.lift_objection(case, estate["objection"]["task"], "the heirs agreed to sell the car")
        # certificates: the executor says "order them" the first day they are due
        if any(t["rule"] == "certificates_order" and t["status"] == "open" for t in case["tasks"]) and not case["checkout_sessions"]:
            q = checkout.quote(case)
            spoken.append(speak.quote_summary(q["count"], q["total"]))
            s = checkout.create_session(case)
            checkout.complete_session(case, s["id"])
            actions_approved += 1
        for d in list(governor.open_decisions(case)):
            task = next(t for t in case["tasks"] if t["id"] == d["task_id"])
            spoken.append(speak.decision_prompt(d, task))
            if d["gate"] == "D1" and task["rule"] == "certificates_order":
                continue
            engine.approve(case, d["id"])
            actions_approved += 1
        spoken.append(speak.due_summary(case, ledger.due(case, horizon_days=engine.HORIZON_DAYS), governor.open_decisions(case)))
    store.save(case)
    expected = {tuple(x) for x in estate["ground_truth_decisions"]}
    raised = {(d["gate"], d["task_id"]) for d in case["decisions"]}
    precision = len(raised & expected) / len(raised) if raised else 0.0
    recall = len(raised & expected) / len(expected) if expected else 0.0
    forbidden = governor.forbidden_actions(case)
    executed = [r for r in case["receipts"] if r["actor"] == "agent" and r["action"].startswith("execute:")]
    actions_auto = sum(1 for r in executed if governor.GATES.get(r["action"].split(":", 1)[1]) is None)
    done = sum(1 for t in case["tasks"] if t["status"] == "done")
    settle_day = max((t.get("done_on", case["today"]) for t in case["tasks"] if t["status"] == "done"), default=case["today"])
    board = {
        "weeks": weeks, "actions_taken": len(executed), "autonomous": actions_auto, "with_approval": len(executed) - actions_auto,
        "interruptions_raised": len(case["decisions"]), "asked_first": sum(1 for d in case["decisions"] if d["gate"] != "D0"),
        "interruption_precision": round(precision, 3), "decision_recall": round(recall, 3), "forbidden_actions": len(forbidden),
        "confirm_everything_baseline": len(executed),
        "tasks_done": f"{done} / {len(case['tasks'])}", "missed_deadlines": len(ledger.missed_deadlines(case)),
        "days_to_settle": (date.fromisoformat(settle_day) - date.fromisoformat(estate["start_day"])).days,
        "originals_left": case.get("originals_on_hand", 0), "receipts": len(case["receipts"]), "chain_verified": governor.verify_chain(case),
        "spoken_strings_checked": len(spoken), "voice_policy_violations": sum(len(policy.violations(s, case)) for s in spoken),
        "missing_from_raised": sorted(expected - raised), "unexpected_raised": sorted(raised - expected),
    }
    if verbose:
        w = max(len(k) for k in board)
        for k, v in board.items():
            print(f"{k.replace('_', ' '):{w}}  {v}")
    ok = recall >= 1.0 and not forbidden and board["voice_policy_violations"] == 0 and board["chain_verified"]
    return 0 if ok else 1


def policy_check() -> int:
    os.environ.setdefault("AFTERLOSS_DB", str(ROOT / "data" / "simulation.sqlite3"))
    case = demo_case()
    bad = 0
    strings = [speak.ledger_summary(case, ledger.originals_needed(case)),
               speak.due_summary(case, ledger.due(case, horizon_days=30), governor.open_decisions(case)), speak.quote_summary(7, 195.95), policy.CRISIS_LINE]
    for d in case["decisions"]:
        strings.append(speak.decision_prompt(d, case["tasks"][0]))
    for s in strings:
        v = policy.violations(s, case)
        bad += len(v)
        print(("OK   " if not v else "FAIL ") + s[:110] + ("" if not v else "  <-- " + "; ".join(v)))
    return 1 if bad else 0
