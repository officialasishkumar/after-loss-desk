"""The rule table's headline claim: every row has a source URL and a quoted line. No network here: the quotes were checked
against the live pages by hand when the table was last updated (see `updated` in the JSON); these tests keep the shape honest."""

import json
from urllib.parse import urlparse

from afterloss import governor, ledger

TABLE = json.loads((ledger.RULES_DIR / "california.json").read_text())
SOURCES = [("certificate_fee", {"url": TABLE["certificate_fee"]["source"], "quote": TABLE["certificate_fee"]["note"]})] + [(t["id"], t["source"]) for t in TABLE["tasks"]]


def test_every_row_has_an_https_source_url_and_a_quoted_line():
    assert len(TABLE["tasks"]) >= 17
    for rid, src in SOURCES:
        u = urlparse(src["url"])
        assert u.scheme == "https" and u.netloc and "." in u.netloc, rid
        assert src["quote"].strip(), rid
    for t in TABLE["tasks"]:
        assert t["source"]["date"].strip(), t["id"]
        assert len(t["source"]["quote"]) >= 10, t["id"]


def test_quotes_are_whole_lines_not_spliced():
    for t in TABLE["tasks"]:
        q = t["source"]["quote"]
        assert "..." not in q and "…" not in q, t["id"]


def test_will_row_quotes_the_statute_with_both_ways_to_deliver_it():
    row = next(t for t in TABLE["tasks"] if t["id"] == "will_deliver")
    q = row["source"]["quote"]
    assert "personally or by registered or certified mail" in q and "within 30 days" in q and "Unless a petition for probate" in q
    assert urlparse(row["source"]["url"]).netloc == "leginfo.legislature.ca.gov" and "8200" in row["source"]["url"]


def make(**kw):
    base = dict(date_of_death="2026-03-01", state="CA", relationship="child", has_will=True, account_kinds=["utilities", "subscriptions"], today="2026-03-08")
    base.update(kw)
    return ledger.build_case(**base)


def task(case, rid):
    return next(t for t in case["tasks"] if t["id"] == rid)


def test_untouched_task_past_its_date_is_missed():
    case = make(today="2026-04-05")
    ids = {t["id"] for t in ledger.missed_deadlines(case)}
    assert "ssa_report" in ids and "will_deliver" in ids
    assert ledger.deadline_summary(case)["statutory_missed"] == 1


def test_notice_sent_on_time_and_waiting_is_not_past_the_date():
    case = make(today="2026-04-02")
    for t in case["tasks"]:
        if t["deadline"]:
            governor.receipt(case, actor="agent", action="execute:notify", task_id=t["id"], note="phone")
            case["receipts"][-1]["day"] = "2026-03-08"
            t["status"] = "waiting"
    assert ledger.missed_deadlines(case) == []


def test_first_action_after_the_date_counts_as_missed_even_if_finished():
    case = make(today="2026-04-10")
    t = task(case, "subscription_cancel")
    governor.receipt(case, actor="agent", action="execute:notify", task_id=t["id"])
    case["receipts"][-1]["day"] = "2026-04-05"
    t["status"], t["done_on"] = "done", "2026-04-08"
    assert t["id"] in {x["id"] for x in ledger.missed_deadlines(case)}


def test_task_finished_after_its_date_is_reported_not_hidden():
    case = make(today="2026-04-10")
    t = task(case, "subscription_cancel")
    governor.receipt(case, actor="agent", action="execute:notify", task_id=t["id"])
    case["receipts"][-1]["day"] = "2026-03-08"
    t["status"], t["done_on"] = "done", "2026-04-03"
    assert t["id"] not in {x["id"] for x in ledger.missed_deadlines(case)}
    late = ledger.deadline_summary(case)["finished_late"]
    assert [(x["id"], x["days_late"], x["kind"]) for x in late] == [("subscription_cancel", 3, "soft")]


def test_order_by_date_for_certified_copies_is_not_a_late_finish():
    case = make(today="2026-03-20")
    t = task(case, "certificates_order")
    t["status"], t["done_on"] = "done", "2026-03-13"
    governor.receipt(case, actor="agent", action="execute:pay", task_id=t["id"])
    case["receipts"][-1]["day"] = "2026-03-08"
    assert ledger.finished_late(case) == []


def test_held_soft_task_is_the_executors_but_held_statutory_task_stays_listed():
    case = make(today="2026-04-10")
    task(case, "utilities_notify")["status"] = "held"
    task(case, "will_deliver")["status"] = "held"
    ids = {t["id"] for t in ledger.missed_deadlines(case)}
    assert "utilities_notify" not in ids and "will_deliver" in ids
