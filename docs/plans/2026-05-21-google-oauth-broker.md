# Google OAuth Broker Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a production-ready Google Calendar OAuth broker for `scaffold-day` so normal users can connect Google Calendar without creating their own Google Cloud project, while preserving an open-source BYO OAuth credential path.

**Architecture:** Add a new Vercel-hosted broker app under `apps/auth-broker/` that owns the official Google Web OAuth client secret, stores encrypted refresh tokens, and exposes a device/session polling flow for the CLI. Update `scaffold-day auth login` to use the official broker by default, while keeping local Desktop PKCE / explicit-token flows for developers, forks, and self-hosting.

**Tech Stack:** Bun monorepo, TypeScript, Vercel Route Handlers or minimal Vercel serverless functions, Google OAuth 2.0 Web Application client, encrypted token storage in Vercel Postgres/Neon/Supabase Postgres, existing `@scaffold/day-cli` and `@scaffold/day-adapters` packages.

---

## Current Codebase Notes

- Repo root: `/Users/y30n51k/Projects/scaffold-day`
- CLI auth command: `packages/day-cli/src/commands/auth.ts`
- Existing local OAuth implementation: `packages/day-adapters/src/google-calendar/oauth-desktop.ts`
- Existing token storage: `packages/day-adapters/src/google-calendar/token-storage.ts`
- Existing auth UX: `scaffold-day auth login/list/logout/revoke`
- Current `apps/web` is a static landing app, not a Next/Vercel API app.
- Existing server-side precedent: `apps/feedback-worker/` uses a separate app package with its own deployment/runtime config.

## Product Decision

Implement a hybrid auth strategy:

1. **Default for normal users:** official broker mode.
   - User runs `scaffold-day auth login`.
   - CLI opens `https://auth.scaffold.at/...`.
   - Broker handles Google Web OAuth callback.
   - CLI polls broker until complete.
   - CLI stores a scaffold-day broker session locally, not the Google client secret.

2. **Advanced/OSS path:** custom local OAuth mode.
   - User can still use local Desktop PKCE with their own Google Cloud credentials.
   - Proposed CLI: `scaffold-day auth login --mode local --client-secret ./client_secret.json` or env vars `SCAFFOLD_DAY_GOOGLE_CLIENT_ID` / `SCAFFOLD_DAY_GOOGLE_CLIENT_SECRET`.

## Security Decision

For phase 1, use **server-stored encrypted refresh tokens**:

- Broker stores Google refresh tokens encrypted at rest.
- CLI stores only a scaffold-day broker session token locally.
- Calendar sync can either:
  - ask broker for short-lived Google access tokens, then call Google directly; or
  - call broker calendar proxy endpoints later.

Initial implementation should choose the **short-lived access token exchange** path to minimize Calendar API proxy surface area.

---

## Required Google/Vercel Setup

Before production deployment, create:

### Google Cloud

- Project: official `scaffold-day` Google Cloud project.
- Enable: Google Calendar API.
- OAuth Client Type: **Web application**.
- Redirect URI:
  - Local preview: `http://localhost:3000/api/auth/google/callback`
  - Production: `https://auth.scaffold.at/api/auth/google/callback`
- Scopes:
  - Calendar event sync: `https://www.googleapis.com/auth/calendar.events`
  - Google Tasks sync: `https://www.googleapis.com/auth/tasks`
  - Include identity: `openid email`
  - Do **not** request full `https://www.googleapis.com/auth/calendar`; `scaffold-day` does not need to create/delete calendars or manage calendar settings.
  - Do **not** request Gmail/Drive/Docs/Sheets scopes.

