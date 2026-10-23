"""Regression tests for the backend review fixes: scoreboard isolation, governor bypasses, checkout binding, idempotency, voice policy."""

import os
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from afterloss import checkout, drafts, engine, governor, ledger, policy, speak, store
from afterloss.simulate import demo_case

MCP_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


def rpc(c, name, args):
    r = c.post("/mcp", headers=MCP_HEADERS, json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}})
    assert r.status_code == 200
    return r.json()["result"]


def authorised():
    case = demo_case()
    engine.approve(case, next(d["id"] for d in case["decisions"] if d["gate"] == "D0"))
    return case


def raised(case, task_id, gate):
    return next(d for d in governor.open_decisions(case) if d["task_id"] == task_id and d["gate"] == gate)


def executed(case, action):
    return [r for r in case["receipts"] if r["action"] == f"execute:{action}"]


# 1. scoreboard never moves the live store

def test_overlapping_scoreboards_leave_the_live_store_alone():
    from afterloss.web import app
    live = os.environ["AFTERLOSS_DB"]
    with TestClient(app) as c:
        case = demo_case()
        with ThreadPoolExecutor(8) as ex:
            boards = [ex.submit(c.get, "/api/scoreboard") for _ in range(2)]
            gets = [ex.submit(c.get, f"/api/cases/{case['id']}") for _ in range(6)]
            assert all(f.result().status_code == 200 for f in gets), "a case request failed while a scoreboard was running"
            assert all(f.result().status_code == 200 and f.result().json()["ok"] for f in boards)
        assert os.environ["AFTERLOSS_DB"] == live
        assert c.get(f"/api/cases/{case['id']}").status_code == 200


# 2a. approving an older gated decision after an objection

def test_objection_after_a_gate_was_raised_stops_the_old_approval():
    case = authorised()
    engine.advance(case, 20)
    old = raised(case, "will_deliver", "D2")
    engine.object_to(case, "will_deliver", "her brother")
    assert engine.approve(case, old["id"]) is None
    task = next(t for t in case["tasks"] if t["id"] == "will_deliver")
    assert task["status"] != "done" and not executed(case, "deliver_original") and not governor.forbidden_actions(case)
    engine.lift_objection(case, "will_deliver")
    again = raised(case, "will_deliver", "D2")
    assert again["id"] != old["id"]
    engine.approve(case, again["id"])
    assert task["status"] == "done" and len(executed(case, "deliver_original")) == 1 and not governor.forbidden_actions(case)


def test_approval_re_runs_the_governor_even_if_the_objection_was_added_directly():
    case = authorised()
    engine.advance(case, 20)
    old = raised(case, "will_deliver", "D2")
    case["objections"].append("will_deliver")
    assert engine.approve(case, old["id"]) is None
    assert old["status"] == "superseded" and not executed(case, "deliver_original")


# 2b/2c. checkout complete goes through the governor and is bound to the quoted amount

def test_checkout_complete_is_refused_after_a_declined_d1():
    case = demo_case()
    s = checkout.create_session(case)
    engine.decline(case, raised(case, "certificates_order", "D1")["id"])
    with pytest.raises(checkout.CheckoutRefused):
        checkout.complete_session(case, s["id"])
    assert not executed(case, "pay") and s["status"] == "cancelled"


def test_checkout_complete_is_refused_while_an_heir_objects():
    case = demo_case()
    s = checkout.create_session(case)
    engine.object_to(case, "certificates_order", "her brother")
    with pytest.raises(checkout.CheckoutRefused):
        checkout.complete_session(case, s["id"])
    fresh = demo_case()
    s2 = checkout.create_session(fresh)
    fresh["objections"].append("certificates_order")
    with pytest.raises(checkout.CheckoutRefused):
        checkout.complete_session(fresh, s2["id"])
    assert not executed(case, "pay") and not executed(fresh, "pay")


def test_checkout_complete_is_bound_to_the_quoted_quantity_and_total():
    case = demo_case()
    s = checkout.create_session(case, 3)
    d = raised(case, "certificates_order", "D1")
    assert d["quantity"] == 3 and d["total"] == 3 * 26.0 + checkout.PROCESSING_FEE and "$91.95" in d["summary"]
    s["line_items"][0]["quantity"] = 30
    with pytest.raises(checkout.CheckoutRefused):
        checkout.complete_session(case, s["id"])
    s["line_items"][0]["quantity"] = 3
    s["totals"][-1]["amount"] = 1.0
    with pytest.raises(checkout.CheckoutRefused):
        checkout.complete_session(case, s["id"])
    s["totals"][-1]["amount"] = d["total"]
    assert checkout.complete_session(case, s["id"])["status"] == "completed"
    assert case["originals_ordered"] == 3 and "3 copies, $91.95" in executed(case, "pay")[0]["note"] and not governor.forbidden_actions(case)


