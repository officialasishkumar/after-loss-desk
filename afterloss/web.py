"""One process: the MCP endpoint at /mcp, the Alexa+ checkout REST endpoints, the simulated Alexa+ web client at /, and the
read-only progress page at /share/<token>.

    uv run afterloss serve            (http://127.0.0.1:8300)
"""

from __future__ import annotations

import contextlib
import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware

from . import checkout, engine, governor, store
from .mcp_server import mcp

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    async with mcp.session_manager.run():
        yield


app = FastAPI(title="After Loss Desk", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], expose_headers=["Mcp-Session-Id"])
# The MCP route is added to this app's router directly (not mounted as a sub-app), so POST /mcp works without a trailing slash.
app.router.routes.extend(mcp.streamable_http_app().routes)


def _case(case_id: str) -> dict[str, Any]:
    c = store.load(case_id)
    if not c:
        raise HTTPException(404, "no such case")
    return c


# ---- Alexa+ checkout endpoints (shapes per developer.amazon.com implement-checkout-endpoints, 19 Aug 2026) ----------------

@app.post("/checkout-sessions")
async def create_checkout(request: Request, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    body = await request.json()
    case = _case(body.get("case_id", ""))
    def compute():
        s = checkout.create_session(case, body.get("quantity"))
        store.save(case)
        return s
    if idempotency_key:
        result, replayed = store.idempotent(f"create:{idempotency_key}", compute)
        return JSONResponse(result, headers={"Idempotent-Replayed": str(replayed).lower()})
    return compute()


@app.patch("/checkout-sessions/{session_id}")
async def update_checkout(session_id: str, request: Request):
    body = await request.json()
    case = _case(body.get("case_id", ""))
    s = checkout.update_session(case, session_id, body)
    if not s:
        raise HTTPException(404, "no such session")
    store.save(case)
    return s


@app.post("/checkout-sessions/{session_id}/complete")
async def complete_checkout(session_id: str, request: Request, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    body = await request.json()
    case = _case(body.get("case_id", ""))
    def compute():
        s = checkout.complete_session(case, session_id)
        if not s:
            raise HTTPException(404, "no such session")
        store.save(case)
        return s
    if idempotency_key:
        result, replayed = store.idempotent(f"complete:{idempotency_key}", compute)
        return JSONResponse(result, headers={"Idempotent-Replayed": str(replayed).lower()})
    return compute()


# ---- the simulated client's side door: clock, documents, objections -----------------------------------------------------

@app.get("/api/cases/{case_id}")
def get_case(case_id: str):
    case = _case(case_id)
    return {"id": case["id"], "today": case["today"], "ledger": engine.ledger_card(case), "due": engine.due_card(case), "progress": engine.progress_card(case),
            "chain_ok": governor.verify_chain(case), "receipts": case["receipts"][-30:], "originals_on_hand": case.get("originals_on_hand", 0)}


@app.post("/api/cases/{case_id}/advance")
async def advance(case_id: str, request: Request):
    body = await request.json()
    case = _case(case_id)
    out = engine.advance(case, int(body.get("days", 1)))
    return {"today": case["today"], **out, "due": engine.due_card(case)}


@app.post("/api/cases/{case_id}/labels")
async def set_labels(case_id: str, request: Request):
    """The executor types institution names on the web client; they go on cards, never into voice."""
    body = await request.json()
    case = _case(case_id)
    for t in case["tasks"]:
        if t["id"] in body:
            t["label"] = str(body[t["id"]])[:60]
    store.save(case)
    return {"ok": True}


@app.post("/api/cases/{case_id}/objection")
async def objection(case_id: str, request: Request):
    body = await request.json()
    case = _case(case_id)
    d = engine.object_to(case, body["task_id"], body.get("who", "an heir"))
    return {"decision": d, "due": engine.due_card(case)}


@app.post("/api/cases/{case_id}/agreed")
async def agreed(case_id: str, request: Request):
    body = await request.json()
    case = _case(case_id)
    out = engine.lift_objection(case, body["task_id"], body.get("note", "the heirs agreed"))
    return {"result": out, "due": engine.due_card(case)}


@app.get("/share/{token}", response_class=HTMLResponse)
def share(token: str):
    case = store.find_by_share_token(token)
    if not case:
        raise HTTPException(404, "no such link")
    card = engine.progress_card(case)
    rows = "".join(f"<li class='{t['status']}'><span>{t['title']}</span><b>{t['status'].replace('_', ' ')}</b></li>" for t in case["tasks"])
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>After Loss Desk: progress</title>
<link rel="stylesheet" href="/style.css"></head><body class="share"><main><h1>{card['done']} of {card['total']} done</h1>
<p class="muted">Read-only. As of {card['today']}. {card['waiting']} waiting on replies, {card['parked']} waiting on the executor. Receipt chain {'intact' if card['chain_ok'] else 'BROKEN'} ({card['receipts']} entries).</p>
<ul class="share-list">{rows}</ul></main></body></html>"""


app.mount("/", StaticFiles(directory=SITE, html=True), name="site")
