# scaffold-day-feedback (Cloudflare Worker)

Receives `POST /` from `scaffold-day feedback`, applies abuse mitigations
(rate-limit / length cap / URL-spam heuristic / optional shared token),
and forwards to a Discord channel webhook.

## Architecture

```
CLI (`scaffold-day feedback`)
  │  POST { install_id, message, doctor_bundle?, ... }
  ▼
[Worker]  ← rate limit (KV) · length cap · URL heuristic
  │  multipart  { content: "📎 feedback from <id>…", file: doctor-redacted.json }
  ▼
Discord webhook → PO's private channel
```

The Discord webhook URL is a Worker secret — it is never exposed to clients.

## One-time setup

Run from this directory.

```sh
# 1. Cloudflare auth
npx wrangler login

# 2. KV namespace for rate limiting
npx wrangler kv:namespace create RATE
# → paste the printed `id` into wrangler.toml under [[kv_namespaces]]

# 3. Discord webhook URL (paste the full https://discord.com/api/webhooks/... URL)
npx wrangler secret put DISCORD_WEBHOOK_URL

# 4. (optional) Shared token — clients must send X-Scaffold-Day-Token
npx wrangler secret put SHARED_TOKEN

# 5. Deploy
npx wrangler deploy
```

After deploy the Worker is reachable at the route in `wrangler.toml`
(default: a `*.workers.dev` URL until a custom domain is added).

## Routing under `feedback.scaffold.at`

Add a CNAME on the `scaffold.at` zone pointing `feedback` at the
worker's `*.workers.dev` host (or use a Worker route):

```toml
# wrangler.toml
routes = [{ pattern = "feedback.scaffold.at", custom_domain = true }]
```

Then the CLI is wired with:

```sh
export SCAFFOLD_DAY_FEEDBACK_URL=https://feedback.scaffold.at
```

## Sanity check

```sh
curl -fsS https://feedback.scaffold.at/health
# → {"ok":true}
```

## What the Worker does NOT do

- Persist messages anywhere except Discord
- Look at the doctor bundle's contents (forwarded as opaque JSON file)
- Trust binaries' install_id beyond format validation — abuse is
  rate-limited but not authenticated. PO is the abuse-handling
  party (mute / ban-via-id-blocklist if an install_id misbehaves).