def test_a_new_quote_replaces_the_old_session_and_its_card():
    case = demo_case()
    first = checkout.create_session(case, 3)
    second = checkout.create_session(case, 5)
    assert first["status"] == "cancelled" and len(governor.open_decisions(case)) == 1 + 1  # the D0 and one D1
    with pytest.raises(checkout.CheckoutRefused):
        checkout.complete_session(case, first["id"])
    assert checkout.complete_session(case, second["id"])["status"] == "completed" and case["originals_ordered"] == 5
    assert len(executed(case, "pay")) == 1 and not governor.forbidden_actions(case)


@pytest.mark.parametrize("bad", [0, -5, 31, 1000000, "8", True, 2.5])
def test_quantity_is_validated(bad):
    from afterloss.web import app
    case = demo_case()
    with TestClient(app) as c:
        r = c.post("/checkout-sessions", json={"case_id": case["id"], "quantity": bad})
        assert r.status_code == 422, r.text
        assert not store.load(case["id"])["checkout_sessions"]


def test_rest_complete_after_decline_is_a_409():
    from afterloss.web import app
    case = demo_case()
    with TestClient(app) as c:
        sid = c.post("/checkout-sessions", json={"case_id": case["id"], "quantity": 4}).json()["id"]
        loaded = store.load(case["id"])
        engine.decline(loaded, raised(loaded, "certificates_order", "D1")["id"])
        r = c.post(f"/checkout-sessions/{sid}/complete", json={"case_id": case["id"]})
        assert r.status_code == 409 and not executed(store.load(case["id"]), "pay")


# 2d. forbidden_actions sees order, objections and reuse

def test_forbidden_actions_detects_order_objection_and_reuse():
    case = demo_case()
    task = next(t for t in case["tasks"] if t["id"] == "bank_notify_1")
    tid = task["id"]
    governor.receipt(case, actor="agent", action="execute:send_original", task_id=tid)
    assert len(governor.forbidden_actions(case)) == 1, "an execution before any approval"
    d = governor.raise_decision(case, task, "D2", "s", "d", "send_original")
    d["status"] = "approved"
    governor.receipt(case, actor="executor", action="approve", task_id=tid, decision_id=d["id"])
    governor.receipt(case, actor="agent", action="execute:send_original", task_id=tid)
    assert len(governor.forbidden_actions(case)) == 1, "one approval pays for one execution"
    governor.receipt(case, actor="agent", action="execute:send_original", task_id=tid)
    assert len(governor.forbidden_actions(case)) == 2, "a second execution on the same approval"
    d2 = governor.raise_decision(case, task, "D2", "s", "d", "send_original")
    d2["status"] = "approved"
    governor.receipt(case, actor="heir", action="objection", task_id=tid, note="brother")
    governor.receipt(case, actor="executor", action="approve", task_id=tid, decision_id=d2["id"])
    governor.receipt(case, actor="agent", action="execute:send_original", task_id=tid)
    assert len(governor.forbidden_actions(case)) == 3, "an execution while an heir objects"
    governor.receipt(case, actor="heir", action="objection_withdrawn", task_id=tid)
    assert len(governor.forbidden_actions(case)) == 3


# 3. idempotency

def test_idempotency_key_with_a_different_body_is_a_409_and_keys_are_scoped():
    from afterloss.web import app
    a, b = demo_case(), demo_case()
    h = {"Idempotency-Key": "k"}
    with TestClient(app) as c:
        r1 = c.post("/checkout-sessions", json={"case_id": a["id"]}, headers=h)
        assert r1.status_code == 200 and r1.headers["Idempotent-Replayed"] == "false"
        same = c.post("/checkout-sessions", json={"case_id": a["id"]}, headers=h)
        assert same.json()["id"] == r1.json()["id"] and same.headers["Idempotent-Replayed"] == "true"
        clash = c.post("/checkout-sessions", json={"case_id": a["id"], "quantity": 5}, headers=h)
        assert clash.status_code == 409 and clash.json()["code"] == "idempotency_conflict"
        other = c.post("/checkout-sessions", json={"case_id": b["id"]}, headers=h)
        assert other.status_code == 200 and other.json()["case_id"] == b["id"] and other.headers["Idempotent-Replayed"] == "false"
        sid = r1.json()["id"]
        done = c.post(f"/checkout-sessions/{sid}/complete", json={"case_id": a["id"]}, headers={"Idempotency-Key": "c"})
        assert done.status_code == 200 and done.json()["status"] == "completed"
        again = c.post(f"/checkout-sessions/{sid}/complete", json={"case_id": a["id"], "x": 1}, headers={"Idempotency-Key": "c"})
        assert again.status_code == 409
        sid2 = c.post("/checkout-sessions", json={"case_id": a["id"]}).json()["id"]
        second = c.post(f"/checkout-sessions/{sid2}/complete", json={"case_id": a["id"]}, headers={"Idempotency-Key": "c"})
        assert second.status_code == 200 and second.json()["id"] == sid2 and second.headers["Idempotent-Replayed"] == "false"


