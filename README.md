# scaffold-day

> Scaffold your day with AI.

A CLI-first, MCP-ready scheduler that places your TODOs into the free
slots of your calendar — with an AI client (Claude Code, Cursor, Claude
Desktop) as a first-class user.

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](./LICENSE)

> ⚠️ **Pre-release.** v0.1 is the [Walking
> Skeleton](https://github.com/scaffold-at/day/issues/1) — most of the
> surface is wired up, but the binary release (`bun build --compile`),
> hosting, and OAuth desktop flow are still landing. Install from source
> and expect rough edges.

## Why

Most calendar tools optimise for *displaying* time. `scaffold-day`
optimises for *placing* time: take a list of TODOs, score their
importance, and slot them into the calendar's actual free space — under
a transparent, replayable policy you can edit by hand. The same surface
is exposed both as a CLI (for humans + scripts) and as an MCP tool
catalogue (for AI clients), so an LLM can plan your day with one tool
call instead of piping CLI text.

## Quick start

```sh
git clone https://github.com/scaffold-at/day.git scaffold-day
cd scaffold-day
bun install

# Initialise the local home (~/.scaffold-day) and seed the balanced policy.
bun run dev:cli init

# What does today look like?
bun run dev:cli today --tz Asia/Seoul

# AI-readable surface dump (markdown / json / yaml).
bun run dev:cli docs --for-ai
```

A full `bun build --compile` binary release lands in §S48; until then
`bun run dev:cli` is the canonical entry point.

## What you get today

| Surface | Status | Notes |
| --- | --- | --- |
| `today` / `day get` / `week` | ✅ | Local file-backed day view, free-slot computation. |
| `todo add/list/get/score`, `place suggest/do/override` | ✅ | Two-tier storage (Summary + Detail per id). |
| `policy show/patch/preset apply` | ✅ | YAML codec preserves comments; JSON Patch (RFC 6902) supported. |
| `conflict list/resolve` + `explain` | ✅ | Replayable Placement / Conflict log. |
| `auth login/list/logout/revoke` | ✅ | Mock-mode (file-backed). Live OAuth desktop flow → §S27 B-mode. |
| Google Calendar adapter | ✅ Mock / 🚧 Live | Mock-first so forks pass without external creds. |
| AI providers | ✅ | `MockAIProvider` + `ClaudeCliProvider` (graceful when binary missing). |
| MCP server (24 tools) | ✅ | `scaffold-day mcp` over stdio; token corpus regression-gated. |
| `docs --for-ai` / `AGENTS.md` / per-command MDX | ✅ | Single source of truth; CI gates freshness. |

The full surface is auto-published to [`AGENTS.md`](./AGENTS.md) and to
the per-command MDX tree at
[`apps/web/content/cli/`](./apps/web/content/cli/) — both regenerated
from the registry on every change.

## AI client integration

`scaffold-day mcp` speaks the [Model Context
Protocol](https://modelcontextprotocol.io) over stdio. Drop the binary
into your MCP client config and you have 24 tools — `get_day`,
`suggest_placement`, `place_todo`, `compute_task_importance`,
`replan_day`, `explain_placement`, … — available as one-call surfaces
for the LLM.

Recommended: paste [`AGENTS.md`](./AGENTS.md) into the system prompt
once at session start. It contains the JTBD recipes (e.g. *"a meeting
moved — replan"*) so the AI doesn't have to derive call sequences from
scratch.

For session-scoped or token-aware introspection:

```sh
scaffold-day docs --for-ai --format json --commands today,place,explain
```

## Project layout

```
packages/
  day-core/      # schemas, policy, importance, placement, errors
  day-cli/       # CLI entry + commands (registry-driven)
  day-mcp/       # MCP tool catalogue (24 tools, stdio server)
  day-adapters/  # Google Calendar adapter (mock-first)
apps/
  web/           # placeholder for the docs site (S52/S53)
scripts/         # generators + CI gates (validate-help, bench-token, gen:agents-md, gen:cli-reference)
tests/e2e/       # spawn-the-CLI black-box tests
```

The deeper design (PRD + sliced delivery plan) lives in the private
[scaffold-at/day-blueprint](https://github.com/scaffold-at/day-blueprint)
repo. Public progress is tracked in [issue
#1](https://github.com/scaffold-at/day/issues/1).

## Contributing

DCO sign-off, no CLA, AGPL-3.0-or-later with a permissive-only
re-licensing covenant. See [CONTRIBUTING.md](./CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). Security issues:
[SECURITY.md](./SECURITY.md).

Korean: see [README.ko.md](./README.ko.md).

## License

AGPL-3.0-or-later. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
