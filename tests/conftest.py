import os

import pytest


@pytest.fixture(autouse=True)
def fresh_store(tmp_path, monkeypatch):
    monkeypatch.setenv("AFTERLOSS_DB", str(tmp_path / "t.sqlite3"))
    yield
