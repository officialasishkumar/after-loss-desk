---
name: after-loss-desk
description: Use when someone must settle a person's affairs after a death and wants a ledger of who to tell by when, drafted notices, certified copies ordered, and to be asked only when money, an original document, a signature, a closure, or an heir's objection is involved
---

# After Loss Desk (Agent Skill)

Any host with MCP tool access can run the same steps the Alexa+ add-on runs. Server: Streamable HTTP at `/mcp` (spec 2025-11-25), eight tools. Hosted: https://after-loss-desk-647733667799.us-west1.run.app/mcp. Locally: `uv sync && uv run afterloss serve`, then http://127.0.0.1:8300/mcp.

1. **start_case** with `date_of_death` (`YYYY-MM-DD`), `relationship` (spouse, child, sibling, parent, friend, other), `has_will`, `account_kinds` (bank, pension, employer, insurance, utilities, phone_internet, subscriptions, credit_cards, vehicle), and optionally `state` (only `CA` in this build). Keep the returned `case_id` and pass it to every other tool. Never ask for or repeat names or account numbers by voice; they belong on the web client.
2. Speak `speak` as it is (it is checked against the voice policy) and show `card`. The first card asks for the standing authorisation (gate D0): call **approve** with `case_id` and the card's `action.decision_id` if the person agrees.
3. Each visit: **whats_due** (`case_id`). Decisions come first (gates D1 money, D2 original leaves her hands, D3 signature or visit, D4 irreversible, D5 heir objects). Read each decision's `summary` from `card.decisions`, then call **approve** or **decline** with `case_id` and that decision's `id` as `decision_id`. **decline** also takes an optional `reason`: `i_will_do_it_myself` (the default), `not_now`, `wrong_institution` or `ask_my_sibling`.
4. **order_certificates** (`case_id`) when the person agrees to buy copies. It counts the copies the open list needs, speaks the order total (the one amount this add-on speaks, because she must hear it to approve), and opens a checkout session. The host's checkout (Alexa+: confirmation, payment instrument, PIN) then calls `POST /checkout-sessions/{id}/complete` with an `Idempotency-Key`; the card lists both URLs.
5. **draft_notice** (`case_id`, `task_id`) to read a letter or phone script for one task; task ids are in `card.rows` and `card.items`. **record_reply** (`case_id`, `task_id`, `kind`) when a letter arrives; `kind` is one of `done`, `needs_original`, `needs_signature`, `final_bill`, `silence`, `ready_to_close`, `election`. **share_progress** (`case_id`) for a sibling's read-only page; the link is `card.share_url`.
6. Legal lines carry "That is the court's own rule, not legal advice." If the person sounds in crisis, the 988 Lifeline line is in the first reply; repeat it.
