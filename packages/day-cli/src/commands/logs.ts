import {
  defaultHomeDir,
  type LogKind,
  parseSinceArg,
  readLogs,
  ScaffoldError,
  type UnifiedLogEntry,
  now,
} from "@scaffold/day-core";
import { colors } from "../cli/colors";
import type { Command } from "../cli/command";

const KINDS: LogKind[] = ["placement", "conflict", "heartbeat"];

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day logs --help` for the full input contract.",
    try: ["Run `scaffold-day logs --help`."],
  });
}

function takeValue(args: string[], i: number, flag: string): string {
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) {
    throw usage(`logs: ${flag} requires a value`);
  }
  return v;
}

function formatHuman(entry: UnifiedLogEntry): string {
  const at = entry.at.replace("T", " ").slice(0, 19);
  switch (entry.kind) {
    case "placement": {
      const e = entry.entry;
      const move = e.previous
        ? ` (was ${e.previous.start.slice(11, 16)}-${e.previous.end.slice(11, 16)})`
        : "";
      return `${colors.dim(at)} ${colors.emerald("place")}    ${e.action.padEnd(11)} ${e.placement_id} ${e.start.slice(11, 16)}-${e.end.slice(11, 16)} on ${e.date} by ${e.by}${move}`;
    }
    case "conflict": {
      const e = entry.entry;
      const reason = e.reason ? ` — ${e.reason}` : "";
      return `${colors.dim(at)} ${colors.amber("conflict")} ${e.action.padEnd(11)} ${e.conflict_id} (${e.kind}) on ${e.date} by ${e.by}${reason}`;
    }
    case "heartbeat": {
      const e = entry.entry;
      const wall = e.anchor.slice(11, 16);
      return `${colors.dim(at)} ${colors.cyan("anchor")}   ${e.source.padEnd(11)} ${e.date} → ${wall}`;
    }
  }
}

type ParsedFlags = {
  json: boolean;
  sinceRaw?: string;
  kinds: LogKind[];
  follow: boolean;
  pollMs: number;
};

function parseLogsFlags(args: string[]): ParsedFlags {
  const out: ParsedFlags = { json: false, kinds: [], follow: false, pollMs: 1000 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--json") {
      out.json = true;
    } else if (a === "--since") {
      out.sinceRaw = takeValue(args, i, "--since");
      i++;
    } else if (a === "--kind") {
      const v = takeValue(args, i, "--kind");
      if (v === "decision") {
        if (!out.kinds.includes("placement")) out.kinds.push("placement");
        if (!out.kinds.includes("conflict")) out.kinds.push("conflict");
      } else if ((KINDS as string[]).includes(v)) {
        out.kinds.push(v as LogKind);
      } else {
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: `--kind must be one of ${KINDS.join("|")} (or "decision")` },
          cause: `Got: ${v}`,
          try: [`Pass --kind placement.`],
        });
      }
      i++;
    } else if (a === "--follow") {
      out.follow = true;
    } else if (a === "--poll") {
      const v = takeValue(args, i, "--poll");
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n < 100 || n > 60_000) {
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: "--poll must be an integer in [100, 60000] (milliseconds)" },
          cause: `Got: ${v}`,
          try: ["Pass --poll 1000 for one-second polling."],
        });
      }
      out.pollMs = n;
      i++;
    } else {
      throw usage(`logs: unexpected argument '${a}'`);
    }
  }
  return out;
}

function emit(entries: readonly UnifiedLogEntry[], json: boolean): void {
  for (const e of entries) {
    console.log(json ? JSON.stringify(e) : formatHuman(e));
  }
}

function timestampOf(entry: UnifiedLogEntry): string {
  return entry.kind === "heartbeat" ? entry.entry.recorded_at : entry.at;
}

/**
 * Run a follow loop that polls the log files and emits new entries
 * as they appear. Exposed so unit tests can drive a single tick. The
 * process-level loop wires SIGINT to a cancel token.
 */
export async function followTick(
  home: string,
  state: { lastAt: string },
  opts: { kinds?: LogKind[]; json: boolean },
): Promise<void> {
  const newer = await readLogs(home, {
    since: state.lastAt,
    kinds: opts.kinds,
  });
  if (newer.length === 0) return;
  emit(newer, opts.json);
  // Bump lastAt by 1ms past the newest entry so the next read does
  // not re-emit the entries we just printed (`since` is `>=`).
  let maxMs = -Infinity;
  for (const e of newer) {
    const ms = Date.parse(timestampOf(e));
    if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
  }
  if (Number.isFinite(maxMs)) {
    state.lastAt = new Date(maxMs + 1).toISOString();
  }
}

async function followLoop(
  home: string,
  opts: { kinds?: LogKind[]; json: boolean; pollMs: number },
): Promise<number> {
  let cancelled = false;
  const onSignal = () => {
    cancelled = true;
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  // Start "from end" — like `tail -f`: the user wants to see new
  // entries from now on, not the historical backlog. Anyone who
  // wants the backlog should run plain `scaffold-day logs` first.
  const state = { lastAt: new Date().toISOString() };

  while (!cancelled) {
    try {
      await followTick(home, state, opts);
    } catch (err) {
      // A transient read error shouldn't kill the loop. Surface to
      // stderr and keep going.
      console.error(
        `logs --follow: read error — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await new Promise((r) => setTimeout(r, opts.pollMs));
  }

  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  return 0;
}

