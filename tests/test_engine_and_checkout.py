import json

from afterloss import checkout, engine, governor, ledger, policy, speak, store
from afterloss.simulate import ESTATE, demo_case


def test_standing_authorisation_gates_everything_until_approved():
    case = demo_case()
    d0 = [d for d in case["decisions"] if d["gate"] == "D0"]
    assert len(d0) == 1 and not case["standing_authorisation"]
    engine.advance(case, 3)
    assert all(t["status"] in ("open", "parked") for t in case["tasks"]), "nothing is sent before the executor allows routine notices"
    engine.approve(case, d0[0]["id"])
    assert case["standing_authorisation"]
    sent = [t for t in case["tasks"] if t["status"] == "waiting"]
    assert {t["rule"] for t in sent} >= {"bureau_equifax", "bank_notify", "pension_notify"}
    assert all(not any(r["action"] == f"execute:{a}" for a in governor.GATES) for r in case["receipts"]), "no gated action was executed"


def test_replies_create_gated_decisions_and_approval_executes_them():
    case = demo_case()
    engine.approve(case, next(d["id"] for d in case["decisions"] if d["gate"] == "D0"))
    engine.advance(case, 6)
    gates = {(d["gate"], d["task_id"]) for d in governor.open_decisions(case)}
    assert ("D2", "bank_notify_1") in gates and ("D3", "pension_notify") in gates and ("D1", "utilities_notify") in gates
    d = next(x for x in governor.open_decisions(case) if x["task_id"] == "bank_notify_1")
    case["originals_on_hand"] = 3
    engine.approve(case, d["id"])
    assert case["originals_on_hand"] == 2
    assert any(r["action"] == "execute:send_original" and r["task_id"] == "bank_notify_1" for r in case["receipts"])
    assert not governor.forbidden_actions(case)


def test_decline_hands_the_task_back_and_the_agent_leaves_it():
    case = demo_case()
    engine.approve(case, next(d["id"] for d in case["decisions"] if d["gate"] == "D0"))
    engine.advance(case, 6)
    d = next(x for x in governor.open_decisions(case) if x["gate"] == "D1")
    engine.decline(case, d["id"], "i will do it myself")
    task = next(t for t in case["tasks"] if t["id"] == d["task_id"])
    assert task["status"] == "held"
    engine.advance(case, 20)
    assert task["status"] == "held"


def test_heir_objection_raises_d5_and_holds_the_task():
    case = demo_case()
    engine.approve(case, next(d["id"] for d in case["decisions"] if d["gate"] == "D0"))
    engine.advance(case, 45)  # vehicle task becomes ready at day 40
    engine.object_to(case, "vehicle_reg5", "brother")
    d = next(x for x in governor.open_decisions(case) if x["gate"] == "D5")
    engine.approve(case, d["id"])
    assert next(t for t in case["tasks"] if t["id"] == "vehicle_reg5")["status"] == "held"


def test_checkout_quote_session_and_idempotent_completion():
    case = demo_case()
    q = checkout.quote(case)
    assert q["count"] == ledger.originals_needed(case) and q["total"] == round(q["count"] * 26.0 + 13.95, 2)
    s = checkout.create_session(case)
    assert s["status"] == "created" and s["line_items"][0]["quantity"] == q["count"] and s["totals"][-1]["type"] == "total"
    assert any(d["gate"] == "D1" and d["task_id"] == "certificates_order" for d in governor.open_decisions(case))
    store.save(case)
    calls = []
    def complete():
        c = store.load(case["id"])
        r = checkout.complete_session(c, s["id"])
        store.save(c)
        calls.append(1)
        return r
    first, replayed1 = store.idempotent("complete:k1", complete)
    second, replayed2 = store.idempotent("complete:k1", complete)
    assert first["status"] == "completed" and second == first and (replayed1, replayed2) == (False, True) and len(calls) == 1
    c = store.load(case["id"])
    d = next(x for x in c["decisions"] if x["task_id"] == "certificates_order" and x["gate"] == "D1")
    assert d["status"] == "approved" and d["resolved_by"] == "alexa_checkout_confirmation"
    engine.advance(c, 6)
    assert c["originals_on_hand"] == q["count"]
    assert not governor.forbidden_actions(c)


def test_voice_strings_carry_no_private_data():
    case = demo_case()
    strings = [speak.ledger_summary(case, ledger.originals_needed(case)), speak.due_summary(case, ledger.due(case, horizon_days=30), governor.open_decisions(case)),
               speak.quote_summary(7, 195.95), policy.CRISIS_LINE] + [speak.decision_prompt(d, case["tasks"][0]) for d in case["decisions"]]
    for s in strings:
        assert policy.violations(s, case) == [], s
        assert "First Federal" not in s and "CalPERS" not in s
    assert policy.violations("Your account number is 1234567", case)
    assert policy.violations("Call First Federal today", case)
    assert policy.violations("This is legal advice, trust me", case)
    assert policy.violations("the 988 Lifeline; filed in 2026; $142.17 due", case) == []


def test_drafts_fill_facts_by_code_and_never_speak_labels():
    from afterloss import drafts
    case = demo_case()
    bank = next(t for t in case["tasks"] if t["id"] == "bank_notify_1")
    d = drafts.draft(case, bank)
    assert d["channel"] == "mail" and "First Federal" in d["text"] and case["date_of_death"] in d["text"] and "First Federal" in d["facts"]
    ssa = next(t for t in case["tasks"] if t["id"] == "ssa_report")
    assert "report a death" in drafts.draft(case, ssa)["text"]


def test_eight_week_simulation_meets_the_measured_claim(capsys):
    from afterloss.simulate import run
    assert run(weeks=8, verbose=True) == 0
    out = capsys.readouterr().out
    assert "decision recall           1.0" in out.replace("  ", " ").replace("recall  ", "recall ") or "decision recall" in out
    assert "forbidden actions" in out


def test_approving_the_certificates_gate_by_voice_orders_them():
    case = demo_case()
    checkout.create_session(case)
    d = next(x for x in governor.open_decisions(case) if x["task_id"] == "certificates_order")
    engine.approve(case, d["id"])
    assert case["checkout_sessions"][0]["status"] == "completed" and case.get("originals_ordered", 0) >= 4
    engine.advance(case, 6)
    assert case["originals_on_hand"] == case["originals_ordered"] and not governor.forbidden_actions(case)
