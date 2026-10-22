# Friction log (for the submission form: product feedback for every tool used)

## Alexa+ add-on docs and MCP contract
1. **Streamable HTTP path vs mounting.** Mounting the Python SDK's `streamable_http_app()` as a sub-application at `/mcp` returns 405 for `POST /mcp` (the sub-app routes `/`). Fix that cost an hour: set `streamable_http_path="/mcp"` and add the sub-app's routes to the main router. A note in the Alexa+ "host your MCP server" guidance would save every Python entrant the same hour.
2. **Which spec revision.** Alexa+ documents 2025-11-25; the MCP project's current revision is 2026-07-28 (initialize removed, stateless). The Python SDK 1.30 declares 2025-11-25 as latest; 2.x moves on. The add-on docs should say which SDK majors are safe. We pinned `mcp>=1.24,<2`.
3. **MCP Apps in Alexa+.** The design guide says MCP Apps render in an Alexa-provided webview, but there is no statement of which app-protocol revision Alexa+ speaks (`ui/initialize` and `ui/notifications/tool-result` per the 2026-01-26 extension) or whether `_meta.ui.resourceUri` is read. We implemented the extension by hand and fall back to text.
4. **Checkout docs.** `implement-checkout-endpoints` is clear on `POST /checkout-sessions`, `/complete` and the `Idempotency-Key`, but gives no sandbox or simulator for the handoff. We simulated the device confirmation in the web client and tested idempotent replay in code; a hosted sandbox that calls an entrant's endpoints would turn that into a real test.
5. **Policy s.3 and voice.** "Private personal information via voice" has no list of examples. We treated names, account and reference numbers, amounts tied to a person, and typed institution labels as private, and enforced it with a test. A list of what reviewers reject would let builders enforce the same thing.
6. **No toolkit, no simulator for entrants.** Every Alexa+ entrant builds their own simulated client. Shipping a reference web client (initialize, tools/list, tools/call, a card renderer) with the hackathon would have saved a day per team and made entries comparable.

## Devpost
7. The project gallery was unpublished for the whole submission window; entrants could not see the field. The "submit early, keep editing" note (21 Oct) was the most useful update and should be in the rules from day one.
