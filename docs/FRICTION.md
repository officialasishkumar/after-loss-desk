# Friction log and product feedback

Written for the submission form. Part 1 is the product feedback the rules require for every tool used. Part 2 is the friction log (the optional entries the rules score), one entry per problem we hit, each with the task, steps, expected and actual result, severity, workaround and suggestion.

Severity scale. **High**: blocked the work or cost an hour or more. **Medium**: needed a workaround, or limits what we can honestly claim. **Low**: an inconvenience.

## Part 1. Product feedback, tool by tool

### MCP Python SDK (`mcp` 1.30, FastMCP)
- **Used for.** The add-on's server: eight tools over stateless Streamable HTTP with JSON responses, one resource (`ui://afterloss/card.html`) for the MCP App card, mounted in a FastAPI app next to the checkout endpoints and the web client.
- **Worked well.** A tool is a decorated function, and `Literal` type hints become the closed schemas the voice policy needs (relationship, account kinds, reply kinds, decline reasons). `stateless_http=True` with `json_response=True` gives a plain request and response server that a real MCP client drives in our tests (`tests/test_web_and_mcp.py`).
- **Needs work.** Mounting under FastAPI (friction item 1) and the spec revision each SDK major speaks (item 2).
- **Onboarding (zero to hello world).** Quick: one decorated function is a working tool. The only stall was the 405 under FastAPI, about an hour.
- **Build again.** Yes. The decorator model produced closed schemas from type hints, which is what the Alexa+ voice policy asks for. We would pin the major version and want a documented FastAPI mounting example.

### Alexa+ add-on docs (design guide, layout and rendering guide, policy and certification pages)
- **Used for.** The shape of every reply (`speak` under thirty seconds, at most five items, one title and one action per card), the MCP App card, and the policy mapping in `docs/POLICY.md`.
- **Worked well.** The rules are concrete enough to turn into code and tests: reply length, item counts, far-field card layout, and the policy lines on private data, legal information and crisis redirects. The layout and rendering guide describes the postMessage bridge, `hostContext` and `_meta.ui.csp`.
- **Needs work.** No named MCP Apps revision (item 3), no list of what reviewers count as private data by voice (item 5), no way to guarantee what Alexa says from the data we return (item 7), no toolkit or simulator for entrants (item 6).
- **Onboarding (zero to hello world).** The docs were enough to build the contract. They did not let us run it against Alexa+, because the toolkit is preview-only, so our loop ended at a client we wrote ourselves.
- **Build again.** Yes. The rules are specific enough to enforce in code. We would want a way to run an add-on against Alexa+ before submitting it.

### Alexa+ checkout docs (`implement-checkout-endpoints`, 19 Aug 2026)
- **Used for.** The purchase of certified copies: `POST /checkout-sessions`, `PATCH /checkout-sessions/{id}`, `POST /checkout-sessions/{id}/complete`, and `Idempotency-Key` results kept for 24 hours.
- **Worked well.** The endpoint shapes and the idempotency rule are exact, so we could test replay in code: the second `complete` with the same key returns the first result and is marked as replayed.
- **Needs work.** No sandbox or simulator for the handoff (item 4).
- **Onboarding (zero to hello world).** Reading to a passing idempotency test was straightforward. Seeing how Alexa+ itself would call the endpoints was not possible.
- **Build again.** Yes. A purchase with a clear handoff (the add-on quotes, Alexa+ confirms, picks the instrument and takes the PIN) is the right split. A hosted sandbox would make it testable end to end.

### Devpost
- **Used for.** The rules, the submission form, the project gallery and the organiser updates.
- **Worked well.** The rubric and the list of what to submit were clear. The "submit early, keep editing" update of 21 Oct was the most useful message of the window.
- **Needs work.** The gallery was unpublished while we built (item 8).
- **Onboarding (zero to hello world).** Registering and adding a teammate was quick.
- **Build again.** Yes. The format rewards a working build with a measured claim, and the rubric told us what to measure.

