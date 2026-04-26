import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isScaffoldError, type FixedEvent } from "@scaffold/day-core";
import { MockGoogleCalendarAdapter } from "./mock-adapter";
import {
  readSyncState,
  syncStatePath,
  writeSyncState,
} from "./sync-state";
import {
  readGoogleOAuthToken,
  tokenFilePath,
  writeGoogleOAuthToken,
} from "./token-storage";

let home: string;

const fixtureEvent = (id: string, ext: string): FixedEvent => ({
  id,
  source: "google-calendar",
  external_id: ext,
  title: `event ${id}`,
  start: "2026-04-26T10:00:00+09:00",
  end: "2026-04-26T11:00:00+09:00",
  all_day: false,
  location: null,
  notes: null,
  recurring: null,
  tags: [],
  synced_at: "2026-04-26T09:00:00+09:00",
});

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "scaffold-day-adapter-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("token-storage round-trip", () => {
  test("write + read returns identical payload with mode 0600", async () => {
    await writeGoogleOAuthToken(home, {
      access_token: "AT",
      refresh_token: "RT",
      token_type: "Bearer",
      expiry_at: "2026-04-26T18:00:00Z",
      scope: "https://www.googleapis.com/auth/calendar",
      account_email: "test@example.com",
      storage: "file",
    });
    const back = await readGoogleOAuthToken(home);
    expect(back).not.toBeNull();
    expect(back!.access_token).toBe("AT");
    expect(back!.refresh_token).toBe("RT");
    expect(back!.account_email).toBe("test@example.com");

    const { stat } = await import("node:fs/promises");
    const st = await stat(tokenFilePath(home));
    expect(st.mode & 0o777).toBe(0o600);
  });

  test("missing file → null (no throw)", async () => {
    expect(await readGoogleOAuthToken(home)).toBeNull();
  });

  test("malformed file → DAY_INVALID_INPUT", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(path.dirname(tokenFilePath(home)), { recursive: true });
    await writeFile(tokenFilePath(home), JSON.stringify({ access_token: "" }), "utf8");
    let caught: unknown;
    try {
      await readGoogleOAuthToken(home);
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_INVALID_INPUT");
  });
});

describe("sync-state round-trip", () => {
  test("write + read returns identical payload with mode 0600", async () => {
    await writeSyncState(home, {
      schema_version: "0.1.0",
      adapter_id: "google-calendar",
      adapter_version: "0.1.0",
      account: "user@example.com",
      calendar_id: "primary",
      sync_token: "abc",
      event_id_map: { evt_01abcdefghi100: "google-evt-1" },
      last_sync_at: "2026-04-26T09:00:00Z",
      oauth_ref: "file",
    });
    const back = await readSyncState(home);
    expect(back).not.toBeNull();
    expect(back!.sync_token).toBe("abc");
    expect(back!.event_id_map.evt_01abcdefghi100).toBe("google-evt-1");

    const { stat } = await import("node:fs/promises");
    const st = await stat(syncStatePath(home));
    expect(st.mode & 0o777).toBe(0o600);
  });

  test("missing → null", async () => {
    expect(await readSyncState(home)).toBeNull();
  });
});