### Vercel Env Vars

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://auth.scaffold.at/api/auth/google/callback
DATABASE_URL=...
TOKEN_ENCRYPTION_KEY=... # 32-byte base64url or hex key
BROKER_PUBLIC_BASE_URL=https://auth.scaffold.at
BROKER_SESSION_SIGNING_KEY=... # separate from token encryption key
```

---

## Phase 0: Confirm Storage Provider

**Objective:** Pick the database backing for broker sessions and encrypted refresh tokens.

**Decision:** Use **Vercel Postgres / Neon** so the OAuth broker, database, environment variables, preview deployments, and production deployment all live in the Vercel-centered stack.

**Verification:** Vercel project has a Postgres/Neon database attached and exposes `DATABASE_URL` to production, preview, and local `.env.local` via `vercel env pull`.

---

## Phase 1: Add `apps/auth-broker` skeleton

### Task 1: Create broker package

**Objective:** Add an isolated deployable app for the OAuth broker.

**Files:**
- Create: `apps/auth-broker/package.json`
- Create: `apps/auth-broker/tsconfig.json`
- Create: `apps/auth-broker/src/health.ts` or Vercel route equivalent
- Modify: root `package.json` if workspace scripts are desired

**Implementation notes:**
- Keep it separate from `apps/web` to avoid turning the static landing site into an auth backend by accident.
- Prefer minimal Vercel serverless functions first; do not add a full web UI unless needed.

**Verification:**

```bash
bun install
bun run --cwd apps/auth-broker typecheck
```

Expected: typecheck passes.

---

### Task 2: Add broker config loader

**Objective:** Centralize env var validation so missing production secrets fail clearly.

**Files:**
- Create: `apps/auth-broker/src/config.ts`
- Test: `apps/auth-broker/src/config.test.ts`

**Required config:**

```ts
export type BrokerConfig = {
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  databaseUrl: string;
  tokenEncryptionKey: string;
  brokerPublicBaseUrl: string;
  brokerSessionSigningKey: string;
};
```

**Verification:**

```bash
bun test apps/auth-broker/src/config.test.ts
```

Expected: tests cover missing env vars and successful parsing.

---

### Task 3: Add database schema and migration doc

**Objective:** Define persistent state for OAuth device sessions, broker sessions, and Google tokens.

**Files:**
- Create: `apps/auth-broker/db/schema.sql`
- Create: `apps/auth-broker/README.md`

**Tables:**

```sql
create table oauth_device_sessions (
  id uuid primary key,
  device_code text not null unique,
  user_code text not null,
  state text not null unique,
  code_verifier text,
  status text not null check (status in ('pending', 'authorized', 'expired', 'denied')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  broker_session_id uuid
);

create table broker_sessions (
  id uuid primary key,
  session_token_hash text not null unique,
  google_account_email text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table google_tokens (
  broker_session_id uuid primary key references broker_sessions(id) on delete cascade,
  google_account_email text not null,
  scope text not null,
  encrypted_refresh_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
```

**Verification:** Apply schema to local/dev DB and confirm tables exist.

---

## Phase 2: Broker OAuth flow

**Decision:** For MVP, the broker mints short-lived Google access tokens from encrypted server-side refresh tokens. It will not proxy Calendar or Tasks API calls yet; CLI/adapters call Google APIs directly with the short-lived access token.

### Task 4: Implement crypto helpers

**Objective:** Provide safe token encryption and session token hashing.

**Files:**
- Create: `apps/auth-broker/src/crypto.ts`
- Test: `apps/auth-broker/src/crypto.test.ts`

**Functions:**
- `encryptRefreshToken(plaintext, key)`
- `decryptRefreshToken(ciphertext, key)`
- `hashSessionToken(token)`
- `generateOpaqueToken()`

**Verification:**

```bash
bun test apps/auth-broker/src/crypto.test.ts
```

Expected: roundtrip encryption works; ciphertext does not contain plaintext; hash is stable.

---

### Task 5: Implement Google OAuth URL builder

**Objective:** Generate a Google authorization URL for the official Web OAuth client.

**Files:**
- Create: `apps/auth-broker/src/google-oauth.ts`
- Test: `apps/auth-broker/src/google-oauth.test.ts`

**Required auth params:**
- `client_id`
- `redirect_uri`
- `response_type=code`
- `scope=openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks`
- `access_type=offline`
- `prompt=consent`
- `state=<session state>`

**Verification:** URL test asserts all required params exist and no client secret is included.

---

### Task 6: Implement `POST /api/auth/google/start`

**Objective:** Let CLI create a pending auth session and receive a browser URL.

**Request:**

```json
{
  "install_id": "uuid",
  "cli_version": "0.3.1"
}
```

**Response:**

```json
{
  "device_code": "opaque",
  "user_code": "ABCD-EFGH",
  "expires_in": 600,
  "interval": 2,
  "auth_url": "https://accounts.google.com/..."
}
```

**Files:**
- Create route/function under `apps/auth-broker/api/auth/google/start.ts` or chosen Vercel route path
- Test route handler with mocked DB

**Verification:** `curl` against local dev server returns JSON and DB row status `pending`.

---

### Task 7: Implement `GET /api/auth/google/callback`

**Objective:** Exchange Google `code` for tokens, store encrypted refresh token, and mark the device session authorized.

**Flow:**
1. Validate `state` maps to a non-expired pending session.
2. Exchange `code` at `https://oauth2.googleapis.com/token`.
3. Fetch Google userinfo to get email.
4. Create broker session and session token.
5. Encrypt and store refresh token.
6. Mark device session `authorized`.
7. Render a simple success HTML page: “Google Calendar connected. You can return to your terminal.”

**Files:**
- Create callback route/function
- Add tests with mocked Google token/userinfo responses

**Verification:** Unit test covers success, state mismatch, expired session, and Google token error.

---

### Task 8: Implement `GET /api/auth/google/status`

**Objective:** Let CLI poll until the browser flow is complete.

**Request query:** `device_code=<opaque>`

**Pending response:**

```json
{ "status": "pending" }
```

**Authorized response:**

```json
{
  "status": "authorized",
  "account_email": "user@example.com",
  "broker_session_token": "opaque-session-token",
  "scope": "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks"
}
```

**Important:** Return `broker_session_token` exactly once if possible, then mark it claimed. If implementing one-time claim is too much for MVP, document the risk and keep `device_code` high entropy with short expiry.

**Verification:** Polling test transitions from pending to authorized.

---

### Task 9: Implement `POST /api/auth/google/token`

**Objective:** Let authenticated CLI exchange its broker session token for a short-lived Google access token.

**Request:**

```json
{ "broker_session_token": "..." }
```

**Response:**

```json
{
  "access_token": "ya29...",
  "expires_in": 3600,
  "token_type": "Bearer",
  "scope": "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks",
  "account_email": "user@example.com"
}
```

**Security:**
- Hash incoming broker session token and look up by hash.
- Reject revoked sessions.
- Decrypt refresh token only inside request scope.
- Do not log token values.

**Verification:** Test mocked Google refresh grant succeeds and revoked session returns 401/403.

---

### Task 10: Implement `POST /api/auth/google/revoke`

**Objective:** Support user disconnect and server-side revocation.

**Flow:**
1. Validate broker session token.
2. Decrypt refresh token.
3. Best-effort POST to Google revoke endpoint.
4. Mark broker session/token revoked.
5. Return `{ "revoked": true }`.

**Verification:** Test DB state changes even if Google revoke endpoint is temporarily unavailable; response should indicate partial failure if needed.

---

## Phase 3: CLI integration

**Decision:** Because `scaffold-day` is still in development and has no compatibility-sensitive existing user base, make the official broker the default `scaffold-day auth login` path immediately. Keep explicit escape hatches for developers and self-hosters: `scaffold-day auth login --mode local --client-secret ...` for BYO Google OAuth and explicit `--access-token/--refresh-token --non-interactive` for tests/CI.

### Task 11: Add broker token storage type

**Objective:** Extend local auth storage to represent broker sessions as distinct from direct Google refresh tokens.

**Files:**
- Modify: `packages/day-adapters/src/google-calendar/token-storage.ts`
- Test: `packages/day-adapters/src/google-calendar/token-storage.test.ts`

**Design:** Introduce a new local file or schema variant, for example:

```ts
type GoogleAuthState =
  | { mode: "google-direct"; access_token: string; refresh_token: string; ... }
  | { mode: "broker"; broker_base_url: string; broker_session_token: string; account_email: string; scope: string; storage: "keychain" | "file" };
```

**Compatibility:** Existing `google-oauth.json` files must continue to read successfully.

**Verification:** Existing token-storage tests still pass; new tests cover broker mode.

---

### Task 12: Add broker client module

**Objective:** Encapsulate CLI calls to broker endpoints.

**Files:**
- Create: `packages/day-adapters/src/google-calendar/oauth-broker.ts`
- Test: `packages/day-adapters/src/google-calendar/oauth-broker.test.ts`

**Functions:**
- `startBrokerOAuth({ brokerBaseUrl, installId, cliVersion })`
- `pollBrokerOAuth({ brokerBaseUrl, deviceCode })`
- `exchangeBrokerAccessToken({ brokerBaseUrl, brokerSessionToken })`
- `revokeBrokerSession({ brokerBaseUrl, brokerSessionToken })`

**Verification:** Mock `fetch` and test pending, authorized, expired, network failure.

---

### Task 13: Update `scaffold-day auth login`

**Objective:** Make official broker mode the default user path.

**Files:**
- Modify: `packages/day-cli/src/commands/auth.ts`
- Test: `packages/day-cli/src/commands/auth.test.ts` if present or create one
- E2E: `tests/e2e/auth-init.test.ts` or new `tests/e2e/auth-broker.test.ts`

**Proposed UX:**

```bash
scaffold-day auth login
# default official broker mode

scaffold-day auth login --mode local
# Desktop PKCE flow for BYO/self-hosting users

scaffold-day auth login --access-token ... --refresh-token ... --non-interactive
# existing CI/manual flow
```

**Flags:**
- `--broker-url <url>` default `https://auth.scaffold.at`
- `--mode local|token` optional escape hatch; default with no explicit tokens is official broker mode
- `--client-secret <path>` for local/BYO flow later if not already supported

**Verification:** Dry-run output should clearly say whether mode is `broker` (default official hosted flow), `local`, or `token`.

---

### Task 14: Make Calendar sync work with broker mode

**Objective:** Ensure `scaffold-day sync` can obtain Google access tokens from broker sessions.

**Files:**
- Modify: `packages/day-cli/src/commands/sync.ts`
- Modify: `packages/day-adapters/src/google-calendar/live-adapter.ts`
- Tests: existing sync/live adapter tests

**Design:**
- If auth state is direct Google token, keep existing refresh logic.
- If auth state is broker mode, call `/api/auth/google/token` to get a fresh access token and use that for Calendar API calls.
- Do not persist Google access token longer than needed unless existing adapter requires it; if persisted, store expiry.

**Verification:** Mock broker token endpoint and Google Calendar API; `sync` succeeds with broker auth state.

---

### Task 15: Update `auth list/logout/revoke`

**Objective:** Make auth management transparent for broker and local modes.

**Files:**
- Modify: `packages/day-cli/src/commands/auth.ts`
- Tests: command tests/e2e

**Expected behavior:**

```bash
scaffold-day auth list --json
# { authenticated: true, mode: "broker", account_email, scope, storage }

scaffold-day auth logout
# local session removed only

scaffold-day auth revoke
# broker revoke endpoint called, then local session removed
```

**Verification:** Tests cover broker revoke success and local deletion fallback on network failure.

---

## Phase 4: BYO OAuth credentials

### Task 16: Add `--client-secret` support for local OAuth

**Objective:** Let OSS/self-hosting users use their own Google Cloud Desktop OAuth JSON without env vars.

**Files:**
- Modify: `packages/day-cli/src/commands/auth.ts`
- Modify: `packages/day-adapters/src/google-calendar/oauth-desktop.ts`
- Test: OAuth desktop tests

**Behavior:**

```bash
scaffold-day auth login --mode local --client-secret ~/Downloads/client_secret.json
```

The file should support Google Desktop OAuth JSON format:

```json
{ "installed": { "client_id": "...", "client_secret": "..." } }
```

**Verification:** Unit test parses sample JSON and passes credentials into `runOAuthDesktopFlow`.

---

### Task 17: Document official vs custom auth

**Objective:** Make the open-source distribution clear and trustworthy.

**Files:**
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify or generate CLI docs if applicable

**Docs must explain:**
- Normal users do not need Google Cloud.
- Default auth uses official scaffold-day broker.
- Self-hosters/forks can use `--mode local --client-secret`.
- What data is sent to the broker.
- How to revoke/disconnect.

**Verification:** `bun run check:agents-md` and docs tests pass after regeneration if needed.

---

## Phase 5: Deployment, privacy, and verification

### Task 18: Add broker deployment guide

**Objective:** Record exact Vercel + Google setup steps.

**Files:**
- Create: `apps/auth-broker/DEPLOY.md`

**Include:**
- Google Web OAuth client creation.
- Vercel env var setup.
- DB migration command.
- Domain mapping for `auth.scaffold.at`.
- Local dev `.env.local` example with placeholders only.

**Verification:** A fresh developer can follow the doc without asking for missing values.

---

### Task 19: Add Privacy Policy requirements checklist

**Objective:** Prepare for Google OAuth production review.

**Files:**
- Create: `docs/privacy/google-calendar-oauth-checklist.md`

**Checklist:**
- App name and logo.
- Privacy Policy URL.
- Terms URL.
- Calendar data use explanation.
- Token storage explanation.
- Revoke/delete instructions.
- Support contact.
- OAuth scopes and reason for each.

**Verification:** Checklist maps directly to Google OAuth consent screen fields.

---

### Task 20: Production smoke test

**Objective:** Verify the full flow against Vercel preview/production without exposing secrets.

**Commands:**

```bash
scaffold-day auth logout
scaffold-day auth login --broker-url https://auth.scaffold.at
scaffold-day auth list --json
scaffold-day sync --json
scaffold-day auth revoke
```

**Expected:**
- Browser opens Google consent screen for Day by Scaffold.
- CLI reports connected account.
- Sync can read Calendar events.
- Revoke disconnects both broker and local state.

---

## Open Questions

1. DB choice: **decided — Vercel Postgres / Neon**.
2. Domain choice: **decided — use existing `scaffold.at` domain, preferably subdomain `auth.scaffold.at` for the OAuth broker**.
3. Initial scopes: **decided — request `calendar.events` for Calendar event sync and `tasks` for Google Tasks sync; do not request full `calendar` or unrelated Workspace scopes**.
4. Broker API role: **decided — MVP broker only mints short-lived Google access tokens; it does not proxy Calendar/Tasks API calls yet**.
5. Default auth mode: **decided — make the official broker the default `scaffold-day auth login` path immediately because there is no existing user base to preserve; keep `--mode local` and explicit token mode for developers/self-hosters/tests**.

## Suggested Execution Order

1. Decide DB + domain + scope.
2. Implement broker skeleton, config, schema, crypto.
3. Implement start/callback/status/token/revoke endpoints.
4. Deploy preview to Vercel and test OAuth manually.
5. Integrate CLI broker mode behind `--mode broker` first.
6. Make broker mode default after smoke tests.
7. Add BYO `--client-secret` documentation and tests.
8. Prepare OAuth consent screen / Privacy Policy for public rollout.

## Final Verification Gates

Run from repo root:

```bash
bun test
bun run typecheck
bun run lint
bun run check:agents-md
bun run check:cli-reference
```

Then manually verify a real Google OAuth flow against Vercel preview or production.
