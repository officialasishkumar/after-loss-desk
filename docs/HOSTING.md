# Hosting (live until 20 Nov 2026)

The organiser has said three times that the MCP endpoint must stay live and accessible until judging ends. One process serves everything (web client, `/mcp`, checkout endpoints), listens on `PORT`, and keeps state in one SQLite file at `AFTERLOSS_DB`. `PUBLIC_URL` is what the add-on prints in share links and checkout URLs.

## Option A: Fly.io (recommended: persistent disk, HTTPS, never sleeps, about $3 a month)
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

## Option B: Google Cloud Run (what Tephra used; one always-on instance)
```bash
gcloud auth login                                  # a personal account; use --project with a personal project, not the work one
PROJECT=<your-personal-project> REGION=us-west1 bash deploy/cloudrun.sh
```
State lives on the instance's disk and resets if Cloud Run replaces the instance; judges who start a case and play it through in one sitting are fine. Cost: one always-on 512 MB instance, roughly $10 to $15 a month, or less with the free tier.

## Option C: any VM with Docker (Hetzner, Lightsail, an e2-micro)
```bash
docker build -t afterloss .
docker run -d --restart unless-stopped -p 8300:8300 -v afterloss:/data -e PUBLIC_URL=https://<your-domain> afterloss
```
Put Caddy in front for HTTPS: `caddy reverse-proxy --from <your-domain> --to localhost:8300`.

## After it is up
1. Open `https://<host>/` and walk the demo once; open `https://<host>/mcp` with the curl above and check `"protocolVersion":"2025-11-25"`.
2. Put `https://<host>/` in the Devpost **Project Testing Link** and `https://<host>/mcp` in the description under "MCP endpoint".
3. Set `PUBLIC_URL` so the sibling's page and the checkout URLs on cards point at the host.
4. Do not redeploy after the deadline (23 Oct 12:00 PT) until winners are announced on 3 Dec; a running service is fine, a changed one is not.
