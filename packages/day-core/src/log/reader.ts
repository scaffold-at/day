/**
 * Log reading helpers (PRD v0.2 §S63).
 *
 * The append-only log files at:
 *   `<home>/logs/<YYYY-MM>/placements.jsonl`
 *   `<home>/logs/<YYYY-MM>/conflicts.jsonl`
 *   `<home>/logs/heartbeats.jsonl`
 *
 * are written by S25 / S24 / S60 respectively. This module reads
 * them back with simple filters (since-instant + kind whitelist) and
 * tags each entry with its `kind` so a CLI / MCP layer can stream a
 * unified timeline.
 *
 * Read-only; tolerates corrupt trailing lines (a crash mid-write
 * leaves at most one bad line — we skip it instead of aborting).
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  HeartbeatEntrySchema,
  type HeartbeatEntry,
} from "../anchor/anchor";
import { pathExists } from "../schema/storage";
import {
  ConflictLogEntrySchema,
  PlacementLogEntrySchema,
  type ConflictLogEntry,
  type PlacementLogEntry,
} from "./placement-log";

export type LogKind = "placement" | "conflict" | "heartbeat";

export type UnifiedLogEntry =
  | { kind: "placement"; at: string; entry: PlacementLogEntry }
  | { kind: "conflict"; at: string; entry: ConflictLogEntry }
  | { kind: "heartbeat"; at: string; entry: HeartbeatEntry };

export type ReadLogsOptions = {
  /**
   * Drop entries older than this ISO 8601 instant. Inclusive on the
   * supplied instant; null means "no lower bound".
   */
  since?: string | null;
  /** Whitelist; empty / undefined means "all kinds". */
  kinds?: ReadonlyArray<LogKind>;
};

const ALL_KINDS: LogKind[] = ["placement", "conflict", "heartbeat"];

function parseLine<T>(
  line: string,
  parser: { safeParse: (raw: unknown) => { success: boolean; data?: T } },
): T | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const r = parser.safeParse(parsed);
  return r.success && r.data ? r.data : null;
}

/** YYYY-MM partition keys present under `<home>/logs/`. */
async function listLogMonths(home: string): Promise<string[]> {
  const root = path.join(home, "logs");
  if (!(await pathExists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort();
}

async function readJsonlLines(file: string): Promise<string[]> {
  if (!(await pathExists(file))) return [];
  const raw = await readFile(file, "utf8");
  return raw.split("\n").filter((l) => l.length > 0);
}

/**
 * Stream-style read: returns a flat array of UnifiedLogEntry sorted
 * ascending by `at`. v0.2 sizes are small enough that loading
 * everything is fine; revisit if logs grow into the millions.
 */
export async function readLogs(
  home: string,
  options: ReadLogsOptions = {},
): Promise<UnifiedLogEntry[]> {
  const kinds = new Set<LogKind>(
    options.kinds && options.kinds.length > 0 ? options.kinds : ALL_KINDS,
  );
  const sinceMs = options.since ? Date.parse(options.since) : null;

  const out: UnifiedLogEntry[] = [];

  if (kinds.has("placement") || kinds.has("conflict")) {
    const months = await listLogMonths(home);
    for (const month of months) {
      if (kinds.has("placement")) {
        const lines = await readJsonlLines(
          path.join(home, "logs", month, "placements.jsonl"),
        );
        for (const line of lines) {
          const e = parseLine<PlacementLogEntry>(line, PlacementLogEntrySchema);
          if (!e) continue;
          if (sinceMs !== null && Date.parse(e.at) < sinceMs) continue;
          out.push({ kind: "placement", at: e.at, entry: e });
        }
      }
      if (kinds.has("conflict")) {
        const lines = await readJsonlLines(
          path.join(home, "logs", month, "conflicts.jsonl"),
        );
        for (const line of lines) {
          const e = parseLine<ConflictLogEntry>(line, ConflictLogEntrySchema);
          if (!e) continue;
          if (sinceMs !== null && Date.parse(e.at) < sinceMs) continue;
          out.push({ kind: "conflict", at: e.at, entry: e });
        }
      }
    }
  }

  if (kinds.has("heartbeat")) {
    const lines = await readJsonlLines(path.join(home, "logs", "heartbeats.jsonl"));
    for (const line of lines) {
      const e = parseLine<HeartbeatEntry>(line, HeartbeatEntrySchema);
      if (!e) continue;
      if (sinceMs !== null && Date.parse(e.recorded_at) < sinceMs) continue;
      out.push({ kind: "heartbeat", at: e.recorded_at, entry: e });
    }
  }

  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

/**
 * Parse a duration string ("1d", "12h", "30m") OR an ISO date /
 * datetime, into an ISO instant relative to `now`. Returns `null`
 * when the input is unrecognized.
 */
export function parseSinceArg(input: string, now: Date): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // ISO datetime / date.
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const ms = Date.parse(trimmed);
    if (Number.isNaN(ms)) return null;
    return new Date(ms).toISOString();
  }

  // Duration shorthand: 30m / 12h / 7d / 4w
  const m = /^(\d+(?:\.\d+)?)([smhdw])$/.exec(trimmed);
  if (!m) return null;
  const n = Number.parseFloat(m[1] ?? "0");
  const unit = m[2];
  const ms: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };
  if (!unit || !(unit in ms)) return null;
  return new Date(now.getTime() - n * ms[unit]!).toISOString();
}
