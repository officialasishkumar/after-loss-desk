# Devpost submission text (copy into the form)

**Project name:** After Loss Desk
**Tagline:** The executor's desk on the Echo: who to tell, by when, with what; it asks only at five gates.
**Track:** Alexa+. **Mini challenges:** none claimed unless a separate open-source contribution is made.

**Inspiration.** About 3.1 million Americans die a year. The person left to settle their affairs spends about 500 hours over about 18 months on notices, chases and certified copies (Empathy, 2026). Almost none of it needs judgement; it needs persistence and someone to ask at the few moments that are hers.

**What it does.** An Alexa+ add-on (MCP server, spec 2025-11-25, Streamable HTTP). From six voice answers it builds the ledger of who must be told and by when from a cited rule table (California), sends the routine notices with copies on one standing authorisation, chases silence, escalates to certified mail, orders the certified copies the ledger needs through Alexa+ checkout, and interrupts only at five gates decided in code: money leaves the estate, an original leaves her hands, her signature or a visit, anything irreversible, an heir objects. State lives for months; every action is a hash-chained receipt; a sibling gets a read-only page. No name or account number is ever spoken; the one amount it speaks is the certified-copy order total, which the executor must hear to approve the purchase.

**How we built it.** Python, FastMCP (mcp 1.30, stateless Streamable HTTP, JSON responses), FastAPI, SQLite. Eight tools, one intent each, closed schemas. An MCP App resource (`ui://afterloss/card.html`) referenced from every tool's `_meta.ui.resourceUri`. The documented checkout endpoints with `Idempotency-Key` results kept 24 h. Drafts are templates filled by code (optional model re-phrasing is kept only if every fact survives). A replayable eight-week simulation scores the agent against a ground truth written before the run and fails the build if recall drops below 1.0 or a gated action runs without approval. A web page that is a real MCP client stands in for Alexa+ and is labelled as such: four pages (Echo as the Echo Show screen, with a dawn gradient that follows the desk's state, a ring of institutions with pulses for notices and replies, and a day bar; Desk with check-before-you-approve and hold-to-approve; Record with every receipt as a list and as a WebGL hash chain; How it works with the live scoreboard), Manrope and IBM Plex Mono, light and dark, one meaning per colour and never colour alone.

**Challenges.** The Alexa+ toolkit is preview-only, so the device side is simulated honestly. Mounting the SDK's Streamable HTTP app under FastAPI returns 405 until the routes are added to the main router. Deciding what "private personal information via voice" means and enforcing it with a test.

**Accomplishments.** 15 interruptions instead of 27 over eight weeks, precision 1.0, recall 1.0, forbidden actions 0, 77 receipts verified, 72 spoken strings with 0 policy violations. Four items from the rubric's creative list in one add-on: state across sessions, orchestration across services, purchasing, MCP Apps; plus an Agent Skill.

**What we learned.** The governor must be code, not a prompt; the voice layer must be provably free of private data; a rule table with a source per row is the product.

**What's next.** More states as JSON; real institution adapters (mail and e-forms); the Alexa+ private preview.

**Built With:** python, fastapi, mcp, model-context-protocol, streamable-http, mcp-apps, alexa-plus, sqlite, uvicorn, universal-commerce-protocol, three.js, web-speech-api, css-3d
**Gallery images:** docs/img/pitch-1440.jpg (the pitch), docs/img/echo-1440.jpg, docs/img/desk-1440.jpg, docs/img/record-1440.jpg, plus the architecture diagram (screenshot the How page).
**Try it out:** repository URL, and either of these.
- **Run it locally:** `uv sync`, then `uv run afterloss serve`, then open http://127.0.0.1:8300. The MCP endpoint is `/mcp` (http://127.0.0.1:8300/mcp). It needs `uv` only.
- **Hosted:** https://after-loss-desk-647733667799.us-west1.run.app/ (MCP endpoint https://after-loss-desk-647733667799.us-west1.run.app/mcp). On Cloud Run the case store lives on the instance and resets on a cold start; a judge who starts a case and plays it through in one sitting is unaffected.
**Video:** under 3 minutes; order in docs/PITCH.md.

## Product feedback (required for every tool used)
Paste from docs/FRICTION.md. Part 1 answers the required questions for each tool (MCP Python SDK, Alexa+ add-on docs, Alexa+ checkout docs, Devpost): used for, worked well, needs work, onboarding, and whether we would build again. Part 2 holds the eight friction-log entries (task, steps, expected and actual result, severity, workaround, suggestion), which the rules score as the optional friction log.

## Checklist before the deadline (23 Oct 12:00 PT / 24 Oct 00:30 IST)
- Hosting is optional (the hackathon FAQ: a locally runnable public repo plus the demo video is enough). We deploy to Cloud Run with `deploy/cloudrun.sh` (free tier, scale to zero, one instance, `PUBLIC_URL` set by the script); if it is up, keep it up until judging ends on 20 Nov.
- Licence visible at the top of the README (MIT, yes).
- Teammates added and accepted (Akash).
- Video uploaded early; it can be replaced until the deadline.
- After the deadline: no commits, no video edits, no form edits until 3 Dec.
