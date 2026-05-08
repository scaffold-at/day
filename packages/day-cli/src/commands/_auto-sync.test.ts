import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  writeGoogleOAuthToken,
  writeSyncState,
  type GoogleCalendarSyncState,
} from "@scaffold/day-adapters";
import { maybeAutoSync } from "./_auto-sync";

let home: string;
let priorEnv: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "scaffold-day-auto-sync-"));
  priorEnv = process.env.SCAFFOLD_DAY_AUTO_SYNC;
  delete process.env.SCAFFOLD_DAY_AUTO_SYNC;
});
afterEach(async () => {
  if (priorEnv === undefined) delete process.env.SCAFFOLD_DAY_AUTO_SYNC;
  else process.env.SCAFFOLD_DAY_AUTO_SYNC = priorEnv;
  await rm(home, { recursive: true, force: true });
});

async function seedToken(): Promise<void> {
  await writeGoogleOAuthToken(
    home,
    {
      access_token: "AT",
      refresh_token: "RT",
      token_type: "Bearer",
      expiry_at: new Date(Date.now() + 3_600_000).toISOString(),
      scope: "https://www.googleapis.com/auth/calendar",
      account_email: "u@example.com",
      storage: "file",
    },
    { preferFile: true },
  );
}

async function seedSyncState(lastSyncAt: string | null): Promise<void> {
  const state: GoogleCalendarSyncState = {
    schema_version: "0.1.0",
    adapter_id: "google-calendar-live",
    adapter_version: "0.1.0",
    account: "u@example.com",
    calendar_id: "primary",
    sync_token: "TOKEN-1",
    event_id_map: {},
    last_sync_at: lastSyncAt,
    oauth_ref: "file",
  };
  await writeSyncState(home, state);
}

describe("maybeAutoSync — skip paths", () => {
  test("no token → skipped:no-token", async () => {
    const r = await maybeAutoSync({ home });
    expect(r.kind).toBe("skipped");
    if (r.kind === "skipped") expect(r.reason).toBe("no-token");
  });

  test("noSync=true → skipped:disabled (even with a fresh token)", async () => {
    await seedToken();
    const r = await maybeAutoSync({ home, noSync: true });
    expect(r.kind).toBe("skipped");
    if (r.kind === "skipped") expect(r.reason).toBe("disabled");
  });

  test("SCAFFOLD_DAY_AUTO_SYNC=0 → skipped:disabled", async () => {
    await seedToken();
    process.env.SCAFFOLD_DAY_AUTO_SYNC = "0";
    const r = await maybeAutoSync({ home });
    expect(r.kind).toBe("skipped");
    if (r.kind === "skipped") expect(r.reason).toBe("disabled");
  });

  test("recent last_sync_at → skipped:fresh", async () => {
    await seedToken();
    await seedSyncState(new Date(Date.now() - 5 * 60_000).toISOString()); // 5 min ago
    const r = await maybeAutoSync({ home });
    expect(r.kind).toBe("skipped");
    if (r.kind === "skipped") expect(r.reason).toBe("fresh");
  });

  test("custom staleMin=120 keeps a 90-min-old sync 'fresh'", async () => {
    await seedToken();
    await seedSyncState(new Date(Date.now() - 90 * 60_000).toISOString());
    const r = await maybeAutoSync({ home, staleMin: 120 });
    expect(r.kind).toBe("skipped");
    if (r.kind === "skipped") expect(r.reason).toBe("fresh");
  });
});

describe("maybeAutoSync — actual sync attempt", () => {
  test("stale token-bearing home triggers a network attempt → warning when adapter init fails", async () => {
    await seedToken();
    await seedSyncState(new Date(Date.now() - 6 * 60 * 60_000).toISOString()); // 6h old
    // No fetch override — the LiveGoogleCalendarAdapter will attempt
    // a real network call; in a test environment this fails. We
    // assert the helper degrades to a warning rather than throwing.
    const r = await maybeAutoSync({ home });
    expect(["synced", "warning"]).toContain(r.kind);
  });
});
