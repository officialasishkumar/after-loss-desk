---
name: after-loss-desk
description: Use when someone must settle a person's affairs after a death and wants a ledger of who to tell by when, drafted notices, certified copies ordered, and to be asked only when money, an original document, a signature, a closure, or an heir's objection is involved
---

# After Loss Desk (Agent Skill)

Any host with MCP tool access can run the same steps the Alexa+ add-on runs. Server: Streamable HTTP at `/mcp` (spec 2025-11-25).

1. **start_case** with `date_of_death`, `relationship` (spouse, child, sibling, parent, friend, other), `has_will`, `account_kinds` (bank, pension, employer, insurance, utilities, phone_internet, subscriptions, credit_cards, vehicle). Never ask for or repeat names, account numbers or amounts by voice; they belong on the web client.
2. Read `speak` aloud as is (it is checked against the voice policy) and show `card`. The first card asks for the standing authorisation (gate D0): call **approve** with its `decision_id` if the person agrees.
3. Each visit: **whats_due**. Decisions come first (gates D1 money, D2 original leaves her hands, D3 signature or visit, D4 irreversible, D5 heir objects); read each `summary`, then **approve** or **decline**.
4. **order_certificates** when the person agrees to buy copies; the host's checkout (Alexa+: confirmation, payment instrument, PIN) completes `POST /checkout-sessions/{id}/complete` with an `Idempotency-Key`.
5. **draft_notice** to read a letter or phone script for one task. **record_reply** when a letter arrives. **share_progress** for a sibling's read-only page.
6. Legal lines carry "That is the court's own rule, not legal advice." If the person sounds in crisis, the 988 Lifeline line is in the first reply; repeat it.
