import os from "node:os";
import {
  defaultHomeDir,
  installIdPath,
  readOrCreateInstallId,
  readInstallId,
  readTelemetryConfig,
  resetInstallId,
  ScaffoldError,
  telemetryConfigPath,
  type TelemetryConfig,
  type TelemetryState,
  writeTelemetryConfig,
} from "@scaffold/day-core";
import pkg from "../../package.json" with { type: "json" };
import type { Command } from "../cli/command";
import { emitDryRun, isDryRun } from "../cli/runtime";

const POSTHOG_URL_ENV = "SCAFFOLD_DAY_POSTHOG_URL";
const POSTHOG_KEY_ENV = "SCAFFOLD_DAY_POSTHOG_KEY";

/**
 * Default PostHog ingest endpoint + project API key wired into the
 * binary. The key is PostHog's *write-only* phc_ form — it cannot
 * read events or change project settings; embedding it in a client
 * binary is the supported PostHog pattern.
 *
 * Override with env vars to redirect a fork to its own project, or
 * with an empty string to disable transport entirely.
 */
const DEFAULT_POSTHOG_URL = "https://us.i.posthog.com";
const DEFAULT_POSTHOG_KEY =
  "phc_zDaXC9LbtdEM28pkVCEPvxaG2GoaQ3tkUif2tnjmKzXd";

function effectivePostHogUrl(): string | null {
  const env = process.env[POSTHOG_URL_ENV];
  if (env === "") return null;
  return env ?? DEFAULT_POSTHOG_URL;
}

function effectivePostHogKey(): string | null {
  const env = process.env[POSTHOG_KEY_ENV];
  if (env === "") return null;
  return env ?? DEFAULT_POSTHOG_KEY;
}

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day telemetry --help`.",
    try: ["Run `scaffold-day telemetry --help`."],
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

async function runStatus(home: string, json: boolean): Promise<number> {
  const cfg = await readTelemetryConfig(home);
  const id = await readInstallId(home);
  const url = effectivePostHogUrl();
  const key = effectivePostHogKey();
  const transport_configured = url !== null && key !== null;
  if (json) {
    console.log(
      JSON.stringify(
        {
          state: cfg.state,
          decided_at: cfg.decided_at,
          install_id: id,
          install_id_path: installIdPath(home),
          config_path: telemetryConfigPath(home),
          transport_configured,
          posthog_url: url,
          posthog_key_set: key !== null,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  console.log("scaffold-day telemetry");
  console.log(`  state:        ${cfg.state}`);
  console.log(`  decided_at:   ${cfg.decided_at ?? "(not yet)"}`);
  console.log(`  install_id:   ${id ?? "(not yet generated)"}`);
  console.log(`  transport:    ${transport_configured ? "configured" : "not configured"}`);
  if (!transport_configured) {
    console.log(`  note:         set ${POSTHOG_URL_ENV} + ${POSTHOG_KEY_ENV} to enable transmission`);
  }
  return 0;
}

async function runSet(home: string, state: TelemetryState, json: boolean): Promise<number> {
  if (isDryRun()) {
    emitDryRun(json, {
      command: `telemetry ${state}`,
      writes: [{ path: ".telemetry.json", op: "update" }],
      result: { state, decided_at: nowIso() },
    });
    return 0;
  }
  const cfg: TelemetryConfig = { state, decided_at: nowIso() };
  await writeTelemetryConfig(home, cfg);
  if (state === "on") {
    await readOrCreateInstallId(home);
  }
  if (json) {
    console.log(JSON.stringify(cfg));
  } else {
    console.log(`scaffold-day telemetry: ${state}`);
    if (state === "on") {
      const id = await readInstallId(home);
      console.log(`  install_id: ${id}`);
      const url = effectivePostHogUrl();
      const key = effectivePostHogKey();
      if (!url || !key) {
        console.log(`  note:       transport disabled (env override empties URL/key)`);
      } else {
        console.log(`  transport:  ${url}`);
      }
    }
  }
  return 0;
}

async function runShowId(home: string, json: boolean): Promise<number> {
  const id = await readInstallId(home);
  if (json) {
    console.log(JSON.stringify({ install_id: id }));
    return 0;
  }
  if (id === null) {
    console.log("scaffold-day telemetry show-id");
    console.log("  (no install_id yet — opt in with `telemetry on`)");
    return 0;
  }
  console.log(id);
  return 0;
}

async function runResetId(home: string, json: boolean): Promise<number> {
  if (isDryRun()) {
    emitDryRun(json, {
      command: "telemetry reset-id",
      writes: [{ path: ".install-id", op: "update" }],
    });
    return 0;
  }
  const oldId = await readInstallId(home);
  const newId = await resetInstallId(home);
  if (json) {
    console.log(JSON.stringify({ old: oldId, new: newId }));
  } else {
    console.log("scaffold-day telemetry reset-id");
    console.log(`  old: ${oldId ?? "(none)"}`);
    console.log(`  new: ${newId}`);
  }
  return 0;
}

/**
 * Best-effort PostHog event capture. Never throws — CLI commands
 * must not fail because telemetry transport was down. Skipped when
 * state ≠ "on", env vars unset, or in dry-run.
 */
export async function captureEvent(
  home: string,
  event: string,
  properties: Record<string, unknown> = {},
): Promise<boolean> {
  if (isDryRun()) return false;
  const cfg = await readTelemetryConfig(home);
  if (cfg.state !== "on") return false;
  const url = effectivePostHogUrl();
  const key = effectivePostHogKey();
  if (!url || !key) return false;

  const id = await readOrCreateInstallId(home);
  const body = {
    api_key: key,
    event,
    distinct_id: id,
    timestamp: nowIso(),
    properties: {
      $lib: "scaffold-day",
      $lib_version: pkg.version,
      os: os.platform(),
      arch: os.arch(),
      ...properties,
    },
  };

  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function runTelemetry(args: string[]): Promise<number> {
  const home = defaultHomeDir();
  const json = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));
  const sub = positional[0];

  if (!sub || sub === "status") return runStatus(home, json);
  if (sub === "on" || sub === "off" || sub === "ask") return runSet(home, sub, json);
  if (sub === "show-id") return runShowId(home, json);
  if (sub === "reset-id") return runResetId(home, json);
  throw usage(`telemetry: unknown subcommand '${sub}'`);
}

export const telemetryCommand: Command = {
  name: "telemetry",
  summary: "inspect or change opt-in heartbeat telemetry preferences",
  help: {
    what: "Read or set the telemetry preference. Pseudonymous: events are tagged with an install_id (UUID per home), never TODO content / calendar / paths. Transport is PostHog Cloud when SCAFFOLD_DAY_POSTHOG_URL + SCAFFOLD_DAY_POSTHOG_KEY are set; otherwise events queue silently.",
    when: "Whenever you want to opt in, opt out, check status, or rotate the install_id.",
    cost: "Local config write only. Each captured event (state=on, transport configured) is one HTTPS POST to PostHog.",
    input: "status (default) | on | off | ask | show-id | reset-id [--json] [--dry-run]",
    return: "Exit 0. JSON mirrors the on-disk config plus transport state.",
    gotcha: "Default is `ask` — nothing is sent until you opt in. Even with state=on, transport is a no-op until SCAFFOLD_DAY_POSTHOG_URL + _KEY are set. Tracking SLICES.md §S45 / issue #3 §S65.",
  },
  run: async (args) => runTelemetry(args),
};
