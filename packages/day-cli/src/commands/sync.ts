// `scaffold-day sync` — orchestrate one pull from the configured
// calendar source into the local day files. v0.3 ships pull-only;
// push-from-local-changes lands in v0.3.x once the local change-log
// is in place.
//
// Wire-up: reads <home>/.secrets/google-oauth.json (transparently
// merging the keychain refresh token), spins up the
// LiveGoogleCalendarAdapter, pulls a window around today, then
// reconciles each remote event against the matching local event by
// `external_id`. Reconciliation = Last-Wins (parity with the mock
// adapter): if remote.synced_at > local.synced_at, the local copy
// is replaced.
//
// All disk writes are scoped to the day file partitions
// (days/YYYY-MM/YYYY-MM-DD.json). No secret material is logged.

import {
  LiveGoogleCalendarAdapter,
  readGoogleOAuthToken,
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
};

function parseFlags(args: string[]): ParsedFlags {
  const out: ParsedFlags = { json: false };
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
  summary: "pull events from Google Calendar into local day files (one-way, S71/S72 wire-up)",
  help: {
    what: "Run a one-way pull from the live Google Calendar adapter. For each remote event, either insert it into the matching day file (new external_id) or apply the Last-Wins reconcile against the existing local copy. Push from local mutations is deferred to v0.3.x once the local change-log lands.",
    when: "After `auth login`, whenever you want the local day files to reflect the latest Google Calendar state — before placing todos, before the morning anchor, or as a watchdog.",
    cost: "One Google Calendar `events.list` call (incremental via the stored sync_token after the first run) plus one local read+write per affected day file. Refresh-token rotation is handled inside the adapter.",
    input: "[--start <YYYY-MM-DD>] [--end <YYYY-MM-DD>] [--account <email>] [--json] [--dry-run]",
    return: "Exit 0 with a summary (pulled / created / updated / unchanged). DAY_NOT_INITIALIZED when no token. DAY_OAUTH_NO_REFRESH when refresh fails. DAY_INVALID_INPUT on a 410 Gone (token reset; retry once).",
    gotcha: "v0.3.0 is pull-only. Default window is today − 7d → today + 30d (system TZ). Multi-day events land in the start day's file. Tracking SLICES.md §S71 / §S72.",
  },
  run: async (args) => run(args),
};
