"""One process: the MCP endpoint at /mcp, the Alexa+ checkout REST endpoints, the simulated Alexa+ web client at /, and the
read-only progress page at /share/<token>.

    uv run afterloss serve            (http://127.0.0.1:8300)
"""

from __future__ import annotations

import contextlib
import json
import os
import subprocess
import sys
import tempfile
import threading
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
    # A session manager runs once per process; a second app start (tests, reloads) gets a fresh one on the same route.
    try:
        manager = mcp.session_manager.run()
        await manager.__aenter__()
    except RuntimeError:
        from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
        mcp._session_manager = StreamableHTTPSessionManager(app=mcp._mcp_server, event_store=None, json_response=True, stateless=True)
        for route in app.router.routes:  # the /mcp route must point at the new manager too
            if hasattr(getattr(route, "endpoint", None), "session_manager"):
                route.endpoint.session_manager = mcp._session_manager
        manager = mcp.session_manager.run()
        await manager.__aenter__()
    try:
        yield
    finally:
        await manager.__aexit__(None, None, None)


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

async def _json(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(422, "the body must be JSON")
    if not isinstance(body, dict):
        raise HTTPException(422, "the body must be a JSON object")
    return body


def _once(key: str | None, scope: str, request_id: Any, compute):
    """Run a state-changing checkout call once per Idempotency-Key, scoped to the case (and session). The same key with a different
    request is a 409 idempotency_conflict, as the Alexa+ checkout docs require."""
    try:
        if not key:
            return compute()
        result, replayed = store.idempotent(f"{scope}:{key}", compute, request_id)
    except store.IdempotencyConflict:
        return JSONResponse({"code": "idempotency_conflict", "content": "This Idempotency-Key was already used with a different request."}, status_code=409)
    except checkout.CheckoutRefused as e:
        raise HTTPException(409, str(e))
    return JSONResponse(result, headers={"Idempotent-Replayed": str(replayed).lower()})


@app.post("/checkout-sessions")
async def create_checkout(request: Request, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    body = await _json(request)
    case = _case(str(body.get("case_id", "")))
    def compute():
        try:
            s = checkout.create_session(case, body.get("quantity"))
        except ValueError as e:
            raise HTTPException(422, str(e))
        store.save(case)
        return s
    return _once(idempotency_key, f"create:{case['id']}", ["POST", "/checkout-sessions", body], compute)


@app.patch("/checkout-sessions/{session_id}")
async def update_checkout(session_id: str, request: Request):
    body = await _json(request)
    case = _case(str(body.get("case_id", "")))
    try:
        s = checkout.update_session(case, session_id, body)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if not s:
        raise HTTPException(404, "no such session")
    store.save(case)
    return s


@app.post("/checkout-sessions/{session_id}/complete")
async def complete_checkout(session_id: str, request: Request, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    body = await _json(request)
    case = _case(str(body.get("case_id", "")))
    def compute():
        s = checkout.complete_session(case, session_id)
        if not s:
            raise HTTPException(404, "no such session")
        store.save(case)
        return s
    return _once(idempotency_key, f"complete:{case['id']}:{session_id}", ["POST", f"/checkout-sessions/{session_id}/complete", body], compute)


# ---- the simulated client's side door: clock, documents, objections -----------------------------------------------------

@app.get("/api/cases/{case_id}")
def get_case(case_id: str):
    case = _case(case_id)
    return {"id": case["id"], "today": case["today"], "ledger": engine.ledger_card(case), "due": engine.due_card(case), "progress": engine.progress_card(case),
            "chain_ok": governor.verify_chain(case), "receipts": case["receipts"][-30:], "originals_on_hand": case.get("originals_on_hand", 0)}


@app.get("/api/cases/{case_id}/timeline")
def timeline(case_id: str):
    return engine.timeline(_case(case_id))


@app.get("/api/cases/{case_id}/decisions/{decision_id}")
def decision(case_id: str, decision_id: str):
    d = engine.decision_detail(_case(case_id), decision_id)
    if not d:
        raise HTTPException(404, "no such decision")
    return d


_SCOREBOARD_LOCK = threading.Lock()


@app.get("/api/scoreboard")
def scoreboard():
    """Run the eight-week simulation now in its own process, with its own scratch database, and return the scoreboard the README quotes.
    The server's own AFTERLOSS_DB is never touched, so a request in flight cannot move the live store."""
    with _SCOREBOARD_LOCK, tempfile.TemporaryDirectory() as tmp:
        try:
            r = subprocess.run([sys.executable, "-m", "afterloss.cli", "simulate", "--weeks", "8"], cwd=ROOT, capture_output=True, text=True, timeout=120,
                               env={**os.environ, "AFTERLOSS_DB": os.path.join(tmp, "sim.sqlite3")})
        except subprocess.TimeoutExpired:
            raise HTTPException(504, "the simulation took too long")
    rows = [line.rsplit("  ", 1) for line in r.stdout.splitlines() if "  " in line]
    return {"ok": r.returncode == 0, "rows": [{"key": k.strip(), "value": v.strip()} for k, v in rows]}


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
