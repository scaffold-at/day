# Changelog

All notable changes to scaffold-day are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The Walking Skeleton (v0.1) is tracked slice-by-slice in
[issue #1](https://github.com/scaffold-at/day/issues/1); each
retrospective comment there is the canonical record for that slice.
This file rolls those up into release notes once a tag is cut.

## [Unreleased]

## [v0.3.0] - 2026-04-30

Phase C (Google Calendar live mode) closes 4/4 and Phase E (UX
gaps) closes 4/4. `scaffold-day sync` lands as the first user-facing
entry point for the live adapter; `auth login` now stores refresh
tokens in the OS Keychain by default.

### Added — Phase C: Google Calendar live mode (4/4)
- **S70** PKCE OAuth desktop flow (`oauth-desktop.ts`). Local `Bun.serve` callback, browser hand-off, token + userinfo email exchange. Client secret injected at build time via `bun build --define` so GitHub secret scanning never sees it.
- **S71 + S72** `LiveGoogleCalendarAdapter` — pull (`events.list` w/ syncToken pagination, 410 → token reset), push (create / update / delete with etag, 412 → retryable), Last-Wins reconcile parity with the mock adapter. Refresh-token rotation w/ 30s skew.
- **S73** OS-native refresh-token storage. macOS uses `security` (Keychain), Linux uses `secret-tool` (libsecret) — both wrapped via subprocess, no native modules so `bun --compile` is happy. Auto-detected at write time; the file becomes a `keychain://google-oauth/<email>` sentinel pointer with the secret in the OS vault. Falls back to file storage when the CLI is unreachable. `auth login --no-keychain` and `SCAFFOLD_DAY_DISABLE_KEYCHAIN=1` force file mode.
- **`scaffold-day sync`** — pull-only one-way sync from Google Calendar into the local day files. Default window is today − 7d → today + 30d (system TZ). For each remote event: insert under matching day (new `external_id`) or apply Last-Wins reconcile. `--start` / `--end` / `--account` / `--json` / `--dry-run` flags.

### Added — Phase E: UX gaps (4/4)
- **S76** `install.sh` now downloads `<asset>.sha256`, verifies via `sha256sum` / `shasum` / `openssl` (POSIX-portable), aborts on mismatch.
- **S82** `today` surfaces measured sleep + target / deficit alongside the existing rest-break suggestion. Reads `policy.context.sleep_budget` to populate `sleep_target` so `today --json` carries it for downstream agents.
- **S81** `place suggest --auto` commits the top-ranked candidate in one call (recurses into `place do --by auto`). UTC instants from the suggestion engine are converted to the policy's local-tz ISO before recursing so wall-clock hard rules evaluate correctly.
- **S80** `event update <id>` (patch any field, repartition the day file when `--start` crosses midnight) + `event delete <id>`. Both honour `--date` hint, `--json`, and `--dry-run`. Replaces the v0.1 placeholders.

### Changed
- `auth login` defaults to the browser PKCE flow when no `--access-token` / `--refresh-token` are passed; output now reports `storage: keychain` or `storage: file`. `--non-interactive` keeps the v0.1 manual-paste behaviour for CI / scripted setups.
- `sync-state` schema accepts both `oauth_ref: "keychain"` (v0.3+) and the legacy `"keytar"` value (v0.2 builds) on read so existing homes load without migration.
- E2E test harness defaults `SCAFFOLD_DAY_DISABLE_KEYCHAIN=1` so test runs never touch the developer's real OS Keychain.

### Pending (deferred to v0.3.x)
- `scaffold-day sync --push` — needs a local change-log to know what to push.
- **S74** Apple codesigning + notarization — blocked on PO-supplied 5 secrets.
- **S75** Homebrew tap auto-bump — blocked on PO-supplied `HOMEBREW_TAP_TOKEN`.
- `logs --follow` (deferred from S63).

## [v0.2.3] - 2026-04-29

Phase B 5/5 complete. `telemetry` and `feedback` ship with their
transports wired to the maintainer's PostHog project and a
Cloudflare Worker → Discord forwarding pipeline.

### Added
- **S65** `scaffold-day telemetry` — opt-in pseudonymous events to PostHog Cloud (US). Default is `ask` (nothing transmitted until the user opts in). install_id at `<home>/.install-id`; `show-id` / `reset-id` for user control. Event surface: `captureEvent(home, event, props)` exported for future call sites.
- **S66** `scaffold-day feedback <message...>` — pseudonymous note routed to the maintainer Discord channel via a Cloudflare Worker (`feedback.scaffold.at`). `--include-doctor` attaches a redacted JSON bundle (no paths, no policy values, no anchor wall-clock). 1 KB cap, rate-limited per install_id (5/min · 30/hour · 100/day).
- `apps/feedback-worker/` — Cloudflare Worker source + wrangler config + KV binding. Forwards to a Discord webhook held only as a Worker secret (never embedded in the client binary).

### Changed
- `doctor` Environment section now surfaces telemetry state + install_id (8-char prefix; full id in the JSON output).

### Fork-friendly
Both transports are env-overridable. Set `SCAFFOLD_DAY_POSTHOG_URL` / `_KEY` or `SCAFFOLD_DAY_FEEDBACK_URL` to redirect events to your own infrastructure. Empty string disables transport entirely (then `feedback` falls back to GitHub Issues guidance).

## [v0.2.2] - 2026-04-29

Phase B kickoff (v0.1 placeholder commands → real). Three commands
land in this release: `logs`, `rebuild-index`, and `self-update`.

### Added
- **S63** `scaffold-day logs [--since <duration|date>] [--kind placement|conflict|heartbeat|decision] [--json]` — read placement / conflict / heartbeat logs with filters. Default 14-day window. Decision is an alias for placement+conflict (no separate decision log in v0.2). `--follow` deferred to a tail/watch slice.
- **S64** `scaffold-day rebuild-index [--scope todos|days|all] [--json] [--dry-run]` — recompute `index.json` from per-id detail files and `manifest.json` from per-day files, with a drift report (added / removed / changed). Detail files are never modified.
- **S67** `scaffold-day self-update [--check] [--rollback] [--json] [--dry-run]` — resolve the latest GitHub release, sha256 verify, atomic-replace the running binary, keep a sibling backup for `--rollback`. Refuses brew-managed paths and `bun run` dev invocations.

### Side fixes
- `--dry-run` preview blocks for `place do` / `place override` / `day replan` / `conflict resolve` / `conflict detect` now point at `logs/<YYYY-MM>/placements.jsonl` (plural, partitioned). Real disk writes were always partitioned; the earlier preview strings were singular by mistake.

### Pending Phase B
- **S65 telemetry** — paused; endpoint architecture pending design discussion
- **S66 feedback** — paused; same

## [v0.2.1] - 2026-04-29

Patch release. Clarifies version reporting in `doctor` and adds a
`last_seen_binary_version` fingerprint that auto-updates on every
CLI / MCP invocation.

### Changed
- **`doctor` Environment section** — labels are now self-explanatory:
  - `data schema: 0.1.0` (was `schema_version: 0.1.0`)
  - `initialized by: scaffold-day v0.1.0` (was `scaffold_day_version: 0.1.0`, indented detail)
  - `last seen by: scaffold-day v0.2.1` *(new)*
  - `current binary: scaffold-day v0.2.1` (was `scaffold-day: 0.2.0`)
- **`schema-version.json`** gains an optional `last_seen_binary_version` field. v0.2.0 homes still load fine; the field is populated on the next non-init command after upgrading.

### Why
`doctor` showed three different version-shaped strings (`schema_version`, `scaffold_day_version`, `scaffold-day`) without explaining what each meant. After upgrading from v0.1.0 to v0.2.0 the schema-version.json fingerprint stayed at `0.1.0` (the binary that *first wrote* the file), making it look like the upgrade didn't take. Now: data schema vs. initialized-by vs. last-seen vs. current-binary are four distinct labels with distinct lifetimes.

## [v0.2.0] - 2026-04-29

The relative time model. v0.2 introduces the morning anchor as the
t=0 reference for placement, plus three new policy fields layered on
top: `sleep_budget` (hard reject + soft penalty), `cognitive_load`
(decay heavy tasks past a capacity window), and `recovery_block`
(soft penalty on next-day morning slots after a forced-late event).

All v0.2 features are *opt-in*: a v0.1 policy without these fields
keeps v0.1 behavior. The relative model activates as soon as the
caller adds the matching context block.

### Added — Phase A: relative time model

- **S60** Morning anchor + clock injection. New CLI `scaffold-day morning [--at HH:MM | --at <ISO>] [--force] [--json]`; new MCP tools `record_morning` / `get_morning_anchor`. Storage: append-only `<home>/logs/heartbeats.jsonl`. Auto-fallback records `source: "auto"` on the first non-init command of the day; explicit calls upgrade silently. `today` displays "Day started HH:MM" and `doctor` adds an Anchor section. Test infrastructure: `SCAFFOLD_DAY_NOW` env var + in-process `setNowOverride()` for deterministic time travel.
- **S58** `sleep_budget` policy field. Each candidate slot's implied sleep window (slot end / latest event / latest placement → projected next anchor) is checked against `min_hours` (hard reject) and `target_hours` (soft penalty proportional to shortfall). Multi-day suggest naturally surfaces tomorrow's slots when today is too tight.
- **S59** `cognitive_load` decay. Heavy TODOs (`effort_min ≥ heavy_task_threshold_min`, default 60) past `full_capacity_window_hours` (default 4) past anchor get a soft score penalty. `decay: linear` (default) or `exponential` (opt-in). Light tasks unaffected.
- **S61** Sleep-debt rest-break suggestion. When yesterday→today anchor gap implies measured sleep below `sleep_budget.min_hours`, `today` and the new MCP `get_rest_suggestion` tool emit a 20-minute rest break recommendation. Volatile (recomputed each call); no on-disk record.
- **S62** Forced-late next-day recovery block. When yesterday had any event ending past `working_hours.end + 120 min` (default), today's first 2h get a soft `-30` per-slot penalty. Not a hard reject — engine still allows placement when nothing earlier fits.

### Added — Phase E: UX gaps

- **S83** Global `--dry-run` flag on every write CLI command (`init`, `auth login/logout/revoke`, `event add`, `todo add/update/archive/score`, `place do/override`, `policy patch`, `policy preset apply`, `migrate apply`, `morning`, `conflict resolve/detect`, `day replan`). Emits `{ "dry_run": true, "would": <preview> }` on `--json` or a structured human preview otherwise. No disk mutation.

### Schema changes (additive, back-compat)

- `Context.sleep_budget?` (target_hours, min_hours, soft_penalty_per_hour)
- `Context.cognitive_load?` (decay, full_capacity_window_hours, heavy_task_threshold_min, linear_penalty_per_hour, exponential_base)
- `Context.recovery_block?` (late_threshold_minutes_past_working_end, morning_block_hours, soft_penalty)
- `CandidateBreakdown.sleep_budget` / `.cognitive_load` / `.recovery_block` exposed for `explain` and UX surfaces.

### CI / test surface
- 627/627 tests (was 554 at v0.1.0 release). 73 new tests across unit + e2e + MCP.
- New tracker issue: scaffold-at/day#3 (v0.2 progress board).
- Token corpus baseline: 1075 → 1135 (3 new MCP tools: record_morning, get_morning_anchor, get_rest_suggestion). Drift after baseline update: 3.0%.

### Defaults captured in code
Every new policy field carries a comment block with PO's 2026-04-28 rationale + tuning notes, so the next dogfood pass knows where to adjust.

### Pending for v0.2.x or v0.3
- Phase B placeholder → real impls (logs, rebuild-index, telemetry, feedback, self-update).
- Phase C Google Calendar live mode (S70-S73), blocked on PO Cloud Client ID.
- Phase D distribution polish (S74 Apple signing, S75 brew tap auto-bump, S76 install.sh shasum).
- Phase E UX (S80 event update/delete, S81 place suggest --auto, S82 today sleep-debt expanded summary).

## [v0.1.0] - 2026-04-27

First public Walking Skeleton release. Tier 1 binaries (macOS arm64,
Linux x64) are unsigned; Apple notarization lands post-v0.1. Install
via `curl -fsSL https://day.scaffold.at/install.sh | sh`.

### Added — Phase 1: Foundation
- **S0** Legal & documentation skeleton: `LICENSE` (AGPL-3.0-or-later), `NOTICE`, `CONTRIBUTING.md` (DCO + permissive-only re-licensing covenant), `CODE_OF_CONDUCT.md`, `SECURITY.md`.
- **S1** bun monorepo scaffold (5 packages: `day-core`, `day-cli`, `day-mcp`, `day-adapters`, `apps/web`); `--version` / `--help` baseline.
- **S2 / S2.5** 8 placeholder commands with the 6-section help template (WHAT/WHEN/COST/INPUT/RETURN/GOTCHA), CI-gated by `validate:help`.
- **S3** `DAY_*` error format with `cause` / `try` / `docs` payload and `--json` mode.
- **S4** `schema_version` + migration skeleton.
- **S5** Common ID + Zod base types (ULID monotonic factory).

### Added — Phase 2: Local data
- **S6 / S7** TODO data model + in-memory CRUD.
- **S8a / S8b / S8c** Atomic write (tmp + fsync + rename), advisory lock with heartbeat + stale takeover, two-tier TODO repository (Summary + Detail).
- **S9 / S10 / S11** Manual Event model + Day file, manifest auto-update, free-slot computation.

### Added — Phase 3: Day view
- **S12** `today` / `day get` / `week` commands.

### Added — Phase 4: Policy & importance
- **S13 / S14** Policy Zod schema + Balanced preset + YAML codec (preserves comments via `yaml` Document API) + JSON Patch (RFC 6902).
- **S15** `policy show / patch / preset apply` commands with SHA-256 `policy_hash` and snapshots.
- **S16 / S17** Importance Score formula (PRD §10.2) and `todo score` CLI.

### Added — Phase 5: Placement engine
- **S18 / S19** Hard Rule + Context filter; Soft Preference + Reactivity penalty (5-variant discriminated unions).
- **S20 / S21 / S22** `place suggest`, `place do` (inline policy snapshot), `place override`.

### Added — Phase 6: Conflict & explain
- **S23 / S24** Conflict detection (3 kinds) + `conflict list/resolve` + Conflict log; auto-resolution when a conflict stops being detected.
- **S25** `explain` command and Placement log.

### Added — Phase 7: Tags
- **S26** Tag system.

### Added — Phase 8: Google Calendar adapter (mock-first)
- **S27 / S28** Mock-mode Google OAuth desktop flow + token storage (`<home>/.secrets/google-oauth.json`, mode 0600). Live B-mode lands when PO supplies a Google Cloud OAuth Client ID.
- **S29 / S29.5** `auth login/list/logout/revoke` (non-interactive in v0.1) + real `init` (creates the home layout + seeds the chosen preset).
- **S30a / S30b / S30c** Pull baseline + sync state, incremental sync with sync token (410 Gone recovery), recurring read-only projection.
- **S31a / S31b / S31c** Event create / update (RRULE edit) / delete pushes; Last-Wins reconcile.

### Added — Phase 9: AI provider
- **S32 / S33** `AIProvider` interface + `ProviderCapabilities` (Tier 1|2|3, cost zero|subscription|per-token); `ClaudeCliProvider` with PATH search and graceful failure when the binary is missing.
- **S34** `init` provider env detection + `Policy.ai_provider` field; `SCAFFOLD_DAY_AI_PROVIDERS` whitelist for test isolation.
- **S35** `doctor` command with sectioned health checks (Environment / AI Providers / Adapters); `--probe` gate for subscription/per-token providers.

### Added — Phase 10: Reactivity & suggestions
- **S37** `compute_task_importance` AI delegation (dimensions from the AI, score deterministic from policy).
- **S39** `replan_day` automatic reschedule.

### Added — Phase 11: MCP surface
- **S41** MCP server scaffold over stdio (with bun-specific `process.stdin.resume()` event-loop pinning).
- **S42 / S43a / S43b / S43c / S43d** 24 MCP tools across day / TODO / event / policy / conflict / explain / score / health.
- **S44** `scripts/bench-token.ts` token-corpus regression gate (±10% warn / ±25% fail / 6000 abs budget).

### Added — Phase 15: Brand & docs (in progress)
- **S53.5** `scaffold-day docs --for-ai [--format markdown|json|yaml] [--cli-only|--mcp-only] [--commands name,...]` — single-shot AI-readable surface dump with JTBD recipes.
- **S53.7** `AGENTS.md` auto-generated from `docs --for-ai --format markdown`; CI step `check:agents-md` keeps it in lockstep.
- **S53.8** Per-command MDX tree at `apps/web/content/cli/` auto-generated from the registry's 6-section help; CI step `check:cli-reference`.
- **S54** README + README.ko + this CHANGELOG draft.

### Pending for v0.1
- **S48** `bun build --compile` Tier 1 binary matrix (macOS arm64, Linux x64) — Apple signing secrets deferred until PO supplies them.
- **S49 / S50** `install.sh` + DNS/hosting + GitHub Actions release workflow.
- **S51 / S52 / S53** Logo (skipped for v0.1) + scaffold.at/day landing + docs site MVP.
- **S55 / S56 / S57** GitHub Discussions + good-first-issue labels, MCP directory registration, Show HN rehearsal.

[Unreleased]: https://github.com/scaffold-at/day/compare/v0.3.0...HEAD
[v0.3.0]: https://github.com/scaffold-at/day/releases/tag/v0.3.0
[v0.2.3]: https://github.com/scaffold-at/day/releases/tag/v0.2.3
[v0.2.2]: https://github.com/scaffold-at/day/releases/tag/v0.2.2
[v0.2.1]: https://github.com/scaffold-at/day/releases/tag/v0.2.1
[v0.2.0]: https://github.com/scaffold-at/day/releases/tag/v0.2.0
[v0.1.0]: https://github.com/scaffold-at/day/releases/tag/v0.1.0
