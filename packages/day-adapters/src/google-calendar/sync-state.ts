import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { atomicWrite, ScaffoldError } from "@scaffold/day-core";

export const SYNC_DIR = "sync";
export const GOOGLE_CALENDAR_STATE_FILE = "google-calendar.json";

export const GoogleCalendarSyncStateSchema = z
  .object({
    schema_version: z.string().min(1).default("0.1.0"),
    /** Adapter id + version recorded so the next run knows which
     * codebase wrote the state. */
    adapter_id: z.string().min(1).default("google-calendar"),
    adapter_version: z.string().min(1).default("0.1.0"),
    /** Account email or "mock" for the fixture adapter. */
    account: z.string().min(1),
    /** Calendar id (typically "primary" or a calendar resource id). */
    calendar_id: z.string().min(1),
    /** Google Calendar API sync token for incremental pulls (§S30b). Null on the first sync. */
    sync_token: z.string().nullable().default(null),
    /** scaffold-day FixedEvent.id ↔ Google event id map. */
    event_id_map: z.record(z.string()).default({}),
    last_sync_at: z.string().nullable().default(null),
    /** Pointer back into the OAuth token file (storage backend). */
    oauth_ref: z.enum(["keytar", "file"]).default("file"),
  })
  .strict();

export type GoogleCalendarSyncState = z.infer<typeof GoogleCalendarSyncStateSchema>;

export function syncStatePath(home: string): string {
  return path.join(home, SYNC_DIR, GOOGLE_CALENDAR_STATE_FILE);
}

export async function readSyncState(
  home: string,
): Promise<GoogleCalendarSyncState | null> {
  const target = syncStatePath(home);
  try {
    const raw = await readFile(target, "utf8");
    const parsed = GoogleCalendarSyncStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: "sync/google-calendar.json failed schema validation" },
        cause: parsed.error.message,
        try: ["Restore from backup or re-run `scaffold-day auth login`."],
        context: { file: target },
      });
    }
    return parsed.data;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeSyncState(
  home: string,
  state: GoogleCalendarSyncState,
): Promise<void> {
  const target = syncStatePath(home);
  await mkdir(path.dirname(target), { recursive: true });
  const validated = GoogleCalendarSyncStateSchema.parse(state);
  await atomicWrite(target, `${JSON.stringify(validated, null, 2)}\n`, {
    mode: 0o600,
  });
}