async function runLogs(args: string[]): Promise<number> {
  const flags = parseLogsFlags(args);
  const home = defaultHomeDir();

  if (flags.follow) {
    return followLoop(home, {
      kinds: flags.kinds.length > 0 ? flags.kinds : undefined,
      json: flags.json,
      pollMs: flags.pollMs,
    });
  }

  // Default since: 14 days ago.
  let sinceIso: string | null = null;
  if (flags.sinceRaw) {
    sinceIso = parseSinceArg(flags.sinceRaw, now());
    if (sinceIso === null) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: {
          en: "--since must be a duration (e.g. 7d, 12h, 30m) or an ISO date",
        },
        cause: `Got: ${flags.sinceRaw}`,
        try: ["Pass --since 7d or --since 2026-04-20."],
      });
    }
  } else {
    sinceIso = parseSinceArg("14d", now());
  }

  const entries = await readLogs(home, {
    since: sinceIso,
    kinds: flags.kinds.length > 0 ? flags.kinds : undefined,
  });

  if (flags.json) {
    for (const e of entries) {
      console.log(JSON.stringify(e));
    }
    return 0;
  }

  if (entries.length === 0) {
    console.log("scaffold-day logs");
    console.log(`  (no entries since ${sinceIso})`);
    return 0;
  }
  for (const e of entries) {
    console.log(formatHuman(e));
  }
  return 0;
}

export const logsCommand: Command = {
  name: "logs",
  summary: "tail or query scaffold-day operational logs",
  help: {
    what: "Read placement / conflict / heartbeat logs from `<home>/logs/`. Filters: --since (1d / 12h / 30m / ISO date) and --kind (placement | conflict | heartbeat | decision). `--follow` polls for new entries and emits them as they appear (Ctrl+C to exit).",
    when: "When debugging an unexpected placement, a resolved conflict, to audit when 'morning' was recorded across days, or to watch placements happen live during a session.",
    cost: "Local read only. Loads matching JSONL files into memory; corpora are small in v0.2. `--follow` polls every --poll ms (default 1000).",
    input: "[--since <duration|date>] [--kind placement|conflict|heartbeat|decision] [--json] [--follow] [--poll <ms>=1000]",
    return: "JSON Lines on stdout when --json. Otherwise human-formatted lines, one per entry, sorted by `at` ascending. `--follow` runs until SIGINT/SIGTERM (exit 0).",
    gotcha: "`decision` is an alias for placement+conflict (no separate decision log in v0.2). `--follow` starts from `now` (tail-f semantics) — combine with a plain `scaffold-day logs` first to see history. Tracking SLICES.md §S63.",
  },
  run: async (args) => runLogs(args),
};