### Feature requests
| Request | Rating |
|---|---|
| A hosted checkout sandbox that calls an entrant's `/checkout-sessions` endpoints and shows the confirmation step | Important |
| A reference web client (initialize, tools/list, tools/call, a card renderer) shipped with the toolkit, so entries are comparable | Important |
| A documented way to mark which result fields Alexa may speak and which are display only | Important |
| A version line for the MCP Apps revision and the SDK majors Alexa+ supports | Nice to have |

## Part 2. Friction log

### 1. Streamable HTTP path under a FastAPI mount
- **Task.** Serve the Alexa+ MCP endpoint at `/mcp` from the same FastAPI process as the checkout endpoints and the web client.
- **Steps.** Create the server with FastMCP (`stateless_http=True`, `json_response=True`). Mount the SDK's `streamable_http_app()` as a sub-application at `/mcp`. Send `initialize` with `POST /mcp`.
- **Expected.** A JSON result for `initialize`.
- **Actual.** `405 Method Not Allowed`. The sub-application routes `/`, so the mount does not answer `POST /mcp`.
- **Severity.** High. The endpoint did not work at all, and the fix cost an hour.
- **Workaround.** Set `streamable_http_path="/mcp"` and add the sub-application's routes to the main router instead of mounting it (`afterloss/web.py`). The application's lifespan then has to start the SDK's session manager. A manager runs once per process, so the lifespan builds a fresh `StreamableHTTPSessionManager` when the app starts a second time (tests, reloads).
- **Suggestion.** A short note in the Alexa+ "host your MCP server" guidance, and a FastAPI example in the SDK docs that shows the route path and the lifespan together. It would save every Python entrant the same hour.

### 2. Which spec revision and SDK major to build against
- **Task.** Choose the MCP protocol revision and the SDK version for an add-on Alexa+ will call.
- **Steps.** Read the Alexa+ add-on docs, which name 2025-11-25. Read the MCP project's current revision, 2026-07-28 (initialize removed, stateless). Check the Python SDK: 1.30 declares 2025-11-25 as latest, and 2.x moves on.
- **Expected.** The add-on docs say which SDK majors are safe and what happens as the MCP project's revision moves on.
- **Actual.** The docs name 2025-11-25 and nothing about SDK majors or newer revisions.
- **Severity.** Medium. A mismatch would show only on a real Alexa+ client, which we cannot test against.
- **Workaround.** Pin `mcp>=1.24,<2` and serve 2025-11-25.
- **Suggestion.** State the revision Alexa+ speaks, the SDK majors known to work, and the plan for newer revisions.

### 3. MCP Apps in Alexa+: the revision is not named
- **Task.** Render every tool result as one card with an MCP App, the way the add-on design guide describes.
- **Steps.** Read the design guide and the layout and rendering guide. Implement the card (`ui://afterloss/card.html`) with `_meta.ui.resourceUri` on every tool and the `ui/initialize` and `ui/notifications/tool-result` messages of the 2026-01-26 extension, by hand.
- **Expected.** The guide names the MCP Apps revision Alexa+ implements, so the hand-written handshake can be checked against it.
- **Actual.** The layout and rendering guide does document the postMessage bridge, the `hostContext` object, `_meta.ui.csp` and `host-context-changed`. It does not name the revision, and it does not say whether `ui/initialize` is required. Our card does not yet read `hostContext` (theme, device class).
- **Severity.** Low to Medium. The documented parts were enough to build the card. The unnamed revision leaves guesswork in the handshake.
- **Workaround.** Implement the 2026-01-26 messages by hand. Hosts without MCP Apps get the text result and the `speak` string.
- **Suggestion.** A version line in the layout and rendering guide, and one sentence on whether `ui/initialize` is required.

