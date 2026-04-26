import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isScaffoldError } from "../error";
import { CURRENT_SCHEMA_VERSION } from "../schema/version";
import { type Day, DaySchema } from "./day";
import { FixedEventSchema, type FixedEvent } from "./event";
import { FsDayStore } from "./fs-day-store";
import { type Placement, PlacementSchema } from "./placement";

let home: string;
let store: FsDayStore;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "scaffold-day-day-"));
  store = new FsDayStore(home);
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const sampleEvent: FixedEvent = {
  id: "evt_01abcdefghi123",
  source: "manual",
  external_id: null,
  title: "1:1 with X",
  start: "2026-04-26T10:00:00+09:00",
  end: "2026-04-26T11:00:00+09:00",
  all_day: false,
  location: "Zoom",
  notes: null,
  recurring: null,
  tags: ["#meeting"],
  synced_at: "2026-04-26T09:00:00+09:00",
};

const samplePlacement: Placement = {
  id: "plc_01abcdefghi123",
  todo_id: "todo_01abcdefghi123",
  start: "2026-04-26T13:00:00+09:00",
  end: "2026-04-26T14:00:00+09:00",
  title: "draft S9",
  tags: ["#deep-work"],
  importance_score: 70,
  duration_min: 60,
  placed_by: "user",
  placed_at: "2026-04-26T09:00:00+09:00",
  policy_hash: null,
  locked: false,
};

describe("FixedEventSchema", () => {
  test("accepts the sample event", () => {
    expect(FixedEventSchema.safeParse(sampleEvent).success).toBe(true);
  });

  test("rejects wrong id prefix", () => {
    expect(
      FixedEventSchema.safeParse({ ...sampleEvent, id: "todo_01abcdefghi123" }).success,
    ).toBe(false);
  });

  test("rejects empty title", () => {
    expect(FixedEventSchema.safeParse({ ...sampleEvent, title: "" }).success).toBe(false);
  });

  test("rejects unknown source", () => {
    expect(
      FixedEventSchema.safeParse({ ...sampleEvent, source: "outlook" as never }).success,
    ).toBe(false);
  });

  test("recurring may be null or {parent_id, rrule}", () => {
    const withRule = {
      ...sampleEvent,
      recurring: { parent_id: "evt_99999999999999", rrule: "FREQ=WEEKLY" },
    };
    expect(FixedEventSchema.safeParse(withRule).success).toBe(true);
  });
});

describe("PlacementSchema", () => {
  test("accepts the sample placement", () => {
    expect(PlacementSchema.safeParse(samplePlacement).success).toBe(true);
  });
  test("rejects wrong id prefix", () => {
    expect(
      PlacementSchema.safeParse({ ...samplePlacement, id: "evt_01abcdefghi123" }).success,
    ).toBe(false);
  });
});

describe("DaySchema", () => {
  test("default empty arrays for events/placements/conflicts_open", () => {
    const parsed = DaySchema.safeParse({
      schema_version: "0.1.0",
      date: "2026-04-26",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.events).toEqual([]);
      expect(parsed.data.placements).toEqual([]);
      expect(parsed.data.conflicts_open).toEqual([]);
    }
  });

  test("rejects malformed date", () => {
    expect(
      DaySchema.safeParse({ schema_version: "0.1.0", date: "2026/04/26" }).success,
    ).toBe(false);
  });
});

describe("FsDayStore — read/write round trip", () => {
  test("readDay returns an empty Day for a non-existent file", async () => {
    const day = await store.readDay("2026-04-26");
    expect(day.events).toEqual([]);
    expect(day.placements).toEqual([]);
    expect(day.schema_version).toBe(CURRENT_SCHEMA_VERSION);
  });

  test("addEvent creates the day file under days/YYYY-MM/YYYY-MM-DD.json", async () => {
    const day = await store.addEvent("2026-04-26", sampleEvent);
    expect(day.events).toHaveLength(1);

    const onDisk = JSON.parse(await readFile(store.dayPath("2026-04-26"), "utf8")) as Day;
    expect(onDisk.events[0]?.id).toBe(sampleEvent.id);
    expect(onDisk.date).toBe("2026-04-26");
  });

  test("adding two events on the same day appends, not overwrites", async () => {
    await store.addEvent("2026-04-26", sampleEvent);
    const second: FixedEvent = {
      ...sampleEvent,
      id: "evt_02zzzzzzzzzzzz",
      title: "second",
    };
    const day = await store.addEvent("2026-04-26", second);

    expect(day.events.map((e) => e.id)).toEqual([sampleEvent.id, second.id]);
  });

  test("addPlacement appends placements", async () => {
    const day = await store.addPlacement("2026-04-26", samplePlacement);
    expect(day.placements).toHaveLength(1);
    expect(day.placements[0]?.id).toBe(samplePlacement.id);
  });

  test("listMonth returns dates sorted", async () => {
    await store.addEvent("2026-04-30", sampleEvent);
    await store.addEvent("2026-04-26", sampleEvent);
    await store.addEvent("2026-04-28", sampleEvent);
    const list = await store.listMonth("2026-04");
    expect(list).toEqual(["2026-04-26", "2026-04-28", "2026-04-30"]);
  });

  test("listMonths returns YYYY-MM partitions sorted", async () => {
    await store.addEvent("2026-04-26", sampleEvent);
    await store.addEvent("2026-05-01", sampleEvent);
    expect(await store.listMonths()).toEqual(["2026-04", "2026-05"]);
  });

  test("readDay rejects malformed dates with DAY_INVALID_INPUT", async () => {
    let caught: unknown;
    try {
      await store.readDay("2026/04/26");
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_INVALID_INPUT");
  });

  test("writeDay refuses an invalid Day", async () => {
    let caught: unknown;
    try {
      await store.writeDay({
        schema_version: "0.1.0",
        date: "2026-04-26",
        events: [{ ...sampleEvent, title: "" } as FixedEvent],
        placements: [],
        conflicts_open: [],
      });
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_INVALID_INPUT");
  });

  test("malformed day file surfaces DAY_INVALID_INPUT", async () => {
    await store.addEvent("2026-04-26", sampleEvent);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(store.dayPath("2026-04-26"), JSON.stringify({ wrong: "shape" }), "utf8");
    let caught: unknown;
    try {
      await store.readDay("2026-04-26");
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_INVALID_INPUT");
  });
});
