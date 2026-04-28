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

async function runLogs(args: string[]): Promise<number> {
  let json = false;
  let sinceRaw: string | undefined;
  const kinds: LogKind[] = [];
  let follow = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--json") {
      json = true;
    } else if (a === "--since") {
      sinceRaw = takeValue(args, i, "--since");
      i++;
    } else if (a === "--kind") {
      const v = takeValue(args, i, "--kind");
      // Accept short alias "decision" → equivalent to placement+conflict
      // since v0.2 has no separate decision log.
      if (v === "decision") {
        if (!kinds.includes("placement")) kinds.push("placement");
        if (!kinds.includes("conflict")) kinds.push("conflict");
      } else if ((KINDS as string[]).includes(v)) {
        kinds.push(v as LogKind);
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
      follow = true;
    } else {
      throw usage(`logs: unexpected argument '${a}'`);
    }
  }

  if (follow) {
    throw new ScaffoldError({
      code: "DAY_USAGE",
      summary: { en: "logs --follow is not implemented yet (v0.2.x followup)" },
      cause: "Tail/follow lands in a separate slice; v0.2.1 ships read+filter+format only.",
      try: ["Drop --follow and re-run; the static read returns the same data."],
    });
  }

  // Default since: 14 days ago.
  let sinceIso: string | null = null;
  if (sinceRaw) {
    sinceIso = parseSinceArg(sinceRaw, now());
    if (sinceIso === null) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: {
          en: "--since must be a duration (e.g. 7d, 12h, 30m) or an ISO date",
        },
        cause: `Got: ${sinceRaw}`,
        try: ["Pass --since 7d or --since 2026-04-20."],
      });
    }
  } else {
    sinceIso = parseSinceArg("14d", now());
  }

  const home = defaultHomeDir();
  const entries = await readLogs(home, {
    since: sinceIso,
    kinds: kinds.length > 0 ? kinds : undefined,
  });

  if (json) {
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
    what: "Read placement / conflict / heartbeat logs from `<home>/logs/`. Filters: --since (1d / 12h / 30m / ISO date) and --kind (placement | conflict | heartbeat | decision). v0.2.1 ships read+filter+format; --follow lands in a later patch.",
    when: "When debugging an unexpected placement, a resolved conflict, or to audit when 'morning' was recorded across days.",
    cost: "Local read only. Loads matching JSONL files into memory; corpora are small in v0.2.",
    input: "[--since <duration|date>] [--kind placement|conflict|heartbeat|decision] [--json] [--follow placeholder]",
    return: "JSON Lines on stdout when --json. Otherwise human-formatted lines, one per entry, sorted by `at` ascending.",
    gotcha: "`decision` is an alias for placement+conflict (no separate decision log in v0.2). --follow currently throws DAY_USAGE; tail/follow lands in a v0.2.x slice.",
  },
  run: async (args) => runLogs(args),
};
