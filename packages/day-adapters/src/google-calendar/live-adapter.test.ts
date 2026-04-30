import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isScaffoldError } from "@scaffold/day-core";
import { LiveGoogleCalendarAdapter } from "./live-adapter";
import { writeGoogleOAuthToken } from "./token-storage";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "scaffold-day-live-adapter-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function seedToken(home: string, email = "u@example.com"): Promise<void> {
  // preferFile=true keeps the test isolated to the temp home — no
  // OS Keychain side effects when running on a developer machine.
  await writeGoogleOAuthToken(
    home,
    {
      access_token: "ya29.dummy",
      refresh_token: "1//refresh-dummy",
      token_type: "Bearer",
      expiry_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      scope: "https://www.googleapis.com/auth/calendar",
      account_email: email,
      storage: "file",
    },
    { preferFile: true },
  );
}

function makeFetch(responder: (req: Request) => Response | Promise<Response>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    const req = new Request(url, init);
    return responder(req);
  }) as typeof fetch;
}

const SAMPLE_GCAL_EVENT = {
  id: "evt_g1",
  status: "confirmed",
  summary: "Standup",
  start: { dateTime: "2026-04-29T10:00:00+09:00" },
  end: { dateTime: "2026-04-29T10:30:00+09:00" },
  etag: '"abc"',
  updated: "2026-04-29T09:55:00.000Z",
};

describe("LiveGoogleCalendarAdapter — capabilities + identity", () => {
  test("declares full read/write + recurring + single-account", () => {
    const a = new LiveGoogleCalendarAdapter({
      fetchImpl: makeFetch(() => new Response("{}")),
    });
    expect(a.id).toBe("google-calendar-live");
    expect(a.capabilities()).toEqual({
      read: true,
      write: true,
      push_create: true,
      push_update: true,
      push_delete: true,
      recurring_read: true,
      multi_account: false,
    });
  });

  test("init refuses without a stored token", async () => {
    const a = new LiveGoogleCalendarAdapter({
      fetchImpl: makeFetch(() => new Response("{}")),
    });
    let caught: unknown;
    try {
      await a.init({ home, account: { email: "u@example.com" } });
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) {
      expect(caught.code).toBe("DAY_NOT_INITIALIZED");
    }
  });
});

describe("LiveGoogleCalendarAdapter — pull", () => {
  test("first pull (no sync token) maps gcal events into FixedEvent and stores syncToken", async () => {
    await seedToken(home);
    let captured: URL | null = null;
    const adapter = new LiveGoogleCalendarAdapter({
      fetchImpl: makeFetch((req) => {
        captured = new URL(req.url);
        return new Response(
          JSON.stringify({
            kind: "calendar#events",
            items: [SAMPLE_GCAL_EVENT],
            nextSyncToken: "TOKEN-1",
          }),
          { headers: { "content-type": "application/json" } },
        );
      }),
    });
    await adapter.init({ home, account: { email: "u@example.com" } });
    const events = await adapter.pull({ start: "2026-04-29", end: "2026-04-29" });
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe("Standup");
    expect(events[0]!.source).toBe("google-calendar");
    expect(events[0]!.external_id).toBe("evt_g1");
    expect(captured).not.toBeNull();
    // First call should use timeMin/timeMax, not syncToken.
    expect(captured!.searchParams.get("timeMin")).toBeTruthy();
    expect(captured!.searchParams.has("syncToken")).toBe(false);
  });

  test("second pull uses the stored syncToken", async () => {
    await seedToken(home);
    let urls: URL[] = [];
    const adapter = new LiveGoogleCalendarAdapter({
      fetchImpl: makeFetch((req) => {
        urls.push(new URL(req.url));
        const isFirst = urls.length === 1;
        return new Response(
          JSON.stringify({
            kind: "calendar#events",
            items: isFirst ? [SAMPLE_GCAL_EVENT] : [],
            nextSyncToken: isFirst ? "TOKEN-1" : "TOKEN-2",
          }),
          { headers: { "content-type": "application/json" } },
        );
      }),
    });
    await adapter.init({ home, account: { email: "u@example.com" } });
    await adapter.pull({ start: "2026-04-29", end: "2026-04-29" });
    await adapter.pull({ start: "2026-04-29", end: "2026-04-29" });
    expect(urls).toHaveLength(2);
    expect(urls[1]!.searchParams.get("syncToken")).toBe("TOKEN-1");
  });

  test("410 Gone clears sync_token and surfaces a DAY_INVALID_INPUT", async () => {
    await seedToken(home);
    let calls = 0;
    const adapter = new LiveGoogleCalendarAdapter({
      fetchImpl: makeFetch(() => {
        calls++;
        return calls === 1
          ? new Response(
              JSON.stringify({
                kind: "calendar#events",
                items: [SAMPLE_GCAL_EVENT],
                nextSyncToken: "TOKEN-1",
              }),
              { headers: { "content-type": "application/json" } },
            )
          : new Response("Gone", { status: 410, statusText: "Gone" });
      }),
    });
    await adapter.init({ home, account: { email: "u@example.com" } });
    await adapter.pull({ start: "2026-04-29", end: "2026-04-29" });
    let caught: unknown;
    try {
      await adapter.pull({ start: "2026-04-29", end: "2026-04-29" });
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) {
      expect(caught.summary.en).toContain("410");
    }
  });
});

