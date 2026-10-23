"""The pages say what they must, and nothing they must not."""

from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent


def test_index_is_honest_about_the_simulation_and_serves_its_assets():
    from afterloss.web import app
    with TestClient(app) as c:
        html = c.get("/").text
        assert "Simulated Alexa+" in html and "standing in for Alexa+" in html
        assert "tokens.css" in html and 'type="module" src="/app.js"' in html
        assert "Decide" in html and "Skip for now" in html
        assert "Hold to approve" in c.get("/app.js").text and "Check before you approve" in c.get("/app.js").text
        assert "988" not in html, "the crisis line is spoken by the add-on, not hard-coded in the page"
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
