// `scaffold-day sync` — orchestrate pull / push between the local
// day files and the configured calendar source.
//
// Pull (default, v0.3.0): reads <home>/.secrets/google-oauth.json,
// spins up the LiveGoogleCalendarAdapter, pulls a window around
// today, then reconciles each remote event against the matching
// local event by `external_id`. Reconciliation = Last-Wins parity
// with the mock adapter.
//
// Push (--push, v0.3.1): reads the pending-changes queue
// (<home>/sync/google-calendar-pending.jsonl) populated by
// `event add/update/delete`, replays each entry through
// adapter.push(), updates the local event with the new external_id
// on create-success, and compacts the queue.
//
// All disk writes are scoped to the day file partitions
// (days/YYYY-MM/YYYY-MM-DD.json) plus the pending-changes file. No
// secret material is logged.

import {
  compactPendingChanges,
  LiveGoogleCalendarAdapter,
  type LocalEventChange,
  type PendingChange,
  type PushResult,
  readGoogleOAuthToken,
  readPendingChanges,
  type ExternalEvent,
  type SyncAdapter,
} from "@scaffold/day-adapters";
import {
  defaultHomeDir,
  FsDayStore,
  ScaffoldError,
  todayInTz as todayInTzCore,
  type Day,
  type FixedEvent,
} from "@scaffold/day-core";
import type { Command } from "../cli/command";
import { emitDryRun, isDryRun } from "../cli/runtime";

