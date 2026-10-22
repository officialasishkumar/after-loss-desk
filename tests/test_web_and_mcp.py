"""Contract tests: the real web app (checkout endpoints, side door, share page) and a real MCP client over Streamable HTTP."""

import asyncio
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from mcp import ClientSession
try:
    from mcp.client.streamable_http import streamable_http_client as http_client
except ImportError:
    from mcp.client.streamable_http import streamablehttp_client as http_client

ROOT = Path(__file__).resolve().parent.parent


def test_checkout_endpoints_follow_the_documented_shape_and_idempotency():
    from afterloss.web import app
    from afterloss.simulate import demo_case
    with TestClient(app) as c:
        case = demo_case()
        r = c.post("/checkout-sessions", json={"case_id": case["id"]}, headers={"Idempotency-Key": "create-1"})
        assert r.status_code == 200 and r.json()["status"] == "created" and r.headers["Idempotent-Replayed"] == "false"
        sid = r.json()["id"]
        again = c.post("/checkout-sessions", json={"case_id": case["id"]}, headers={"Idempotency-Key": "create-1"})
        assert again.json()["id"] == sid and again.headers["Idempotent-Replayed"] == "true"
        upd = c.patch(f"/checkout-sessions/{sid}", json={"case_id": case["id"], "fulfillment": {"destination": "12 Elm St"}})
        assert upd.json()["fulfillment"]["destination"] == "12 Elm St"
        done = c.post(f"/checkout-sessions/{sid}/complete", json={"case_id": case["id"]}, headers={"Idempotency-Key": "complete-1"})
        assert done.json()["status"] == "completed" and done.json()["order_id"].startswith("ord_")
        twice = c.post(f"/checkout-sessions/{sid}/complete", json={"case_id": case["id"]}, headers={"Idempotency-Key": "complete-1"})
        assert twice.json() == done.json() and twice.headers["Idempotent-Replayed"] == "true"
        page = c.get(f"/api/cases/{case['id']}")
        assert page.status_code == 200 and page.json()["chain_ok"]
        share = c.get(f"/share/{case['share_token']}")
        assert share.status_code == 200 and "Read-only" in share.text and "First Federal" not in share.text
        assert c.get("/").status_code == 200 and "Simulated Alexa+ add-on" in c.get("/").text


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server_url(tmp_path_factory):
    port = free_port()
    env = {**os.environ, "PORT": str(port), "AFTERLOSS_DB": str(tmp_path_factory.mktemp("db") / "s.sqlite3")}
    p = subprocess.Popen([sys.executable, "-m", "uvicorn", "afterloss.web:app", "--port", str(port), "--log-level", "warning"], cwd=ROOT, env=env)
    deadline = time.time() + 40
    while time.time() < deadline:
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.5).close()
            break
        except OSError:
            time.sleep(0.2)
    else:
        p.kill()
        pytest.fail("server did not start")
    yield f"http://127.0.0.1:{port}/mcp"
    p.terminate()
    p.wait(timeout=10)


async def drive(url: str):
    async with http_client(url) as (read, write, _):
        async with ClientSession(read, write) as s:
            init = await s.initialize()
            tools = {t.name: t for t in (await s.list_tools()).tools}
            res = {t.uri if hasattr(t, "uri") else str(t): t for t in (await s.list_resources()).resources}
            card = await s.read_resource("ui://afterloss/card.html")
            start = await s.call_tool("start_case", {"date_of_death": "2026-10-01", "relationship": "spouse", "has_will": True, "account_kinds": ["bank", "utilities"]})
            out = start.structuredContent or json.loads(start.content[0].text)
            d0 = out["card"]["action"]["decision_id"]
            ok = await s.call_tool("approve", {"case_id": out["case_id"], "decision_id": d0})
            okj = ok.structuredContent or json.loads(ok.content[0].text)
            quote = await s.call_tool("order_certificates", {"case_id": out["case_id"]})
            qj = quote.structuredContent or json.loads(quote.content[0].text)
            bad = await s.call_tool("whats_due", {"case_id": "nope"})
            return init, tools, res, card, out, okj, qj, bad


def test_mcp_client_runs_the_add_on_over_streamable_http(server_url):
    init, tools, res, card, out, okj, qj, bad = asyncio.run(drive(server_url))
    assert init.serverInfo.name == "after-loss-desk" and init.protocolVersion == "2025-11-25"
    assert set(tools) == {"start_case", "whats_due", "draft_notice", "approve", "decline", "record_reply", "order_certificates", "share_progress"}
    for t in tools.values():
        assert (t.meta or {}).get("ui", {}).get("resourceUri") == "ui://afterloss/card.html", t.name
    sc = tools["start_case"].inputSchema
    assert set(sc["required"]) >= {"date_of_death", "relationship", "has_will", "account_kinds"}
    assert "spouse" in json.dumps(sc) and "Relationship" in json.dumps(sc) or "enum" in json.dumps(sc)
    assert any(str(u).startswith("ui://afterloss/card.html") for u in res)
    assert card.contents[0].mimeType == "text/html;profile=mcp-app" and "ui/notifications/tool-result" in card.contents[0].text
    assert out["speak"] and out["card"]["kind"] == "ledger" and out["card"]["originals_needed"] >= 4
    assert "First Federal" not in out["speak"] and "988" in out["speak"]
    assert okj["card"]["kind"] == "due"
    assert qj["card"]["kind"] == "quote" and qj["card"]["session_id"].startswith("cs_") and qj["card"]["checkout"]["complete"].endswith("/complete")
    assert bad.isError or "error" in json.dumps(bad.structuredContent or bad.content[0].text)
