// Local change log for one-way push (S71 push-side wire-up).
//
// Every successful local mutation (`event add` / `update` / `delete`)
// while a Google Calendar token exists records a row here. The next
// `scaffold-day sync --push` replays the queue through the adapter
// and compacts on success. Append-only on the hot path; the
// compaction step rewrites the file atomically when entries clear.
//
// File layout: JSONL — one PendingChange per line. Path:
//   <home>/sync/google-calendar-pending.jsonl
//
// We keep this in the adapters package (next to sync-state.ts) so
// the contract lives with the adapter, not with the CLI.

import { appendFile, mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { atomicWrite, ScaffoldError } from "@scaffold/day-core";

export const PENDING_FILE = "google-calendar-pending.jsonl";
export const SYNC_DIR = "sync";

export function pendingChangesPath(home: string): string {
  return path.join(home, SYNC_DIR, PENDING_FILE);
}

export const PendingChangeSchema = z
  .object({
    /** ISO instant the mutation happened locally. */
    at: z.string(),
    kind: z.enum(["create", "update", "delete"]),
    /** Local FixedEvent.id at the time of the mutation. */
    event_id: z.string(),
    /** Google Calendar event id, if known. Null on create / unknown. */
    external_id: z.string().nullable(),
    /** Full event snapshot for create; ignored for update / delete. */
    snapshot: z.record(z.unknown()).nullable().default(null),
    /** Field-level patch for update; ignored for create / delete. */
    patch: z.record(z.unknown()).nullable().default(null),
    /** How many push attempts this entry has survived. */
    attempts: z.number().int().min(0).default(0),
  })
  .strict();

export type PendingChange = z.infer<typeof PendingChangeSchema>;

/** Append a single change. Creates the parent dir if needed. */
export async function recordPendingChange(
  home: string,
  change: Omit<PendingChange, "attempts"> & { attempts?: number },
): Promise<void> {
  const validated = PendingChangeSchema.parse({
    attempts: 0,
    ...change,
  });
  const target = pendingChangesPath(home);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await appendFile(target, `${JSON.stringify(validated)}\n`, { mode: 0o600 });
}

/** Read all pending entries in append order. Empty array when file absent. */
export async function readPendingChanges(home: string): Promise<PendingChange[]> {
  const target = pendingChangesPath(home);
  let raw: string;
  try {
    raw = await readFile(target, "utf8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw err;
  }
  const out: PendingChange[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (cause) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `pending-changes line ${i + 1} is not valid JSON` },
        cause: String(cause),
        try: ["Truncate the file or restore from backup."],
        context: { file: target, line: i + 1 },
      });
    }
    const parsed = PendingChangeSchema.safeParse(json);
    if (!parsed.success) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `pending-changes line ${i + 1} failed schema validation` },
        cause: parsed.error.message,
        try: ["Truncate the file or restore from backup."],
        context: { file: target, line: i + 1 },
      });
    }
    out.push(parsed.data);
  }
  return out;
}

/**
 * Replace the pending file with the given survivors. Pass `[]` to
 * delete the file entirely (the queue drained cleanly). Atomic.
 */
export async function compactPendingChanges(
  home: string,
  survivors: PendingChange[],
): Promise<void> {
  const target = pendingChangesPath(home);
  if (survivors.length === 0) {
    try {
      await unlink(target);
    } catch (err) {
      if ((err as { code?: string }).code !== "ENOENT") throw err;
    }
    return;
  }
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const content = `${survivors.map((s) => JSON.stringify(s)).join("\n")}\n`;
  await atomicWrite(target, content, { mode: 0o600 });
}
