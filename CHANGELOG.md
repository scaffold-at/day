# Changelog

All notable changes to scaffold-day are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The Walking Skeleton (v0.1) is tracked slice-by-slice in
[issue #1](https://github.com/scaffold-at/day/issues/1); each
retrospective comment there is the canonical record for that slice.
This file rolls those up into release notes once a tag is cut.

## [Unreleased]

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

[Unreleased]: https://github.com/scaffold-at/day/compare/v0.2.0...HEAD
[v0.2.0]: https://github.com/scaffold-at/day/releases/tag/v0.2.0
[v0.1.0]: https://github.com/scaffold-at/day/releases/tag/v0.1.0
