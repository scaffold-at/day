# Changelog

All notable changes to scaffold-day are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The Walking Skeleton (v0.1) is tracked slice-by-slice in
[issue #1](https://github.com/scaffold-at/day/issues/1); each
retrospective comment there is the canonical record for that slice.
This file rolls those up into release notes once a tag is cut.

## [Unreleased]

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

[Unreleased]: https://github.com/scaffold-at/day/compare/HEAD~1...HEAD
