# Hosting (optional; if hosted, keep it up until judging ends on 20 Nov 2026)

Hosting is not required. The official FAQ says the MCP server "doesn't need to stay running after you submit" and that a locally runnable public repo plus the demo video is enough. If you do host it, keep it up until judging ends. One process serves everything (web client, `/mcp`, checkout endpoints), listens on `PORT`, and keeps state in one SQLite file at `AFTERLOSS_DB`. `PUBLIC_URL` is what the add-on prints in share links and checkout URLs.

## Current deployment
Google Cloud Run, region us-west1, scale to zero, at most one instance: https://after-loss-desk-647733667799.us-west1.run.app/ (MCP endpoint https://after-loss-desk-647733667799.us-west1.run.app/mcp). The case store lives on the instance and resets on a cold start.

## Run it locally
```bash
uv sync
uv run afterloss serve            # http://127.0.0.1:8300, MCP endpoint /mcp
```

## Option A: Google Cloud Run (what we deploy: free tier, scales to zero, one instance)
```bash
gcloud auth login                                  # the Google account that owns the project
PROJECT=<your-project-id> REGION=us-west1 bash deploy/cloudrun.sh
```
The script builds from the `Dockerfile` and runs at most one instance, scaled to zero when idle. The project needs billing enabled; at judging traffic the service should stay inside the Cloud Run free tier. State lives on the instance's own disk, so it resets on a cold start and whenever Cloud Run replaces the instance. A judge who starts a case and plays it through in one sitting is fine. The first request after an idle period is slower while the instance starts. There is deliberately one instance: a second instance would have its own empty store, and a case made on the first would answer 404 on the second. Setting `PUBLIC_URL` creates a second revision, so do not start cases until the script prints the live URL.

## Option B: Fly.io (persistent disk, HTTPS, never sleeps, about $3 a month)
```bash
brew install flyctl && fly auth login            # or: curl -L https://fly.io/install.sh | sh
fly launch --copy-config --no-deploy              # uses fly.toml; say yes to the app name or pick another
fly volumes create afterloss_data --size 1 --region sjc
fly deploy
fly open                                          # https://after-loss-desk.fly.dev
curl -s -X POST https://after-loss-desk.fly.dev/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}'
```
If you picked a different app name, set `PUBLIC_URL` in `fly.toml` to match before `fly deploy`. Logs: `fly logs`. The machine is pinned on (`auto_stop_machines = false`, `min_machines_running = 1`).

## Option C: any VM with Docker (Hetzner, Lightsail, an e2-micro)
```bash
docker build -t afterloss .
docker run -d --restart unless-stopped -p 8300:8300 -v afterloss:/data -e PUBLIC_URL=https://<your-domain> afterloss
```
Put Caddy in front for HTTPS: `caddy reverse-proxy --from <your-domain> --to localhost:8300`.

## After it is up
1. Open `https://<host>/` and walk the demo once. Post the `initialize` request from Option B to `https://<host>/mcp` and check `"protocolVersion":"2025-11-25"` in the reply.
2. Put `https://<host>/` in the Devpost **Project Testing Link** and `https://<host>/mcp` in the description under "MCP endpoint".
3. Set `PUBLIC_URL` so the sibling's page and the checkout URLs on cards point at the host (the Cloud Run script does this).
4. Do not redeploy after the deadline (23 Oct 12:00 PT) until winners are announced on 3 Dec; a running service is fine, a changed one is not.