# 4. voice policy and ordinary-word labels

def test_ordinary_word_labels_do_not_break_the_voice_path():
    from afterloss.web import app
    case = demo_case()
    with TestClient(app) as c:
        labels = {"pension_notify": "Pension", "utilities_notify": "Utility", "vehicle_reg5": "DMV", "ssa_report": "Social Security", "bank_notify_1": "the"}
        assert c.post(f"/api/cases/{case['id']}/labels", json=labels).status_code == 200
        loaded = store.load(case["id"])
        engine.approve(loaded, next(d["id"] for d in loaded["decisions"] if d["gate"] == "D0"))
        engine.advance(loaded, 12)
        for name, args in [("whats_due", {"case_id": case["id"]}), ("share_progress", {"case_id": case["id"]}),
                           ("draft_notice", {"case_id": case["id"], "task_id": "vehicle_reg5"}), ("draft_notice", {"case_id": case["id"], "task_id": "ssa_report"})]:
            res = rpc(c, name, args)
            assert not res.get("isError"), (name, res)
        d = governor.open_decisions(loaded)[0]
        assert not rpc(c, "approve", {"case_id": case["id"], "decision_id": d["id"]}).get("isError")


def test_real_institution_labels_are_still_caught():
    case = demo_case()
    assert policy.violations("Call First Federal today", case) and policy.violations("Your CalPERS letter", case)
    pension = next(t for t in case["tasks"] if t["id"] == "pension_notify")
    pension["label"] = "Pension Fund of Ohio"
    assert policy.violations("Send the pension fund of Ohio a letter", case)
    assert not policy.violations("Send the pension letter", case)
    pension["label"] = "Pension"
    assert not policy.violations("Send the pension letter", case)


# 5. bureau letter

def test_credit_bureau_letter_has_its_own_template():
    case = demo_case()
    for rule, name in [("bureau_equifax", "Equifax"), ("bureau_experian", "Experian"), ("bureau_transunion", "TransUnion")]:
        text = drafts.draft(case, next(t for t in case["tasks"] if t["id"] == rule))["text"]
        assert f"To: {name}" in text and "deceased alert" in text and "copy of the credit report" in text and "balance" not in text
    bank = drafts.draft(case, next(t for t in case["tasks"] if t["id"] == "bank_notify_1"))["text"]
    assert "balance" in bank and "deceased alert" not in bank


# 6. spoken wording

def test_first_reply_is_short_and_keeps_both_fixed_lines():
    case = demo_case()
    text = speak.ledger_summary(case, ledger.originals_needed(case))
    assert "within 23 days" in text and policy.LEGAL_LINE in text
    assert len((text + " " + policy.CRISIS_LINE).split()) <= 75 and "988" in policy.CRISIS_LINE


def test_a_passed_statutory_date_is_spoken_as_overdue():
    case = demo_case()
    case["today"] = "2026-04-05"
    text = speak.ledger_summary(case, 5)
    assert "overdue by 5 days" in text and "within 0" not in text
    case["today"] = "2026-03-31"
    assert "due today" in speak.ledger_summary(case, 5)


# 7. MCP schemas and dates

def test_tool_schemas_are_closed_and_extra_arguments_are_rejected():
    from afterloss.web import app
    from afterloss.mcp_server import mcp
    import asyncio
    tools = asyncio.run(mcp.list_tools())
    assert len(tools) == 8 and all(t.inputSchema.get("additionalProperties") is False for t in tools)
    case = demo_case()
    with TestClient(app) as c:
        res = rpc(c, "whats_due", {"case_id": case["id"], "extra": 1})
        assert res["isError"] and "extra" in res["content"][0]["text"]


def test_start_case_rejects_a_future_or_invalid_date_with_a_clear_message():
    from afterloss.web import app
    with TestClient(app) as c:
        base = {"relationship": "spouse", "has_will": True, "account_kinds": ["bank"]}
        future = rpc(c, "start_case", {**base, "date_of_death": "2999-01-01"})
        assert future["isError"] and "cannot be in the future" in future["content"][0]["text"] and "policy" not in future["content"][0]["text"]
        bad = rpc(c, "start_case", {**base, "date_of_death": "last Tuesday"})
        assert bad["isError"] and "real date" in bad["content"][0]["text"]
        ok = rpc(c, "start_case", {**base, "date_of_death": "2026-10-01"})
        assert not ok.get("isError")


# 8. the baseline counts the certificate purchase once

def test_confirm_everything_baseline_counts_each_executed_action_once(capsys):
    from afterloss.simulate import run
    assert run(weeks=8, verbose=True) == 0
    rows = {k.strip(): v.strip() for k, v in (line.rsplit("  ", 1) for line in capsys.readouterr().out.splitlines() if "  " in line)}
    assert rows["confirm everything baseline"] == rows["actions taken"]