describe("MockGoogleCalendarAdapter — pull/push lifecycle", () => {
  test("init writes initial sync state with provided account/calendar", async () => {
    const adapter = new MockGoogleCalendarAdapter({ events: [] });
    await adapter.init({
      home,
      account: { email: "user@example.com", calendar_id: "primary" },
    });
    const state = await readSyncState(home);
    expect(state).not.toBeNull();
    expect(state!.account).toBe("user@example.com");
    expect(state!.calendar_id).toBe("primary");
    expect(state!.sync_token).toBeNull();
  });

  test("first pull returns full fixture; sync_token + last_sync_at advance", async () => {
    const adapter = new MockGoogleCalendarAdapter({
      events: [fixtureEvent("evt_01abcdefghi100", "g-1")],
    });
    await adapter.init({ home, account: { email: "u@example.com" } });
    const events = await adapter.pull({
      start: "2026-04-26",
      end: "2026-04-26",
    });
    expect(events).toHaveLength(1);
    const state = await readSyncState(home);
    expect(state!.sync_token).toBe("mock-token-1");
    expect(state!.event_id_map.evt_01abcdefghi100).toBe("g-1");
    expect(state!.last_sync_at).not.toBeNull();
  });

  test("incremental: second pull returns [] when fixture flags incremental", async () => {
    const adapter = new MockGoogleCalendarAdapter({
      events: [fixtureEvent("evt_01abcdefghi100", "g-1")],
      incremental: true,
    });
    await adapter.init({ home, account: { email: "u@example.com" } });
    const first = await adapter.pull({ start: "2026-04-26", end: "2026-04-26" });
    expect(first).toHaveLength(1);
    const second = await adapter.pull({
      start: "2026-04-26",
      end: "2026-04-26",
    });
    expect(second).toEqual([]);
  });

  test("failAfterPulls=1 simulates 410 Gone; sync_token cleared", async () => {
    const adapter = new MockGoogleCalendarAdapter({
      events: [fixtureEvent("evt_01abcdefghi100", "g-1")],
      failAfterPulls: 1,
    });
    await adapter.init({ home, account: { email: "u@example.com" } });
    await adapter.pull({ start: "2026-04-26", end: "2026-04-26" });
    let caught: unknown;
    try {
      await adapter.pull({ start: "2026-04-26", end: "2026-04-26" });
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) {
      expect(caught.code).toBe("DAY_INVALID_INPUT");
      expect(caught.summary.en).toContain("410");
    }
    const state = await readSyncState(home);
    expect(state!.sync_token).toBeNull();
  });

  test("push records changes + returns synthetic external_ids", async () => {
    const adapter = new MockGoogleCalendarAdapter({ events: [] });
    await adapter.init({ home, account: { email: "u@example.com" } });
    const event = fixtureEvent("evt_01abcdefghi100", "g-1");
    const results = await adapter.push([
      { kind: "create", event },
      { kind: "update", event_id: event.id, patch: { title: "renamed" } },
      { kind: "delete", event_id: event.id },
    ]);
    expect(adapter.pushedChanges).toHaveLength(3);
    expect(results.every((r) => r.kind === "ok")).toBe(true);
  });

  test("push override allows simulating per-change error", async () => {
    const adapter = new MockGoogleCalendarAdapter({
      events: [],
      pushOverrides: [
        {
          kind: "error",
          change: { kind: "create", event: fixtureEvent("evt_01abcdefghi100", "g-1") },
          reason: "etag mismatch",
          retryable: true,
        },
      ],
    });
    await adapter.init({ home, account: { email: "u@example.com" } });
    const r = await adapter.push([{ kind: "create", event: fixtureEvent("evt_01abcdefghi100", "g-1") }]);
    expect(r[0]?.kind).toBe("error");
  });

  test("reconcile picks remote when remote.synced_at is later (Last-Wins)", () => {
    const adapter = new MockGoogleCalendarAdapter({ events: [] });
    const local = fixtureEvent("evt_01abcdefghi100", "g-1");
    const remote = {
      ...local,
      title: "remote-renamed",
      synced_at: "2026-04-26T10:00:00+09:00",
    };
    const result = adapter.reconcile(local, remote);
    expect(result.kind).toBe("theirs");
  });

  test("healthCheck reports last_sync_at from state", async () => {
    const adapter = new MockGoogleCalendarAdapter({
      events: [fixtureEvent("evt_01abcdefghi100", "g-1")],
    });
    await adapter.init({ home, account: { email: "u@example.com" } });
    await adapter.pull({ start: "2026-04-26", end: "2026-04-26" });
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.last_sync_at).not.toBeNull();
  });

  test("operations before init throw DAY_NOT_INITIALIZED", async () => {
    const adapter = new MockGoogleCalendarAdapter({ events: [] });
    let caught: unknown;
    try {
      await adapter.pull({ start: "2026-04-26", end: "2026-04-26" });
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_NOT_INITIALIZED");
  });
});

describe("MockGoogleCalendarAdapter — capabilities", () => {
  test("declares full read/write + recurring + single-account", () => {
    const adapter = new MockGoogleCalendarAdapter({ events: [] });
    const caps = adapter.capabilities();
    expect(caps).toEqual({
      read: true,
      write: true,
      push_create: true,
      push_update: true,
      push_delete: true,
      recurring_read: true,
      multi_account: false,
    });
  });
});
