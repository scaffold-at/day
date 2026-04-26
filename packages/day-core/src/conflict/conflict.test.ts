import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Day, FixedEvent, Placement } from "../day";
import { BALANCED_PRESET } from "../policy";
import {
  type ConflictPartitionFile,
  detectConflicts,
  readConflicts,
  syncConflicts,
  writeConflicts,
} from "./index";

const TZ = "+09:00";
const DATE = "2026-04-27"; // Monday in 2026
const at = (hhmm: string) => `${DATE}T${hhmm}:00${TZ}`;

const event = (start: string, end: string, title = "x", tags: string[] = []): FixedEvent => ({
  id: "evt_01abcdefghi100",
  source: "manual",
  external_id: null,
  title,
  start: at(start),
  end: at(end),
  all_day: false,
  location: null,
  notes: null,
  recurring: null,
  tags,
  synced_at: at("00:00"),
});

const placement = (
  id: string,
  start: string,
  end: string,
  duration_min = 30,
  tags: string[] = [],
): Placement => ({
  id,
  todo_id: "todo_01abcdefghi100",
  start: at(start),
  end: at(end),
  title: "x",
  tags,
  importance_score: 50,
  importance_at_placement: null,
  duration_min,
  placed_by: "user",
  placed_at: at("00:00"),
  policy_hash: null,
  locked: false,
});

const dayOf = (placements: Placement[] = [], events: FixedEvent[] = []): Day => ({
  schema_version: "0.1.0",
  date: DATE,
  events,
  placements,
  conflicts_open: [],
});

describe("detectConflicts — 3 acceptance scenarios", () => {
  test("scenario A — overlap (placement ↔ placement)", () => {
    const day = dayOf([
      placement("plc_aaaaaaaaaaaaaa", "10:00", "11:00", 60),
      placement("plc_bbbbbbbbbbbbbb", "10:30", "11:30", 60),
    ]);
    const conflicts = detectConflicts(day, BALANCED_PRESET);
    const overlaps = conflicts.filter((c) => c.kind === "overlap");
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.party_ids.sort()).toEqual([
      "plc_aaaaaaaaaaaaaa",
      "plc_bbbbbbbbbbbbbb",
    ]);
  });

  test("scenario B — hard_rule_violation (no_placement_in 22-07)", () => {
    const day = dayOf([
      placement("plc_aaaaaaaaaaaaaa", "23:00", "23:30", 30),
    ]);
    const conflicts = detectConflicts(day, BALANCED_PRESET);
    const hard = conflicts.filter((c) => c.kind === "hard_rule_violation");
    expect(hard).toHaveLength(1);
    expect(hard[0]!.hard_rule_kind).toBe("no_placement_in");
  });

  test("scenario C — buffer_breach (10-min buffer around meeting)", () => {
    const day = dayOf(
      [placement("plc_aaaaaaaaaaaaaa", "09:55", "10:00", 5)],
      [event("10:00", "11:00", "meeting")],
    );
    const conflicts = detectConflicts(day, BALANCED_PRESET);
    const buf = conflicts.filter((c) => c.kind === "buffer_breach");
    expect(buf).toHaveLength(1);
    expect(buf[0]!.hard_rule_kind).toBe("min_buffer_around_meeting_min");
  });

  test("capacity_exceeded fires when total > duration_cap_per_day_min", () => {
    const policy = {
      ...BALANCED_PRESET,
      hard_rules: [
        ...BALANCED_PRESET.hard_rules,
        { kind: "duration_cap_per_day_min" as const, minutes: 60 },
      ],
    };
    const day = dayOf([
      placement("plc_aaaaaaaaaaaaaa", "10:00", "10:30", 30),
      placement("plc_bbbbbbbbbbbbbb", "11:00", "11:30", 30),
      placement("plc_cccccccccccccc", "13:00", "13:30", 30),
    ]);
    const conflicts = detectConflicts(day, policy);
    const cap = conflicts.filter((c) => c.kind === "capacity_exceeded");
    expect(cap).toHaveLength(1);
    expect(cap[0]!.party_ids).toHaveLength(3);
  });
});

describe("syncConflicts — open ↔ resolved transitions", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "scaffold-day-conflict-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  test("first sync writes open conflicts and returns their ids", async () => {
    const day = dayOf([
      placement("plc_aaaaaaaaaaaaaa", "10:00", "11:00", 60),
      placement("plc_bbbbbbbbbbbbbb", "10:30", "11:30", 60),
    ]);
    const detected = detectConflicts(day, BALANCED_PRESET);
    const { openIdsForDate } = await syncConflicts(home, DATE, detected);
    expect(openIdsForDate).toHaveLength(1);

    const partition = await readConflicts(home, "2026-04");
    expect(partition.conflicts).toHaveLength(1);
    expect(partition.conflicts[0]!.status).toBe("open");
  });

  test("second sync without the same conflict auto-resolves it", async () => {
    // First sync: create one open conflict.
    const day1 = dayOf([
      placement("plc_aaaaaaaaaaaaaa", "10:00", "11:00", 60),
      placement("plc_bbbbbbbbbbbbbb", "10:30", "11:30", 60),
    ]);
    await syncConflicts(home, DATE, detectConflicts(day1, BALANCED_PRESET));

    // Second sync: no conflicts (placements no longer overlap).
    const day2 = dayOf([
      placement("plc_aaaaaaaaaaaaaa", "10:00", "11:00", 60),
      placement("plc_bbbbbbbbbbbbbb", "12:00", "13:00", 60),
    ]);
    const { openIdsForDate } = await syncConflicts(
      home,
      DATE,
      detectConflicts(day2, BALANCED_PRESET),
    );
    expect(openIdsForDate).toHaveLength(0);

    const partition = await readConflicts(home, "2026-04");
    expect(partition.conflicts).toHaveLength(1);
    expect(partition.conflicts[0]!.status).toBe("resolved");
    expect(partition.conflicts[0]!.resolved_by).toBe("auto");
  });

  test("read/write round-trips a partition", async () => {
    const detected = detectConflicts(
      dayOf([
        placement("plc_aaaaaaaaaaaaaa", "10:00", "11:00", 60),
        placement("plc_bbbbbbbbbbbbbb", "10:30", "11:30", 60),
      ]),
      BALANCED_PRESET,
    );
    const partition: ConflictPartitionFile = {
      schema_version: "0.1.0",
      month: "2026-04",
      conflicts: detected,
    };
    await writeConflicts(home, partition);
    const back = await readConflicts(home, "2026-04");
    expect(back.conflicts).toHaveLength(detected.length);
  });
});
