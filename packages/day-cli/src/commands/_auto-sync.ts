// Auto-sync helper used by read-side commands (`place suggest`,
// `today` warning, …) so users don't have to remember `scaffold-day
// sync` before every placement decision.
//
// Behaviour:
//   1. Skip if no Google Calendar token (offline use stays clean).
//   2. Skip if SCAFFOLD_DAY_AUTO_SYNC=0 or the caller passes
//      noSync=true (per-command --no-sync flag).
//   3. Probe sync-state.last_sync_at; if missing or older than the
//      threshold, run a best-effort pull. Network/auth errors are
//      caught and surfaced as a warning — they never block the
//      caller's primary action.
//
// Returns a small status string the caller can stitch into output,
// or null when nothing was done.

import {
  LiveGoogleCalendarAdapter,
  readGoogleOAuthToken,
  readSyncState,
} from "@scaffold/day-adapters";
import { runSyncWithAdapter } from "./sync";

const DEFAULT_STALE_MIN = 60;

export type AutoSyncStatus =
  | { kind: "skipped"; reason: "no-token" | "disabled" | "fresh" }
  | { kind: "synced"; pulled: number; created: number; updated: number }
  | { kind: "warning"; reason: string };

export type AutoSyncOpts = {
  home: string;
  /** Caller passed --no-sync → skip entirely. */
  noSync?: boolean;
  /** Override the stale threshold (minutes). */
  staleMin?: number;
  /** Caller-controlled sync window. Defaults match `sync` command. */
  start?: string;
  end?: string;
};

function envDisabled(): boolean {
  const v = process.env.SCAFFOLD_DAY_AUTO_SYNC;
  return v === "0" || v === "false" || v === "no";
}

function shiftDate(date: string, delta: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return new Date(ms + delta * 86_400_000).toISOString().slice(0, 10);
}

function todayInSystemTz(): string {
  const now = process.env.SCAFFOLD_DAY_NOW ? new Date(process.env.SCAFFOLD_DAY_NOW) : new Date();
  return now.toISOString().slice(0, 10);
}

export async function maybeAutoSync(opts: AutoSyncOpts): Promise<AutoSyncStatus> {
  if (opts.noSync) return { kind: "skipped", reason: "disabled" };
  if (envDisabled()) return { kind: "skipped", reason: "disabled" };

  const token = await readGoogleOAuthToken(opts.home).catch(() => null);
  if (!token) return { kind: "skipped", reason: "no-token" };

  const state = await readSyncState(opts.home).catch(() => null);
  const staleMin = opts.staleMin ?? DEFAULT_STALE_MIN;
  if (state?.last_sync_at) {
    const ageMs = Date.now() - Date.parse(state.last_sync_at);
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < staleMin * 60_000) {
      return { kind: "skipped", reason: "fresh" };
    }
  }

  // Stale (or never synced) → best-effort pull. Errors get demoted
  // to a warning — read-side commands MUST keep working when the
  // network is down.
  try {
    const today = todayInSystemTz();
    const start = opts.start ?? shiftDate(today, -7);
    const end = opts.end ?? shiftDate(today, 30);
    const account = token.account_email;
    if (!account) return { kind: "warning", reason: "no account_email on token" };
    const adapter = new LiveGoogleCalendarAdapter();
    await adapter.init({ home: opts.home, account: { email: account } });
    const r = await runSyncWithAdapter({
      home: opts.home,
      account,
      start,
      end,
      adapter,
      json: false,
      dryRun: false,
      silent: true,
    });
    return {
      kind: "synced",
      pulled: r.summary.pulled,
      created: r.summary.created,
      updated: r.summary.updated,
    };
  } catch (err) {
    return {
      kind: "warning",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