const MAX_PUSH_ATTEMPTS = 3;

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day sync --help` for the full input contract.",
    try: ["Run `scaffold-day sync --help`."],
  });
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function shiftDate(date: string, delta: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return new Date(ms + delta * 86_400_000).toISOString().slice(0, 10);
}

type ParsedFlags = {
  start?: string;
  end?: string;
  account?: string;
  json: boolean;
  push: boolean;
};

function parseFlags(args: string[]): ParsedFlags {
  const out: ParsedFlags = { json: false, push: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--start") {
      const v = args[i + 1];
      if (!v || !ISO_DATE_RE.test(v)) throw usage("--start requires a YYYY-MM-DD value");
      out.start = v;
      i++;
    } else if (a === "--end") {
      const v = args[i + 1];
      if (!v || !ISO_DATE_RE.test(v)) throw usage("--end requires a YYYY-MM-DD value");
      out.end = v;
      i++;
    } else if (a === "--account") {
      const v = args[i + 1];
      if (!v) throw usage("--account requires an email value");
      out.account = v;
      i++;
    } else if (a === "--json") {
      out.json = true;
    } else if (a === "--push") {
      out.push = true;
    } else if (a.startsWith("--")) {
      throw usage(`sync: unknown option '${a}'`);
    } else {
      throw usage(`sync: unexpected argument '${a}'`);
    }
  }
  return out;
}

type SyncSummary = {
  range: { start: string; end: string };
  account: string | null;
  pulled: number;
  created: number;
  updated: number;
  unchanged: number;
  events: Array<{
    external_id: string;
    title: string;
    date: string;
    action: "created" | "updated" | "unchanged";
    reason?: string;
  }>;
};

async function findLocalByExternalId(
  store: FsDayStore,
  externalId: string,
  hintDate: string,
): Promise<{ event: FixedEvent; date: string } | null> {
  // Probe the hinted date first (the date derived from the remote
  // start), then fan out a few neighbour days in case a previous
  // reconcile had a different partition.
  const tries = [hintDate, shiftDate(hintDate, -1), shiftDate(hintDate, 1)];
  for (const d of tries) {
    const day = await store.readDay(d);
    const ev = day.events.find((e) => e.external_id === externalId);
    if (ev) return { event: ev, date: d };
  }
  return null;
}

async function applyRemote(
  store: FsDayStore,
  remote: ExternalEvent,
  adapter: SyncAdapter,
  summary: SyncSummary,
  dryRun: boolean,
): Promise<void> {
  if (!remote.external_id) return;
  const date = remote.start.slice(0, 10);
  const existing = await findLocalByExternalId(store, remote.external_id, date);

  if (!existing) {
    summary.created += 1;
    summary.events.push({
      external_id: remote.external_id,
      title: remote.title,
      date,
      action: "created",
    });
    if (!dryRun) await store.addEvent(date, remote);
    return;
  }

  const decision = adapter.reconcile(existing.event, remote);
  if (decision.kind === "theirs") {
    summary.updated += 1;
    summary.events.push({
      external_id: remote.external_id,
      title: remote.title,
      date,
      action: "updated",
      reason: decision.reason,
    });
    if (!dryRun) {
      // Strip from old date, write to (possibly new) date.
      if (existing.date === date) {
        const day: Day = await store.readDay(date);
        day.events = day.events.map((e) =>
          e.external_id === remote.external_id ? remote : e,
        );
        await store.writeDay(day);
      } else {
        const oldDay: Day = await store.readDay(existing.date);
        oldDay.events = oldDay.events.filter(
          (e) => e.external_id !== remote.external_id,
        );
        await store.writeDay(oldDay);
        await store.addEvent(date, remote);
      }
    }
    return;
  }

  summary.unchanged += 1;
  summary.events.push({
    external_id: remote.external_id,
    title: remote.title,
    date,
    action: "unchanged",
    reason: decision.kind === "ours" ? decision.reason : "merged",
  });
}

// ─── push side ────────────────────────────────────────────────────

export type PushSummary = {
  account: string;
  attempted: number;
  created: number;
  updated: number;
  deleted: number;
  retried: number;
  abandoned: number;
  events: Array<{
    event_id: string;
    external_id: string | null;
    kind: PendingChange["kind"];
    action: "ok" | "retry" | "abandoned";
    reason?: string;
  }>;
};

function pendingToChange(p: PendingChange): LocalEventChange {
  if (p.kind === "create") {
    return { kind: "create", event: p.snapshot as unknown as FixedEvent };
  }
  if (p.kind === "delete") {
    return { kind: "delete", event_id: p.external_id ?? p.event_id };
  }
  return {
    kind: "update",
    event_id: p.external_id ?? p.event_id,
    patch: (p.patch ?? {}) as Partial<FixedEvent>,
  };
}

async function locateLocal(
  store: FsDayStore,
  eventId: string,
): Promise<{ event: FixedEvent; date: string } | null> {
  const months = await store.listMonths();
  for (const m of months) {
    const dates = await store.listMonth(m);
    for (const d of dates) {
      const day = await store.readDay(d);
      const ev = day.events.find((e) => e.id === eventId);
      if (ev) return { event: ev, date: d };
    }
  }
  return null;
}

async function attachExternalId(
  store: FsDayStore,
  eventId: string,
  externalId: string,
  syncedAt: string,
): Promise<void> {
  const found = await locateLocal(store, eventId);
  if (!found) return;
  const day = await store.readDay(found.date);
  day.events = day.events.map((e) =>
    e.id === eventId
      ? { ...e, source: "google-calendar", external_id: externalId, synced_at: syncedAt }
      : e,
  );
  await store.writeDay(day);
}

/**
 * Replay pending local changes through the adapter. Exposed for unit
 * tests with an injected adapter; the CLI entry point uses
 * LiveGoogleCalendarAdapter. Compacts the queue at the end.
 */
export async function runPushWithAdapter(opts: {
  home: string;
  account: string;
  adapter: SyncAdapter;
  json: boolean;
  dryRun: boolean;
}): Promise<{ exitCode: number; summary: PushSummary }> {
  const pending = await readPendingChanges(opts.home);
  const store = new FsDayStore(opts.home);
  const summary: PushSummary = {
    account: opts.account,
    attempted: pending.length,
    created: 0,
    updated: 0,
    deleted: 0,
    retried: 0,
    abandoned: 0,
    events: [],
  };

  if (opts.dryRun) {
    for (const p of pending) {
      summary.events.push({
        event_id: p.event_id,
        external_id: p.external_id,
        kind: p.kind,
        action: "ok",
        reason: "dry-run",
      });
      if (p.kind === "create") summary.created += 1;
      if (p.kind === "update") summary.updated += 1;
      if (p.kind === "delete") summary.deleted += 1;
    }
    emitDryRun(opts.json, {
      command: "sync --push",
      writes: pending.map((p) => ({
        path: "sync/google-calendar-pending.jsonl",
        op: "update" as const,
      })),
      result: summary,
    });
    return { exitCode: 0, summary };
  }

  const survivors: PendingChange[] = [];
  for (const p of pending) {
    const change = pendingToChange(p);
    let result: PushResult;
    try {
      const [r] = await opts.adapter.push([change]);
      result = r as PushResult;
    } catch (err) {
      result = {
        kind: "error",
        change,
        reason: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
    }
    if (result.kind === "ok") {
      if (p.kind === "create") {
        summary.created += 1;
        await attachExternalId(store, p.event_id, result.external_id, result.synced_at);
      } else if (p.kind === "update") {
        summary.updated += 1;
      } else {
        summary.deleted += 1;
      }
      summary.events.push({
        event_id: p.event_id,
        external_id: result.external_id,
        kind: p.kind,
        action: "ok",
      });
      continue;
    }
    // Error path: retryable → keep with attempts++; non-retryable or
    // attempts past the cap → drop and surface to user.
    const nextAttempts = p.attempts + 1;
    const giveUp = !result.retryable || nextAttempts >= MAX_PUSH_ATTEMPTS;
    if (giveUp) {
      summary.abandoned += 1;
      summary.events.push({
        event_id: p.event_id,
        external_id: p.external_id,
        kind: p.kind,
        action: "abandoned",
        reason: result.reason,
      });
    } else {
      summary.retried += 1;
      survivors.push({ ...p, attempts: nextAttempts });
      summary.events.push({
        event_id: p.event_id,
        external_id: p.external_id,
        kind: p.kind,
        action: "retry",
        reason: result.reason,
      });
    }
  }
  await compactPendingChanges(opts.home, survivors);

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return { exitCode: 0, summary };
  }
  console.log("scaffold-day sync --push");
  console.log(`  account:   ${opts.account}`);
  console.log(`  attempted: ${summary.attempted}`);
  console.log(`  created:   ${summary.created}`);
  console.log(`  updated:   ${summary.updated}`);
  console.log(`  deleted:   ${summary.deleted}`);
  if (summary.retried > 0) console.log(`  retried:   ${summary.retried}`);
  if (summary.abandoned > 0) console.log(`  abandoned: ${summary.abandoned}`);
  return { exitCode: 0, summary };
}

/**
 * Run a sync against an injected adapter. Exposed for unit tests so
 * we can exercise the orchestration without spinning up a real
 * Google Calendar client. The CLI entry point constructs a
 * LiveGoogleCalendarAdapter and forwards.
 */
export async function runSyncWithAdapter(opts: {
  home: string;
  account: string;
  start: string;
  end: string;
  adapter: SyncAdapter;
  json: boolean;
  dryRun: boolean;
  /** Suppress stdout output (used by auto-sync from other commands). */
  silent?: boolean;
}): Promise<{ exitCode: number; summary: SyncSummary }> {
  const remote = await opts.adapter.pull({ start: opts.start, end: opts.end });
  const store = new FsDayStore(opts.home);
  const summary: SyncSummary = {
    range: { start: opts.start, end: opts.end },
    account: opts.account,
    pulled: remote.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    events: [],
  };
  for (const r of remote) {
    await applyRemote(store, r, opts.adapter, summary, opts.dryRun);
  }
  if (opts.silent) return { exitCode: 0, summary };
  if (opts.dryRun) {
    emitDryRun(opts.json, {
      command: "sync",
      writes: summary.events
        .filter((e) => e.action !== "unchanged")
        .map((e) => ({
          path: `days/${e.date.slice(0, 7)}/${e.date}.json`,
          op: "update" as const,
        })),
      result: summary,
    });
    return { exitCode: 0, summary };
  }
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return { exitCode: 0, summary };
  }
  console.log("scaffold-day sync");
  console.log(`  account:   ${opts.account}`);
  console.log(`  range:     ${opts.start} → ${opts.end}`);
  console.log(`  pulled:    ${summary.pulled}`);
  console.log(`  created:   ${summary.created}`);
  console.log(`  updated:   ${summary.updated}`);
  console.log(`  unchanged: ${summary.unchanged}`);
  return { exitCode: 0, summary };
}

async function run(args: string[]): Promise<number> {
  const flags = parseFlags(args);

  const home = defaultHomeDir();
  const token = await readGoogleOAuthToken(home);
  if (!token) {
    throw new ScaffoldError({
      code: "DAY_NOT_INITIALIZED",
      summary: { en: "no stored Google Calendar credentials" },
      cause: "sync needs a refresh token to call the Google Calendar API.",
      try: ["Run `scaffold-day auth login` first."],
    });
  }

  const accountFromToken = token.account_email;
  const account = flags.account ?? accountFromToken;
  if (!account) {
    throw new ScaffoldError({
      code: "DAY_USAGE",
      summary: { en: "sync: no account_email on stored token; pass --account <email>" },
      cause: "The stored token has no account_email, so we cannot key the sync state.",
      try: ["Pass --account <email> matching the calendar owner."],
    });
  }

  // Default window: today − 7 to today + 30 days, in the system TZ.
  // Past 7d catches reconciles for events recently moved/cancelled;
  // future 30d covers placement-engine planning windows.
  const today = todayInTzCore(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const start = flags.start ?? shiftDate(today, -7);
  const end = flags.end ?? shiftDate(today, 30);
  if (Date.parse(`${end}T00:00:00Z`) < Date.parse(`${start}T00:00:00Z`)) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "--end must be on or after --start" },
      cause: `start: ${start}\nend:   ${end}`,
      try: ["Pass an --end value on or after --start."],
    });
  }

  const adapter = new LiveGoogleCalendarAdapter();
  await adapter.init({ home, account: { email: account } });

  if (flags.push) {
    const r = await runPushWithAdapter({
      home,
      account,
      adapter,
      json: flags.json,
      dryRun: isDryRun(),
    });
    return r.exitCode;
  }

  const result = await runSyncWithAdapter({
    home,
    account,
    start,
    end,
    adapter,
    json: flags.json,
    dryRun: isDryRun(),
  });
  return result.exitCode;
}

export const syncCommand: Command = {
  name: "sync",
  summary: "pull events from / push pending mutations to Google Calendar",
  help: {
    what: "Pull (default): for each remote event, either insert into the matching day file or apply Last-Wins reconcile. Push (`--push`): replay queued local mutations (`event add/update/delete`) through the adapter, attach Google's external_id to created events, and compact the queue. Retryable errors stay queued (up to 3 attempts); non-retryable errors are reported and dropped.",
    when: "After `auth login`, before placing todos (pull) or after a batch of local event edits (push). Run periodically as a sanity check.",
    cost: "Pull: one `events.list` call (incremental via stored sync_token after the first run) + one local read+write per affected day file. Push: one Calendar API call per pending entry. Refresh-token rotation is handled inside the adapter.",
    input: "[--start <YYYY-MM-DD>] [--end <YYYY-MM-DD>] [--account <email>] [--push] [--json] [--dry-run]",
    return: "Exit 0 with a summary. Pull: pulled/created/updated/unchanged. Push: attempted/created/updated/deleted/retried/abandoned. DAY_NOT_INITIALIZED when no token. DAY_OAUTH_NO_REFRESH when refresh fails. DAY_INVALID_INPUT on a 410 Gone (sync_token reset; retry once).",
    gotcha: "Pending push entries are auto-recorded by `event add/update/delete` only when a Google token is present at mutation time. Events created before `auth login` are not auto-pushed. Default pull window is today − 7d → today + 30d (system TZ). Tracking SLICES.md §S71 / §S72.",
  },
  run: async (args) => run(args),
};