describe("LiveGoogleCalendarAdapter — push", () => {
  test("create returns the new external_id", async () => {
    await seedToken(home);
    const adapter = new LiveGoogleCalendarAdapter({
      fetchImpl: makeFetch(() =>
        new Response(JSON.stringify({ id: "new_g1", etag: '"e"' }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    });
    await adapter.init({ home, account: { email: "u@example.com" } });
    const r = await adapter.push([
      {
        kind: "create",
        event: {
          id: "evt_01abcdefghi100",
          source: "google-calendar",
          external_id: null,
          title: "OKR draft",
          start: "2026-04-29T10:00:00+09:00",
          end: "2026-04-29T11:00:00+09:00",
          all_day: false,
          location: null,
          notes: null,
          recurring: null,
          tags: [],
          synced_at: "2026-04-29T01:00:00.000Z",
        },
      },
    ]);
    expect(r[0]!.kind).toBe("ok");
    if (r[0]!.kind === "ok") {
      expect(r[0]!.external_id).toBe("new_g1");
    }
  });

  test("update with 412 etag mismatch returns retryable error", async () => {
    await seedToken(home);
    const adapter = new LiveGoogleCalendarAdapter({
      fetchImpl: makeFetch(
        () => new Response("Precondition Failed", { status: 412, statusText: "Precondition Failed" }),
      ),
    });
    await adapter.init({ home, account: { email: "u@example.com" } });
    const r = await adapter.push([
      { kind: "update", event_id: "evt_g1", patch: { title: "renamed" } },
    ]);
    expect(r[0]!.kind).toBe("error");
    if (r[0]!.kind === "error") {
      expect(r[0]!.retryable).toBe(true);
      expect(r[0]!.reason).toContain("etag");
    }
  });

  test("delete tolerates 404/410 (already gone) as success", async () => {
    await seedToken(home);
    const adapter = new LiveGoogleCalendarAdapter({
      fetchImpl: makeFetch(
        () => new Response("", { status: 410, statusText: "Gone" }),
      ),
    });
    await adapter.init({ home, account: { email: "u@example.com" } });
    const r = await adapter.push([{ kind: "delete", event_id: "evt_g1" }]);
    expect(r[0]!.kind).toBe("ok");
  });
});

describe("LiveGoogleCalendarAdapter — reconcile (Last-Wins parity)", () => {
  test("remote wins when remote.synced_at is later", () => {
    const adapter = new LiveGoogleCalendarAdapter({
      fetchImpl: makeFetch(() => new Response("{}")),
    });
    const local = {
      id: "evt_01abcdefghi100",
      source: "google-calendar" as const,
      external_id: "g1",
      title: "old",
      start: "2026-04-29T10:00:00+09:00",
      end: "2026-04-29T11:00:00+09:00",
      all_day: false,
      location: null,
      notes: null,
      recurring: null,
      tags: [],
      synced_at: "2026-04-29T08:00:00.000Z",
    };
    const remote = { ...local, title: "new", synced_at: "2026-04-29T09:00:00.000Z" };
    const r = adapter.reconcile(local, remote);
    expect(r.kind).toBe("theirs");
  });
});
