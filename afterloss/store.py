"""Case store: one JSON document per case in SQLite, so state survives restarts and the server can run for weeks.

The document holds the case facts, the task ledger, decisions, tickets, checkout sessions and the receipt chain. Nothing in it
is a person's name: the executor's relationship, the state and account categories are enough for the ledger, and the voice layer
never needs more. Institution labels the executor types ("Wells Fargo") stay in the document and on cards; they are never spoken.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any

_LOCK = threading.RLock()


def db_path() -> Path:
    p = Path(os.environ.get("AFTERLOSS_DB", "data/afterloss.sqlite3"))
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(db_path(), isolation_level=None, check_same_thread=False)
    c.execute("CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated TEXT NOT NULL)")
    c.execute("CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, result TEXT NOT NULL, expires REAL NOT NULL)")
    return c


def load(case_id: str) -> dict[str, Any] | None:
    with _LOCK, _conn() as c:
        row = c.execute("SELECT doc FROM cases WHERE id=?", (case_id,)).fetchone()
    return json.loads(row[0]) if row else None


def save(doc: dict[str, Any]) -> None:
    from datetime import datetime, timezone
    with _LOCK, _conn() as c:
        c.execute("INSERT OR REPLACE INTO cases (id, doc, updated) VALUES (?, ?, ?)",
                  (doc["id"], json.dumps(doc, ensure_ascii=False), datetime.now(timezone.utc).isoformat()))


def find_by_share_token(token: str) -> dict[str, Any] | None:
    with _LOCK, _conn() as c:
        for (doc,) in c.execute("SELECT doc FROM cases"):
            d = json.loads(doc)
            if d.get("share_token") == token:
                return d
    return None


def idempotent(key: str, compute, ttl_seconds: float = 24 * 3600) -> tuple[dict[str, Any], bool]:
    """Return the stored result for `key` if it exists and has not expired, else compute, store and return it.
    Alexa+ sends an Idempotency-Key on every state-changing checkout call and the add-on must keep the result for 24 hours."""
    import time
    now = time.time()
    with _LOCK, _conn() as c:
        row = c.execute("SELECT result, expires FROM idempotency WHERE key=?", (key,)).fetchone()
        if row and row[1] > now:
            return json.loads(row[0]), True
        result = compute()
        c.execute("INSERT OR REPLACE INTO idempotency (key, result, expires) VALUES (?, ?, ?)", (key, json.dumps(result), now + ttl_seconds))
    return result, False


def reset_for_tests() -> None:
    with _LOCK:
        p = db_path()
        if p.exists():
            p.unlink()
