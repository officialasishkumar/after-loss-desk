from datetime import date, timedelta

import pytest

from afterloss import governor, ledger


def make(**kw):
    base = dict(date_of_death="2026-10-01", state="CA", relationship="spouse", has_will=True,
                account_kinds=["bank", "pension", "insurance", "utilities", "subscriptions", "vehicle"], today="2026-10-08")
    base.update(kw)
    return ledger.build_case(**base)


def test_deadlines_come_from_the_rule_table_and_the_date_of_death():
    case = make()
    by = {t["id"]: t for t in case["tasks"]}
    assert by["will_deliver"]["deadline"] == "2026-10-31" and by["will_deliver"]["deadline_kind"] == "statutory"
    assert by["ssa_report"]["deadline"] == "2026-10-15"
    assert by["vehicle_reg5"]["deadline"] is None and by["vehicle_reg5"]["earliest"] == "2026-11-10"
    assert all(t["source"]["url"].startswith("http") for t in case["tasks"])


def test_rules_only_apply_to_the_accounts_the_executor_has():
    case = make(account_kinds=["bank"], has_will=False, relationship="friend")
    ids = {t["id"] for t in case["tasks"]}
    assert "bank_notify" in ids and "pension_notify" not in ids and "will_deliver" not in ids and "ssa_survivor" not in ids
    two = make(account_kinds=["bank"], labels={"bank": ["Wells Fargo", "Chase"]})
    assert {t["id"] for t in two["tasks"] if t["rule"] == "bank_notify"} == {"bank_notify_1", "bank_notify_2"}
    assert {t["label"] for t in two["tasks"] if t["rule"] == "bank_notify"} == {"Wells Fargo", "Chase"}


def test_originals_count_follows_the_open_ledger():
    case = make()
    # bank, pension, insurance, vehicle ask for originals; plus the court; plus two spare
    assert ledger.originals_needed(case) == 4 + 1 + 2


def test_due_list_is_soonest_first_and_respects_earliest_day():
    case = make()
    ids = [t["id"] for t in ledger.due(case, horizon_days=30)]
    assert ids[0] == "certificates_order" and "vehicle_reg5" not in ids
    assert ids.index("ssa_report") < ids.index("will_deliver")


def test_gates_are_deterministic_and_clerical_needs_standing_authorisation():
    case = make()
    t = next(x for x in case["tasks"] if x["id"] == "bureau_equifax")
    assert governor.evaluate(case, t, "notify") == ("gate", "D0")
    case["standing_authorisation"] = True
    assert governor.evaluate(case, t, "notify") == ("allow", None)
    assert governor.evaluate(case, t, "pay") == ("gate", "D1")
    assert governor.evaluate(case, t, "send_original") == ("gate", "D2")
    assert governor.evaluate(case, t, "sign") == ("gate", "D3")
    assert governor.evaluate(case, t, "close") == ("gate", "D4")
    case["objections"].append(t["id"])
    assert governor.evaluate(case, t, "notify") == ("gate", "D5")
    assert governor.evaluate(case, t, "frobnicate")[0] == "deny"


def test_receipt_chain_detects_tampering_and_forbidden_actions():
    case = make()
    governor.receipt(case, actor="agent", action="execute:notify", task_id="bureau_equifax")
    governor.receipt(case, actor="agent", action="execute:pay", task_id="certificates_order")
    assert governor.verify_chain(case)
    assert [r["task_id"] for r in governor.forbidden_actions(case)] == ["certificates_order"]
    case["receipts"][0]["note"] = "edited"
    assert not governor.verify_chain(case)


def test_one_decision_per_task_and_gate():
    case = make()
    t = case["tasks"][0]
    a = governor.raise_decision(case, t, "D1", "s", "d", "pay")
    b = governor.raise_decision(case, t, "D1", "s", "d", "pay")
    assert a is b and t["status"] == "parked" and len(governor.open_decisions(case)) == 1
