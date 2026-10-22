# Devpost submission text (copy into the form)

**Project name:** After Loss Desk
**Tagline:** The executor's desk on the Echo: who to tell, by when, with what; it asks only at five gates.
**Track:** Alexa+. **Mini challenges:** none claimed unless a separate open-source contribution is made.

**Inspiration.** About 3.1 million Americans die a year. The person left to settle their affairs spends about 500 hours over about 18 months on notices, chases and certified copies (Empathy, 2026). Almost none of it needs judgement; it needs persistence and someone to ask at the few moments that are hers.

**What it does.** An Alexa+ add-on (MCP server, spec 2025-11-25, Streamable HTTP). From six voice answers it builds the ledger of who must be told and by when from a cited rule table (California), sends the routine notices with copies on one standing authorisation, chases silence, escalates to certified mail, orders the certified copies the ledger needs through Alexa+ checkout, and interrupts only at five gates decided in code: money leaves the estate, an original leaves her hands, her signature or a visit, anything irreversible, an heir objects. State lives for months; every action is a hash-chained receipt; a sibling gets a read-only page. No name, number or amount is ever spoken.

**How we built it.** Python, FastMCP (mcp 1.30, stateless Streamable HTTP, JSON responses), FastAPI, SQLite. Eight tools, one intent each, closed schemas. An MCP App resource (`ui://afterloss/card.html`) referenced from every tool's `_meta.ui.resourceUri`. The documented checkout endpoints with `Idempotency-Key` results kept 24 h. Drafts are templates filled by code (optional model re-phrasing is kept only if every fact survives). A replayable eight-week simulation scores the agent against a ground truth written before the run and fails the build if recall drops below 1.0 or a gated action runs without approval. A web page that is a real MCP client stands in for Alexa+ and is labelled as such.

**Challenges.** The Alexa+ toolkit is preview-only, so the device side is simulated honestly. Mounting the SDK's Streamable HTTP app under FastAPI returns 405 until the routes are added to the main router. Deciding what "private personal information via voice" means and enforcing it with a test.

**Accomplishments.** 15 interruptions instead of 27 over eight weeks, precision 1.0, recall 1.0, forbidden actions 0, 77 receipts verified, 72 spoken strings with 0 policy violations. Four items from the rubric's creative list in one add-on: state across sessions, orchestration across services, purchasing, MCP Apps; plus an Agent Skill.

**What we learned.** The governor must be code, not a prompt; the voice layer must be provably free of private data; a rule table with a source per row is the product.

**What's next.** More states as JSON; real institution adapters (mail and e-forms); the Alexa+ private preview.

**Built With:** python, fastapi, mcp, model-context-protocol, streamable-http, mcp-apps, alexa-plus, sqlite, uvicorn, universal-commerce-protocol
**Try it out:** repository URL; hosted URL (fill in after deploy); MCP endpoint `<host>/mcp`.
**Video:** under 3 minutes; order in docs/PITCH.md.

## Product feedback (required for every tool used)
Use docs/FRICTION.md, items 1 to 6 for the Alexa+ docs, MCP SDK and checkout docs; item 7 for Devpost.

## Checklist before the deadline (23 Oct 12:00 PT / 24 Oct 00:30 IST)
- Host the server over HTTPS (Docker image provided) and set `PUBLIC_URL`; keep it live until 20 Nov.
- Licence visible at the top of the README (MIT, yes).
- Teammates added and accepted (Akash).
- Video uploaded early; it can be replaced until the deadline.
- After the deadline: no commits, no video edits, no form edits until 3 Dec.
