"""The pages say what they must, and nothing they must not."""

from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent


def test_index_is_honest_about_the_simulation_and_serves_its_assets():
    from afterloss.web import app
    with TestClient(app) as c:
        html = c.get("/").text
        assert "Simulated Alexa+" in html and "standing in for Alexa+" in html
        assert "tokens.css" in html and 'type="module" src="/app.js' in html
        assert "Decide" in html and "Skip for now" in html
        assert "Hold to approve" in c.get("/app.js").text and "Check before you approve" in c.get("/app.js").text
        for asset in ("/tokens.css", "/style.css", "/app.js", "/chain3d.js", "/favicon.svg", "/fonts/ibm-plex-sans-var-latin.woff2"):
            assert c.get(asset).status_code == 200, asset
        assert (ROOT / "site" / "fonts" / "OFL.txt").exists()


def test_page_never_claims_to_be_amazon():
    html = (ROOT / "site" / "index.html").read_text()
    for banned in ("Amazon Alexa logo", "official Alexa", "Powered by Amazon"):
        assert banned not in html


def test_mcp_app_card_follows_the_apps_protocol_names():
    card = (ROOT / "mcp-app" / "card.html").read_text()
    for name in ("ui/initialize", "ui/notifications/initialized", "ui/notifications/tool-result", "tools/call"):
        assert name in card


def test_no_middle_dot_in_project_text():
    dot = chr(0xB7)
    banned = (dot, "&" + "middot;", "&#" + "183;", "\\" + "u00b7", "\\" + "xb7")
    skip = {".woff2", ".woff", ".gif", ".jpg", ".jpeg", ".png", ".sqlite3", ".pyc", ".ico"}
    hits = []
    for base in ("site", "mcp-app", "docs", "afterloss", "tests"):
        for p in (ROOT / base).rglob("*"):
            if p.is_file() and p.suffix.lower() not in skip:
                text = p.read_text(errors="ignore")
                hits += [f"{p.relative_to(ROOT)}: {b!r}" for b in banned if b in text]
    for p in ROOT.glob("*.md"):
        text = p.read_text(errors="ignore")
        hits += [f"{p.name}: {b!r}" for b in banned if b in text]
    assert not hits, hits


def test_card_initialize_sends_the_names_the_apps_spec_defines():
    card = (ROOT / "mcp-app" / "card.html").read_text()
    assert "appInfo" in card and "appCapabilities" in card and "clientInfo" not in card
    assert "ui/notifications/size-changed" in card


def test_record_page_gives_back_its_gpu_context_and_hides_a_3d_box_that_cannot_run():
    chain = (ROOT / "site" / "chain3d.js").read_text()
    app = (ROOT / "site" / "app.js").read_text()
    assert "forceContextLoss" in chain and "removeEventListener" in chain and "canRender3d" in chain
    assert 'chainUi("off")' in app and "await mountRecord3d()" in app


def test_sibling_link_is_not_a_dead_hash_and_the_spoken_date_is_used():
    app = (ROOT / "site" / "app.js").read_text()
    html = (ROOT / "site" / "index.html").read_text()
    assert "share_progress" in app and "c.progress.share)" not in app
    assert 'id="share-sent" hidden' in html
    assert "setDate(d.getDate() - 7)" not in app and "spokenDate" in app and "willOf" in app


def test_no_lookalike_separators_in_the_pages():
    lookalikes = ("•", "∙", "⋅", "‧", "・")
    for p in ("site/index.html", "site/app.js", "site/style.css", "mcp-app/card.html"):
        text = (ROOT / p).read_text()
        assert not [c for c in lookalikes if c in text], p