### 4. Checkout docs have no sandbox
- **Task.** Test the purchase of certified copies the way Alexa+ will run it.
- **Steps.** Implement `POST /checkout-sessions`, `PATCH /checkout-sessions/{id}` and `/complete` from `implement-checkout-endpoints`, with `Idempotency-Key` kept for 24 hours. Look for a way to have Alexa+ call them.
- **Expected.** A sandbox or simulator that calls an entrant's endpoints and shows the confirmation step.
- **Actual.** None. The doc is clear on the shapes and the key, and gives no way to exercise the handoff.
- **Severity.** Medium. The most valuable part of the purchase, the handoff, is the part we could not test.
- **Workaround.** The web client plays the device confirmation and calls `/complete` twice with the same key, so the log shows the second call replayed. Idempotent replay is tested in code (`tests/test_web_and_mcp.py`).
- **Suggestion.** A hosted sandbox that calls an entrant's endpoints.

### 5. "Private personal information via voice" has no examples
- **Task.** Enforce policy s.3, which rejects an add-on that collects or recites private personal information via voice.
- **Steps.** Read s.3 in the policy page. Decide what counts as private, and write a check for every spoken string.
- **Expected.** A list of examples, or of what reviewers reject.
- **Actual.** No list.
- **Severity.** Medium. We could be too strict or too loose and not know which.
- **Workaround.** We treated names, account and reference numbers, runs of three or more digits, and the institution names the executor typed as private. Dollar amounts are allowed, and the only one spoken is the checkout quote the executor must hear to approve. The rule is enforced by `afterloss/policy.py` and a test.
- **Suggestion.** A list of what reviewers reject, so builders can enforce the same thing.

### 6. No toolkit or simulator for entrants
- **Task.** Drive the add-on the way Alexa+ will, with speech in and `speak` and a card out.
- **Steps.** Look for the MCP Toolkit, a simulator or a reference client. The toolkit is preview-only for select partners.
- **Expected.** Something to run the add-on against.
- **Actual.** Nothing available to entrants. Every team builds its own client.
- **Severity.** Medium. It cost about a day, and every entry shows a different simulated device.
- **Workaround.** We built the page in `site/`: a real MCP client (initialize, tools/list, tools/call over Streamable HTTP) labelled "Simulated Alexa+".
- **Suggestion.** Ship a reference web client with the hackathon. Entries become comparable and each team saves a day.

### 7. Add-ons cannot script what Alexa says
- **Task.** Guarantee that an add-on never recites private data by voice.
- **Steps.** Read the MCP Add-on Design Guide (last modified 21 Jul 2026) and the conversation surface page. Return a checked `speak` string and a `card` from every tool.
- **Expected.** A documented field, or a rule, that makes Alexa say a given string, or not say a given field.
- **Actual.** The design guide says "You can't script what Alexa says". The conversation surface page says an add-on influences the response "through the data you return, not by scripting it directly." Our guarantee is proven for `speak` and for the simulated client, not for what the real assistant composes from the whole tool result.
- **Severity.** Medium. It limits what any add-on can promise about private data, and the policy rejects such add-ons.
- **Workaround.** Keep private data out of the fields meant to be voiced: closed enums for input, no names or account numbers in `speak`, and a test on every spoken string. Fields meant for the screen are not covered by that test.
- **Suggestion.** A documented way to mark result fields as display only, or an official statement of how the assistant uses fields outside the speech text.

### 8. Devpost gallery hidden during the window
- **Task.** See what other entrants were building while we built.
- **Steps.** Open the project gallery during the submission window.
- **Expected.** Published entries.
- **Actual.** The gallery was unpublished for the whole window, so entrants could not see the field.
- **Severity.** Low.
- **Workaround.** We worked from the rules and the organiser updates. The "submit early, keep editing" update of 21 Oct was the most useful.
- **Suggestion.** Publish the gallery, or say plainly that it stays hidden. Put the "submit early, keep editing" note in the rules from day one.
