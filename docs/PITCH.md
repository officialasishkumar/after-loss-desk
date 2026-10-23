# Pitch (the three-minute video, best material first)

Every beat is filmed from the simulated Alexa+ client in `site/`, on a fresh load of the page at 1440 wide, against the real server. The page says "Simulated Alexa+" in its footer and the video shows it. The story plays itself; if spoken replies run long, mute them in the voice menu (the subtitles carry every reply). Total about 2:45, which leaves about 15 seconds under the limit.

**0:00 (14 s)** The Echo page is on screen from the first frame: "Say what happened once." Say: "When someone dies, the person left behind spends about 500 hours over about 18 months telling banks, insurers and the county. After Loss Desk is an Alexa+ add-on that does the telling and asks only at five moments." At 0:05 click **Watch the first week**. At 0:10 scroll to the footer for two seconds: "Alexa+ is in preview for select partners, so this page is a real MCP client standing in for it, and it says so."

**0:14 (30 s)** The story's first chapters. The caption types the sentence: "My husband died last week. There is a will. He had a bank account, a pension, life insurance, the power bill, a gym and a car." The ring of institutions fills around the desk. The card shows how many things are open and how many certified copies she will need. The voice: the list is made, one firm date (the will to the court within 30 days, "the court's own rule, not legal advice"), and one question, *may I send the routine notices with copies on your behalf?* The story answers "Yes, go ahead." and pulses run out to the institutions. Say: "Six answers, no names, no account numbers. One authorisation, and the routine work starts."

**0:44 (30 s)** The purchase. "Order the certificates." The card: *7 certified copies, $195.95 at the county's fee. Alexa will confirm the payment with you.* The Alexa+ panel appears: confirmation, payment instrument and PIN stay with Alexa. Open **The list, the day bar and the log** and show the log: `/checkout-sessions/…/complete` was called twice with the same `Idempotency-Key`, and the second call is marked *replayed, not re-charged*. Say: "The add-on quotes. Alexa+ confirms and pays. The same key twice buys once."

**1:14 (25 s)** A week passes (the story presses +7 days). Replies arrive as pulses back along the ring, and the day bar shows the replies and the gates they raised. The handoff card says **This one is yours**: gate D1, money leaves the estate (the power company's final bill of $142.17). Hold the button until it reads *Release to approve*, then release: *Written down.* Say: "The desk stopped at the first gate and waited. Five kinds of moment stop it: money leaves the estate, an original leaves her hands, her signature or a visit, anything that cannot be undone, an heir objects."

**1:39 (30 s)** Open **Desk**. The queue lists the other two gates the week raised: the bank wants a certified original (D2) and the pension wants a notarised form (D3). Open the bank's and show **Check before you approve**: the facts, the rule with its source, the text written by code. Hold to approve. Open the pension's, choose **Decline**, then **Not now**. Say: "She checks before she approves. When she declines, the agent leaves the task with her and writes that down."

**2:09 (20 s)** Open **Record**. Every receipt is a block in a hash-chained chain; orbit it once, press **Verify the chain**, and show *Chain intact*. Click **The sibling's read-only page**: statuses only, no documents, no numbers. Say: "Every action is a receipt. A sibling can follow along and cannot change anything."

**2:29 (16 s)** Open **How it works**: the five gates (D5 is an heir's objection), then press **Run the eight-week simulation**. The scoreboard shows 15 interruptions instead of 26, precision 1.0, recall 1.0, forbidden actions 0, 77 receipts, chain verified, 72 spoken strings, 0 policy violations. Say: "A synthetic estate over eight weeks, including a brother who objects about the car. Fifteen questions instead of twenty-six, and the build fails if a gated action runs without approval." End on the scoreboard.

## Why this, why now

- 3,094,593 deaths in the United States in 2025 (CDC provisional, July 2026). Executors do about 500 hours of administrative work over about 18 months (Empathy, *The Grief Tax*, 2026 Workplace Benefits Report; 4,001 employees and 1,502 employers surveyed 8 to 18 Dec 2025, reported by Insurance Business 14 Sep 2026). Two-thirds could not find essential documents; 66% reported panic attacks (Empathy, 2025).
- Social Security takes death reports by phone or in person only, and the payment for the month of death must be returned (USA.gov, updated 31 Aug 2026). Equifax takes no online death reports. Certified copies cost $26 each in San Diego County and institutions keep them.
- The rubric's own creative list names state across sessions, orchestration across services, purchasing and MCP Apps. This add-on does all four.

## Prior art, honestly

Empathy (app plus care team, sold through insurers), Settld (UK, one form notifies 750 companies), Alix, Heirloom and The Drive cover the task list and document reading on the web. Postscript (an entry in AWS's Agents for Humans hackathon, Sep 2026) is the closest build: a background executor's agent with policy gates and a measured simulation on Strands and AgentCore. After Loss Desk differs in surface (voice at home, cards across the room), in the purchase (certified copies through Alexa+ checkout), in the household (the sibling's page), and in being built to the Alexa+ policy (no names or account numbers by voice). We found none on Alexa+.

Sources:

- https://cdc.gov/nchs/blog/posts/2026/07/provisional-data-u-s-death-rate-fell-to-a-record-low-in-2025.html
- https://www.insurancebusinessmag.com/us/news/benefits/bereavement-benefits-emerge-as-a-gap-brokers-can-fill-in-2026-588924.aspx
- https://www.empathy.com/blog/what-loss-really-costs-key-takeaways-from-the-grief-tax
- https://www.usa.gov/social-security-report-a-death
- https://www.elayne.com/resources/how-to-notify-equifax-of-a-death
- https://www.sandiegocounty.gov/hhsa/programs/phs/office_of_vital_records_and_statistics/death_certificates.html
- https://developer.amazon.com/docs/alexaplus/add-ons/implement-checkout-endpoints.html
- https://github.com/Abhinav0905/AWS-Agents-For-Human
