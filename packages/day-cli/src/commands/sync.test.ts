import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AdapterCapabilities,
  AdapterConfig,
  AdapterHealth,
  DateRange,
  ExternalEvent,
  LocalEventChange,
  PushResult,
  Reconciliation,
  SyncAdapter,
} from "@scaffold/day-adapters";
import { generateEntityId, type FixedEvent } from "@scaffold/day-core";
import { runSyncWithAdapter } from "./sync";

class StubAdapter implements SyncAdapter {
  readonly id = "stub";
  readonly version = "0.0.0";
  constructor(private readonly remote: ExternalEvent[]) {}
  capabilities(): AdapterCapabilities {
    return {
      read: true,
      write: false,
      push_create: false,
      push_update: false,
      push_delete: false,
      recurring_read: false,
      multi_account: false,
    };
  }
  async init(_config: AdapterConfig): Promise<void> {}
  async pull(_range: DateRange): Promise<ExternalEvent[]> {
    return this.remote;
  }
  async push(_changes: ReadonlyArray<LocalEventChange>): Promise<PushResult[]> {
    return [];
  }
  reconcile(local: FixedEvent, remote: ExternalEvent): Reconciliation {
    if (Date.parse(remote.synced_at) > Date.parse(local.synced_at)) {
      return { kind: "theirs", reason: "remote newer" };
    }
    return { kind: "ours", reason: "local newer" };
  }
  async healthCheck(): Promise<AdapterHealth> {
    return { ok: true, detail: "stub" };
  }
}

let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "scaffold-day-sync-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function gcalEvent(opts: {
  external_id: string;
  title: string;
  date: string;
  start: string;
  end: string;
  synced_at?: string;
}): ExternalEvent {
  return {
    id: generateEntityId("event"),
    source: "google-calendar",
    external_id: opts.external_id,
    title: opts.title,
    start: `${opts.date}T${opts.start}:00+09:00`,
    end: `${opts.date}T${opts.end}:00+09:00`,
    all_day: false,
    location: null,
    notes: null,
    recurring: null,
    tags: [],
    synced_at: opts.synced_at ?? new Date().toISOString(),
  };
}

describe("sync orchestrator (S71/S72 wire-up via runSyncWithAdapter)", () => {
  test("pull → create: new external_id lands as a fresh event", async () => {
    const adapter = new StubAdapter([
      gcalEvent({
        external_id: "g1",
        title: "Standup",
        date: "2026-04-30",
        start: "10:00",
        end: "10:30",
      }),
    ]);
    const r = await runSyncWithAdapter({
      home,
      account: "u@example.com",
      start: "2026-04-29",
      end: "2026-05-01",
      adapter,
      json: true,
      dryRun: false,
    });
    expect(r.exitCode).toBe(0);
    expect(r.summary.pulled).toBe(1);
    expect(r.summary.created).toBe(1);
    expect(r.summary.updated).toBe(0);
    expect(r.summary.unchanged).toBe(0);

    const day = JSON.parse(
      await readFile(path.join(home, "days/2026-04/2026-04-30.json"), "utf8"),
    );
    expect(day.events).toHaveLength(1);
    expect(day.events[0].external_id).toBe("g1");
    expect(day.events[0].title).toBe("Standup");
  });

  test("pull → reconcile theirs: later remote synced_at replaces local", async () => {
    // Seed a local event by running a first sync.
    const local = gcalEvent({
      external_id: "g2",
      title: "old title",
      date: "2026-04-30",
      start: "11:00",
      end: "11:30",
      synced_at: "2026-04-30T01:00:00.000Z",
    });
    await runSyncWithAdapter({
      home,
      account: "u@example.com",
      start: "2026-04-30",
      end: "2026-04-30",
      adapter: new StubAdapter([local]),
      json: true,
      dryRun: false,
    });
    // Second pull with newer synced_at + new title → theirs wins.
    const remote = gcalEvent({
      external_id: "g2",
      title: "new title",
      date: "2026-04-30",
      start: "11:00",
      end: "11:30",
      synced_at: "2026-04-30T02:00:00.000Z",
    });
    const r = await runSyncWithAdapter({
      home,
      account: "u@example.com",
      start: "2026-04-30",
      end: "2026-04-30",
      adapter: new StubAdapter([remote]),
      json: true,
      dryRun: false,
    });
    expect(r.summary.updated).toBe(1);
    expect(r.summary.created).toBe(0);
    expect(r.summary.unchanged).toBe(0);

    const day = JSON.parse(
      await readFile(path.join(home, "days/2026-04/2026-04-30.json"), "utf8"),
    );
    expect(day.events).toHaveLength(1);
    expect(day.events[0].title).toBe("new title");
  });

  test("pull → reconcile ours: older remote leaves local untouched", async () => {
    const local = gcalEvent({
      external_id: "g3",
      title: "stays",
      date: "2026-04-30",
      start: "13:00",
      end: "13:30",
      synced_at: "2026-04-30T05:00:00.000Z",
    });
    await runSyncWithAdapter({
      home,
      account: "u@example.com",
      start: "2026-04-30",
      end: "2026-04-30",
      adapter: new StubAdapter([local]),
      json: true,
      dryRun: false,
    });
    const olderRemote = gcalEvent({
      external_id: "g3",
      title: "ignored rename",
      date: "2026-04-30",
      start: "13:00",
      end: "13:30",
      synced_at: "2026-04-30T01:00:00.000Z",
    });
    const r = await runSyncWithAdapter({
      home,
      account: "u@example.com",
      start: "2026-04-30",
      end: "2026-04-30",
      adapter: new StubAdapter([olderRemote]),
      json: true,
      dryRun: false,
    });
    expect(r.summary.unchanged).toBe(1);
    expect(r.summary.updated).toBe(0);

    const day = JSON.parse(
      await readFile(path.join(home, "days/2026-04/2026-04-30.json"), "utf8"),
    );
    expect(day.events[0].title).toBe("stays");
  });

  test("dry-run produces no disk writes", async () => {
    const adapter = new StubAdapter([
      gcalEvent({
        external_id: "g4",
        title: "would-be",
        date: "2026-05-01",
        start: "09:00",
        end: "09:30",
      }),
    ]);
    const r = await runSyncWithAdapter({
      home,
      account: "u@example.com",
      start: "2026-05-01",
      end: "2026-05-01",
      adapter,
      json: true,
      dryRun: true,
    });
    expect(r.exitCode).toBe(0);
    expect(r.summary.pulled).toBe(1);
    let exists = false;
    try {
      await readFile(path.join(home, "days/2026-05/2026-05-01.json"), "utf8");
      exists = true;
    } catch {
      /* expected: no file */
    }
    expect(exists).toBe(false);
  });

  test("empty remote list returns a clean zero summary", async () => {
    const adapter = new StubAdapter([]);
    const r = await runSyncWithAdapter({
      home,
      account: "u@example.com",
      start: "2026-04-30",
      end: "2026-04-30",
      adapter,
      json: true,
      dryRun: false,
    });
    expect(r.summary).toMatchObject({
      pulled: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
    });
  });
});
