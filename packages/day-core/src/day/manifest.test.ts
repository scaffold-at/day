import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type FixedEvent, FsDayStore } from "./index";

let home: string;
let store: FsDayStore;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "scaffold-day-manifest-"));
  store = new FsDayStore(home);
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const event = (overrides: Partial<FixedEvent> = {}): FixedEvent => ({
  id: overrides.id ?? "evt_01abcdefghi123",
  source: "manual",
  external_id: null,
  title: overrides.title ?? "test",
  start: overrides.start ?? "2026-04-26T10:00:00+09:00",
  end: overrides.end ?? "2026-04-26T11:00:00+09:00",
  all_day: false,
  location: null,
  notes: null,
  recurring: null,
  tags: [],
  synced_at: "2026-04-26T09:00:00+09:00",
});

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("FsDayStore — manifest auto-refresh", () => {
  test("5 days created → manifest has 5 entries (sorted)", async () => {
    const dates = [
      "2026-04-26",
      "2026-04-27",
      "2026-04-28",
      "2026-04-29",
      "2026-04-30",
    ];
    for (const [i, d] of dates.entries()) {
      await store.addEvent(
        d,
        event({
          id: `evt_${String(i).padStart(2, "0")}abcdefghi123`,
          start: `${d}T10:00:00+09:00`,
          end: `${d}T11:00:00+09:00`,
        }),
      );
    }

    const manifest = await store.readManifest("2026-04");
    expect(manifest).not.toBeNull();
    expect(manifest!.month).toBe("2026-04");
    expect(manifest!.days).toHaveLength(5);
    expect(manifest!.days.map((d) => d.date)).toEqual(dates);
    for (const entry of manifest!.days) {
      expect(entry.event_count).toBe(1);
      expect(entry.placement_count).toBe(0);
      expect(entry.conflicts_open_count).toBe(0);
    }
  });

  test("deleting a day file then refreshManifest → 4 entries", async () => {
    const dates = [
      "2026-04-26",
      "2026-04-27",
      "2026-04-28",
      "2026-04-29",
      "2026-04-30",
    ];
    for (const [i, d] of dates.entries()) {
      await store.addEvent(
        d,
        event({
          id: `evt_${String(i).padStart(2, "0")}abcdefghi123`,
          start: `${d}T10:00:00+09:00`,
          end: `${d}T11:00:00+09:00`,
        }),
      );
    }

    // Simulate manual deletion (S44.6 / rebuild-index will own this).
    await unlink(store.dayPath("2026-04-28"));

    const manifest = await store.refreshManifest("2026-04");
    expect(manifest.days).toHaveLength(4);
    expect(manifest.days.map((d) => d.date)).toEqual([
      "2026-04-26",
      "2026-04-27",
      "2026-04-29",
      "2026-04-30",
    ]);

    // Reading it back from disk gives the same picture.
    const onDisk = await store.readManifest("2026-04");
    expect(onDisk!.days).toHaveLength(4);
  });

  test("refreshManifest with zero remaining days deletes the manifest file", async () => {
    await store.addEvent("2026-04-26", event());
    await unlink(store.dayPath("2026-04-26"));

    const manifest = await store.refreshManifest("2026-04");
    expect(manifest.days).toEqual([]);
    expect(await exists(store.manifestPath("2026-04"))).toBe(false);
  });

  test("readManifest returns null for a month with no manifest", async () => {
    expect(await store.readManifest("2026-04")).toBeNull();
  });

  test("manifest tracks event_count / placement_count / conflicts_open_count", async () => {
    await store.addEvent("2026-04-26", event());
    const day = await store.readDay("2026-04-26");
    day.placements.push({
      id: "plc_01abcdefghi123",
      todo_id: "todo_01abcdefghi123",
      start: "2026-04-26T13:00:00+09:00",
      end: "2026-04-26T14:00:00+09:00",
      title: "x",
      tags: [],
      importance_score: 50,
  importance_at_placement: null,
      duration_min: 60,
      placed_by: "user",
      placed_at: "2026-04-26T09:00:00+09:00",
      policy_hash: null,
      locked: false,
    });
    day.conflicts_open = ["cfl_01abcdefghi123"];
    await store.writeDay(day);

    const manifest = await store.readManifest("2026-04");
    expect(manifest).not.toBeNull();
    const entry = manifest!.days.find((d) => d.date === "2026-04-26")!;
    expect(entry.event_count).toBe(1);
    expect(entry.placement_count).toBe(1);
    expect(entry.conflicts_open_count).toBe(1);
  });
});
