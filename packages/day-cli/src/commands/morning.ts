import {
  buildHeartbeat,
  compilePolicy,
  defaultHomeDir,
  isoWithTz,
  now,
  readAnchorForDate,
  readPolicyYaml,
  recordAnchor,
  ScaffoldError,
  todayInTz,
} from "@scaffold/day-core";
import type { Command } from "../cli/command";
import { emitDryRun, isDryRun } from "../cli/runtime";

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day morning --help` for the full input contract.",
    try: ["Run `scaffold-day morning --help`."],
  });
}

async function resolveTz(home: string): Promise<string> {
  const yaml = await readPolicyYaml(home);
  if (yaml) {
    try {
      const policy = compilePolicy(yaml);
      if (policy.context?.tz) return policy.context.tz;
    } catch {
      // fall through
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Parse `--at`. Accepts:
 *   - `HH:MM` or `HH:MM:SS` → today (in `tz`) at that wall-clock time
 *   - full ISO 8601 with TZ → used as-is
 *
 * Returns a Date (instant). Throws DAY_INVALID_INPUT on malformed input.
 */
function parseAt(value: string, tz: string): Date {
  // Full ISO with explicit TZ?
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `--at is not a parseable ISO 8601 datetime` },
        cause: `Got: ${value}`,
        try: ["Use 2026-04-28T07:30:00+09:00 or HH:MM for today."],
      });
    }
    return d;
  }

  // HH:MM or HH:MM:SS in the user's TZ for today's date.
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `--at must be HH:MM, HH:MM:SS, or full ISO 8601` },
      cause: `Got: ${value}`,
      try: ["Pass --at 07:30 or --at 2026-04-28T07:30:00+09:00."],
    });
  }
  const date = todayInTz(tz);
  const hh = m[1];
  const mm = m[2];
  const ss = m[3] ?? "00";
  // Build a candidate ISO at UTC, then re-anchor into the TZ via the
  // same formatter we use elsewhere. Two-step: build the wall string,
  // then resolve its offset.
  // First, take the wall-clock candidate as a UTC instant; this is
  // wrong by the TZ offset, but the offset will be applied below.
  const wallUtc = new Date(`${date}T${hh}:${mm}:${ss}Z`);
  // Compute the offset for this wall instant in the given TZ. We use
  // the formatter to reverse-engineer it: format the UTC instant in
  // `tz` and read what hour comes out, infer the offset from the
  // delta.
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(wallUtc);
  const get = (t: string) => formatted.find((p) => p.type === t)?.value ?? "00";
  const tzWallMs = Date.UTC(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")) === 24 ? 0 : Number(get("hour")),
    Number(get("minute")),
    Number(get("second")),
  );
  const offsetMs = tzWallMs - wallUtc.getTime();
  // The actual instant the user meant is the original wall-clock UTC
  // shifted *backwards* by the TZ offset (since `wallUtc` was built
  // as if the wall was UTC).
  return new Date(wallUtc.getTime() - offsetMs);
}

async function runMorning(args: string[]): Promise<number> {
  let atRaw: string | undefined;
  let force = false;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--at") {
      const v = args[i + 1];
      if (!v) throw usage("morning: --at requires a value (HH:MM or ISO 8601)");
      atRaw = v;
      i++;
    } else if (a === "--force") {
      force = true;
    } else if (a === "--json") {
      json = true;
    } else {
      throw usage(`morning: unexpected argument '${a}'`);
    }
  }

  const home = defaultHomeDir();
  const tz = await resolveTz(home);
  const recordedAt = now();
  const at = atRaw ? parseAt(atRaw, tz) : recordedAt;
  const source: "explicit" | "manual" = atRaw ? "manual" : "explicit";

  const entry = buildHeartbeat({
    at,
    recordedAt,
    source,
    tz,
  });

  if (isDryRun()) {
    emitDryRun(json, {
      command: "morning",
      writes: [{ path: "logs/heartbeats.jsonl", op: "update" }],
      result: { anchor: entry.anchor, source, force },
    });
    return 0;
  }

  // Auto-fallback anchors are placeholder values; an explicit/manual
  // call should always upgrade them without --force. Only an existing
  // explicit/manual entry blocks (idempotent unless --force).
  const existing = await readAnchorForDate(home, entry.date);
  const wasExplicitlySet =
    existing !== null &&
    (existing.source === "explicit" || existing.source === "manual");
  const upgradeAuto = existing?.source === "auto";
  const result = await recordAnchor(home, entry, {
    force: force || upgradeAuto,
  });
  const recorded = !wasExplicitlySet || force;

  if (json) {
    console.log(
      JSON.stringify(
        {
          anchor: result.entry.anchor,
          date: result.entry.date,
          source: result.entry.source,
          was_already_set: wasExplicitlySet,
          upgraded_from_auto: upgradeAuto && recorded,
          forced: force && wasExplicitlySet,
          recorded,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const wall = result.entry.anchor.slice(11, 16); // HH:MM
  if (wasExplicitlySet && !force) {
    console.log(`scaffold-day morning`);
    console.log(`  already set at ${wall} (${result.entry.source})`);
    console.log(`  use --force to override, or --at HH:MM to record a different time`);
    return 0;
  }
  console.log(`scaffold-day morning`);
  console.log(`  anchor:  ${result.entry.anchor}`);
  console.log(`  source:  ${source}`);
  if (upgradeAuto) {
    console.log(`  note:    replaced today's auto-recorded anchor`);
  } else if (force && wasExplicitlySet) {
    console.log(`  note:    overwrote a previous anchor for ${result.entry.date}`);
  }
  return 0;
}

/**
 * Auto-fallback used by the CLI entry on every command (except
 * `morning` itself, which is the explicit path). If today already has
 * an anchor of any source, this is a no-op.
 */
export async function tryRecordAutoHeartbeat(home: string): Promise<void> {
  try {
    const tz = await resolveTz(home);
    const date = todayInTz(tz);
    const existing = await readAnchorForDate(home, date);
    if (existing) return;
    const at = now();
    const entry = buildHeartbeat({
      at,
      recordedAt: at,
      source: "auto",
      tz,
    });
    await recordAnchor(home, entry, { force: false });
  } catch {
    // Best-effort: home not yet initialized, fs error, etc.
  }
}

export const morningCommand: Command = {
  name: "morning",
  summary: "record today's morning anchor (the t=0 of the relative time model)",
  help: {
    what: "Record (or query) today's morning anchor — the wall-clock instant the user 'started today'. The anchor is the t=0 reference for sleep_budget (S58), cognitive_load decay (S59), and rest-break suggestion (S61). v0.1 storage: append-only `<home>/logs/heartbeats.jsonl`; the latest entry for a given date wins.",
    when: "First action of the day, or when an AI client receives a 'good morning' message and emits MCP `record_morning`. Auto-fallback: if no explicit call landed yet, the first scaffold-day CLI / MCP invocation of the day records `source: \"auto\"`.",
    cost: "Local file I/O only. Append-only single-line write to `logs/heartbeats.jsonl`. No network.",
    input: "[--at HH:MM | --at <ISO 8601 + TZ>] [--force] [--json]",
    return: "Exit 0 on success. If today's anchor is already set and --force is not given, prints a non-error notice and exits 0. JSON shape: { anchor, date, source, was_already_set, forced }.",
    gotcha: "Auto-fallback runs on every command (except `morning` itself); explicit `morning` always wins by replacing or no-op'ing the auto entry depending on --force. Tracking SLICES.md / issue #3 §S60.",
  },
  run: async (args) => runMorning(args),
};
