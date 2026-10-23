# Pitch (the three-minute video, best material first)

**0:00** Kitchen, an Echo Show. "Alexa, my husband died last week. There is a will. He had a bank account, a pension, life insurance, the power bill, a gym and a car."
The card: *17 open, 0 done. You will need about 8 certified copies.* The voice: the list is made, one firm date (the will to the court within 30 days, "the court's own rule, not legal advice"), and one question: *may I send the routine notices with copies on your behalf?* "Approve."

**0:35** "Order the certificates." *7 certified copies, $195.95 at the county's fee. Alexa will confirm the payment with you.* The Alexa+ checkout handoff: confirmation, payment instrument, PIN stay with Alexa; the add-on's `/checkout-sessions/{id}/complete` is called twice with the same `Idempotency-Key` and the log shows the second call replayed, not re-charged.

**1:05** Day 6 (the day bar's +7 stands in for a week passing; the bar shows the replies that arrived and the gates they raised). Three cards wait: the bank wants a certified original (D2), the pension wants a notarised form (D3), the power company's final bill of $142.17 (D1). She opens the Desk on her phone: Check before you approve (task, what it needs, the date, the rule with its source), the text written by code, then she holds to approve. She declines the bill ("I will pay it myself"). The agent leaves it with her and writes that down.

**1:45** Day 12. Her brother objects to selling the car. One card (D5): *hold it until you agree?* "Approve." Day 30: they agreed; the hold lifts; day 40 the DMV signature card (D3) appears on its own. Meanwhile the gym never answered: the agent re-sent by certified mail without asking (clerical), and the receipts show it.

**2:20** The Record: 24 receipts as a chain of blocks, the newest breathing, chain intact. "How far along are we?" *16 of 17 done, 1 waiting on replies, 0 waiting on you.* The sibling's read-only page opens on a phone: statuses only, no documents, no numbers.

**2:40** The scoreboard from `afterloss simulate --weeks 8`: 15 interruptions instead of 27, precision 1.0, recall 1.0, forbidden actions 0, 77 receipts, chain verified, 72 spoken strings, 0 policy violations. Then the policy test that greps every spoken string.

## Why this, why now

- 3,094,593 deaths in the United States in 2025 (CDC provisional, July 2026). Executors do about 500 hours of administrative work over about 18 months (Empathy, *The Grief Tax*, 2026 Workplace Benefits Report; 4,001 employees and 1,502 employers surveyed 8 to 18 Dec 2025, reported by Insurance Business 14 Sep 2026). Two-thirds could not find essential documents; 66% reported panic attacks (Empathy, 2025).
- Social Security takes death reports by phone or in person only, and the payment for the month of death must be returned (USA.gov, updated 31 Aug 2026). Equifax takes no online death reports. Certified copies cost $26 each in San Diego County and institutions keep them.
- Alexa+ households skew older; the rubric's own creative list names state across sessions, orchestration across services, purchasing and MCP Apps. This add-on does all four.

## Prior art, honestly

Empathy (app plus care team, sold through insurers), Settld (UK, one form notifies 750 companies), Alix, Heirloom and The Drive cover the task list and document reading on the web. Postscript (an entry in AWS's Agents for Humans hackathon, Sep 2026) is the closest build: a background executor's agent with policy gates and a measured simulation on Strands and AgentCore. After Loss Desk differs in surface (voice at home, cards across the room), in the purchase (certified copies through Alexa+ checkout), in the household (the sibling's page), and in being built to the Alexa+ policy (no private data by voice). None is on Alexa+.

Sources: https://cdc.gov/nchs/blog/posts/2026/07/provisional-data-u-s-death-rate-fell-to-a-record-low-in-2025.html · https://www.insurancebusinessmag.com/us/news/benefits/bereavement-benefits-emerge-as-a-gap-brokers-can-fill-in-2026-588924.aspx · https://www.empathy.com/blog/what-loss-really-costs-key-takeaways-from-the-grief-tax · https://www.usa.gov/social-security-report-a-death · https://www.elayne.com/resources/how-to-notify-equifax-of-a-death · https://www.sandiegocounty.gov/hhsa/programs/phs/office_of_vital_records_and_statistics/death_certificates.html · https://developer.amazon.com/docs/alexaplus/add-ons/implement-checkout-endpoints.html · https://github.com/Abhinav0905/AWS-Agents-For-Human
