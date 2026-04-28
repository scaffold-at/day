/**
 * Morning anchor — the wall-clock instant a user "started today"
 * (§S60 in the v0.2 progress tracker).
 *
 * The anchor is the t=0 reference for the relative time model:
 *   - sleep_budget rules (S58) compute available sleep from "anchor +
 *     budget" against the next day's anchor.
 *   - cognitive_load decay (S59) computes elapsed since anchor.
 *   - rest-break suggestion (S61) compares "previous day's last
 *     activity → today's anchor" against min sleep hours.
 *
 * Storage: append-only JSONL at `<home>/logs/heartbeats.jsonl`. One
 * day can have multiple lines if the user calls `morning` more than
 * once with `--force`; the latest line for a given date wins.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { atomicWrite } from "../fs/atomic-write";
import { ISODateSchema, ISODateTimeSchema } from "../ids/schemas";

export const AnchorSourceSchema = z.enum([
  /** User called `scaffold-day morning` (or MCP `record_morning`). */
  "explicit",
  /** First scaffold-day invocation of the day; auto-recorded. */
  "auto",
  /** User passed `--at HH:MM` (or its MCP equivalent). */
  "manual",
]);
export type AnchorSource = z.infer<typeof AnchorSourceSchema>;

export const HeartbeatEntrySchema = z.object({
  schema_version: z.string().min(1),
  /** YYYY-MM-DD in the policy/system TZ this entry applies to. */
  date: ISODateSchema,
  /** Wall-clock instant the user "started today". */
  anchor: ISODateTimeSchema,
  source: AnchorSourceSchema,
  /** Wall-clock instant the entry itself was written. */
  recorded_at: ISODateTimeSchema,
});
export type HeartbeatEntry = z.infer<typeof HeartbeatEntrySchema>;

export function heartbeatsPath(home: string): string {
  return path.join(home, "logs", "heartbeats.jsonl");
}

/** Append a heartbeat entry. Crash-safe on a single line. */
export async function appendHeartbeat(
  home: string,
  entry: HeartbeatEntry,
): Promise<void> {
  const validated = HeartbeatEntrySchema.parse(entry);
  const dest = heartbeatsPath(home);
  await mkdir(path.dirname(dest), { recursive: true });
  const line = `${JSON.stringify(validated)}\n`;
  // Open in append mode; for a single-line append, fs.appendFile is
  // already atomic on POSIX (write < PIPE_BUF). We use writeFile with
  // flag:'a' rather than rewriting the whole file via atomicWrite.
  await writeFile(dest, line, { flag: "a", mode: 0o644 });
}

/**
 * Stream the heartbeat log and return the latest entry for `date`,
 * or `null` if none yet.
 */
export async function readAnchorForDate(
  home: string,
  date: string,
): Promise<HeartbeatEntry | null> {
  const dest = heartbeatsPath(home);
  if (!existsSync(dest)) return null;
  const content = await readFile(dest, "utf8");
  const lines = content.split("\n").filter((l) => l.length > 0);
  let latest: HeartbeatEntry | null = null;
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // tolerate corrupt trailing line on crash
    }
    const r = HeartbeatEntrySchema.safeParse(parsed);
    if (!r.success) continue;
    if (r.data.date !== date) continue;
    latest = r.data;
  }
  return latest;
}

/**
 * Re-export reads of the *most recent* anchor regardless of date —
 * useful for "previous day's last activity" lookups in S61.
 */
export async function readLatestAnchor(
  home: string,
): Promise<HeartbeatEntry | null> {
  const dest = heartbeatsPath(home);
  if (!existsSync(dest)) return null;
  const content = await readFile(dest, "utf8");
  const lines = content.split("\n").filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i] ?? "");
    } catch {
      continue;
    }
    const r = HeartbeatEntrySchema.safeParse(parsed);
    if (r.success) return r.data;
  }
  return null;
}

/**
 * High-level: record an anchor, returning whether one already existed
 * for the same date. Caller decides what to do on `was_already_set`
 * (no-op vs --force overwrite).
 */
export async function recordAnchor(
  home: string,
  next: HeartbeatEntry,
  options: { force: boolean },
): Promise<{ entry: HeartbeatEntry; was_already_set: boolean }> {
  const existing = await readAnchorForDate(home, next.date);
  if (existing && !options.force) {
    return { entry: existing, was_already_set: true };
  }
  await appendHeartbeat(home, next);
  return { entry: next, was_already_set: existing !== null };
}

/**
 * Build a heartbeat entry from a Date instant. Caller supplies the
 * IANA TZ so date-key lookup matches the user's policy TZ.
 */
export function buildHeartbeat(args: {
  at: Date;
  recordedAt: Date;
  source: AnchorSource;
  tz: string;
  schemaVersion?: string;
}): HeartbeatEntry {
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: args.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(args.at);

  // Build a TZ-aware ISO string for `anchor` and `recorded_at` so
  // the on-disk value reflects the user's TZ rather than UTC.
  const anchorIso = isoWithTz(args.at, args.tz);
  const recordedIso = isoWithTz(args.recordedAt, args.tz);

  return {
    schema_version: args.schemaVersion ?? "0.1.0",
    date: dateKey,
    anchor: anchorIso,
    source: args.source,
    recorded_at: recordedIso,
  };
}

/**
 * Render a Date as ISO 8601 with explicit `±HH:MM` for the given IANA
 * timezone (no native API for this on the platform; we compute the
 * offset from the same Intl.DateTimeFormat call).
 */
export function isoWithTz(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour") === "24" ? "00" : get("hour");
  const minute = get("minute");
  const second = get("second");

  // Compute the offset by comparing the wall-clock value against UTC.
  const wallMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  const offsetMin = Math.round((wallMs - at.getTime()) / 60_000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${hh}:${mm}`;
}

// Re-exported for use by the auto-fallback path in the CLI entry.
export { atomicWrite };
