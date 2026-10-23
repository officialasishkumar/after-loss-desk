# About the project (paste into Devpost as is)

## Inspiration

About 3.1 million Americans die a year. The person left to settle the affairs, usually a spouse or an adult child, spends roughly 500 hours over 18 months telling banks, pensions, insurers, utilities, the credit bureaus and Social Security, chasing replies, and buying certified copies of the death certificate again and again. Almost none of it needs judgement. It needs persistence, a list, and someone to ask at the few moments that are genuinely hers: when money leaves the estate, when an original leaves her hands, when her signature is needed, when something cannot be undone, when an heir objects. Alexa+ households skew older, and the Echo is already in the kitchen where this paperwork piles up. That is where the desk belongs.

## What it does

After Loss Desk is an Alexa+ add-on: an MCP server (spec 2025-11-25, Streamable HTTP) with eight tools, one per customer intent, closed schemas, no free text. From six voice answers (relationship, state, will or not, which kinds of accounts) it builds the ledger of who must be told and by when from a rule table with a source per row (California), sends the routine notices with copies on one standing authorisation, chases silence, escalates to certified mail, and orders the certified copies the ledger needs through Alexa+ checkout. It interrupts only at five gates decided in code: D1 money leaves the estate, D2 an original leaves her hands, D3 her signature or a visit, D4 anything irreversible, D5 an heir objects. State lives for months. Every action, reply and decision is a hash-chained receipt. A sibling gets a read-only page with statuses only. No name or account number is ever spoken; a test rejects digits and names in every spoken string.

## How we built it

Python, FastMCP (`mcp` 1.30, stateless Streamable HTTP, JSON responses), FastAPI, SQLite. An MCP App resource (`ui://afterloss/card.html`) referenced from every tool's `_meta.ui.resourceUri` renders the cards. Checkout endpoints modelled on the Alexa+ checkout flow: create, update and complete, with `Idempotency-Key` results kept 24 hours and 409 on a changed body; the demo sends `complete` twice with the same key and the record shows the second replayed, not re-charged. Drafts are templates with facts filled by code; optional model re-phrasing is kept only if every fact survives. A five-gate governor runs before every action and the receipt chain is scanned for the approval before anything gated executes. A replayable eight-week simulation scores the agent against a ground truth written before the run and fails the build if recall drops below 1.0 or a gated action runs without approval. An Agent Skill (`SKILL.md`) describes the same tools for agent hosts.

Because the Alexa+ toolkit is preview-only, the device side is simulated honestly: the web page is a real MCP client (initialize, tools/list, tools/call) standing in for Alexa+, labelled as such, drawn as the Echo Show screen. A dawn gradient follows the desk's state (violet while listening, amber while a gate waits), the card sits in large type, and every institution is an icon on a ring around the desk with a pulse that runs out when a notice goes and back when a reply lands. The Desk page shows each gate with the facts at a glance and a hold-to-approve control. The Record page shows every receipt as a hash chain you can orbit and verify. The How page runs the eight-week simulation live and charts it.

## Challenges we ran into

The Streamable HTTP app returns 405 when mounted under FastAPI until its routes are added to the main router. The docs do not name which MCP Apps revision Alexa+ speaks. "Private personal information via voice" has no examples, so we had to decide what it means (closed enums, labels only on cards) and enforce it with a test. There is no checkout sandbox, so idempotency is proven by our own tests rather than by Alexa+. And the toolkit itself is preview-only, so the whole experience had to be shown through a client we wrote and labelled.

## Accomplishments that we're proud of

Over eight simulated weeks: 15 interruptions where a confirm-everything agent would have asked 26, precision 1.0, recall 1.0, 0 forbidden actions, 17 of 17 tasks done, 77 receipts with the chain verified, 72 spoken strings with 0 policy violations. Four items from the rubric's creative list in one add-on: state across sessions, orchestration across services, purchasing, MCP Apps; plus an Agent Skill. A friction log of eight entries and feature requests for the Alexa+ team.

## What we learned

The governor must be code, not a prompt. The voice layer must be provably free of private data, which means closed schemas and a test, not a guideline. A rule table with a source per row is the product; everything else serves it. And a simulation with a ground truth written before the run is the only honest way to claim "it asks less and misses nothing".

## What's next for After Loss Desk

More states as JSON rule tables. Real institution adapters (mail and e-forms). The s.16 purchase rules (written confirmation, refund policy before purchase). The Alexa+ private preview, so the add-on runs on a real Echo.

---

**Built with (tags):** python, fastapi, mcp, model-context-protocol, streamable-http, mcp-apps, alexa-plus, alexa, agent-skills, sqlite, uvicorn, pydantic, pytest, docker, google-cloud-run, javascript, html5, css3, svg, three.js, webgl, web-speech-api, kokoro-tts, playwright, ffmpeg

**AWS services used:** none. Hosting is Google Cloud Run (`deploy/cloudrun.sh`); the add-on itself is a plain HTTP server with no cloud dependency.

**Existed before the hackathon?** No. Everything was built during the submission window (23 Oct 2026).
