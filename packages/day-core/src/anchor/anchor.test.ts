import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendHeartbeat,
  buildHeartbeat,
  type HeartbeatEntry,
  heartbeatsPath,
  isoWithTz,
  readAnchorForDate,
  readLatestAnchor,
  recordAnchor,
} from "./anchor";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "scaffold-day-anchor-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const fixture = (date: string, anchor: string): HeartbeatEntry => ({
  schema_version: "0.1.0",
  date,
  anchor,
  source: "explicit",
  recorded_at: anchor,
});

describe("isoWithTz", () => {
  test("renders explicit +09:00 for Asia/Seoul", () => {
    const out = isoWithTz(new Date("2026-04-28T05:30:00Z"), "Asia/Seoul");
    expect(out).toBe("2026-04-28T14:30:00+09:00");
  });

  test("renders -04:00 for America/New_York during EDT", () => {
    const out = isoWithTz(new Date("2026-07-15T16:00:00Z"), "America/New_York");
    expect(out).toBe("2026-07-15T12:00:00-04:00");
  });

  test("renders +00:00 for UTC", () => {
    const out = isoWithTz(new Date("2026-04-28T07:00:00Z"), "UTC");
    expect(out).toBe("2026-04-28T07:00:00+00:00");
  });
});

describe("buildHeartbeat", () => {
  test("derives the date key in the user's TZ, not UTC", () => {
    const at = new Date("2026-04-27T16:30:00Z"); // 2026-04-28 01:30 KST
    const e = buildHeartbeat({
      at,
      recordedAt: at,
      source: "explicit",
      tz: "Asia/Seoul",
    });
    expect(e.date).toBe("2026-04-28");
    expect(e.anchor.startsWith("2026-04-28T01:30:00+09:00")).toBe(true);
  });

  test("source flag is preserved", () => {
    const e = buildHeartbeat({
      at: new Date("2026-04-28T07:00:00Z"),
      recordedAt: new Date("2026-04-28T07:00:00Z"),
      source: "auto",
      tz: "UTC",
    });
    expect(e.source).toBe("auto");
  });
});

describe("append / read round-trip", () => {
  test("appendHeartbeat then readAnchorForDate returns it", async () => {
    const entry = fixture("2026-04-28", "2026-04-28T07:30:00+09:00");
    await appendHeartbeat(home, entry);
    const back = await readAnchorForDate(home, "2026-04-28");
    expect(back).not.toBeNull();
    expect(back!.anchor).toBe(entry.anchor);
    expect(back!.source).toBe("explicit");
  });

  test("missing file → null (no throw)", async () => {
    expect(await readAnchorForDate(home, "2026-04-28")).toBeNull();
    expect(await readLatestAnchor(home)).toBeNull();
  });

  test("the latest entry for a date wins (force overwrites)", async () => {
    await appendHeartbeat(home, fixture("2026-04-28", "2026-04-28T07:30:00+09:00"));
    await appendHeartbeat(home, {
      ...fixture("2026-04-28", "2026-04-28T08:15:00+09:00"),
      source: "manual",
    });
    const back = await readAnchorForDate(home, "2026-04-28");
    expect(back!.anchor).toBe("2026-04-28T08:15:00+09:00");
    expect(back!.source).toBe("manual");
  });

  test("readLatestAnchor returns the most recent line across dates", async () => {
    await appendHeartbeat(home, fixture("2026-04-26", "2026-04-26T07:30:00+09:00"));
    await appendHeartbeat(home, fixture("2026-04-27", "2026-04-27T07:30:00+09:00"));
    await appendHeartbeat(home, fixture("2026-04-28", "2026-04-28T07:30:00+09:00"));
    const back = await readLatestAnchor(home);
    expect(back!.date).toBe("2026-04-28");
  });

  test("corrupt trailing line is ignored", async () => {
    await appendHeartbeat(home, fixture("2026-04-28", "2026-04-28T07:30:00+09:00"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(heartbeatsPath(home), "{not json}\n", { flag: "a" });
    const back = await readAnchorForDate(home, "2026-04-28");
    expect(back).not.toBeNull();
  });
});

describe("recordAnchor (no-op vs force)", () => {
  test("first record → was_already_set=false", async () => {
    const entry = fixture("2026-04-28", "2026-04-28T07:30:00+09:00");
    const r = await recordAnchor(home, entry, { force: false });
    expect(r.was_already_set).toBe(false);
    expect(r.entry.anchor).toBe(entry.anchor);
  });

  test("second record without force → returns the existing entry, no append", async () => {
    const first = fixture("2026-04-28", "2026-04-28T07:30:00+09:00");
    await recordAnchor(home, first, { force: false });

    const second = fixture("2026-04-28", "2026-04-28T08:00:00+09:00");
    const r = await recordAnchor(home, second, { force: false });
    expect(r.was_already_set).toBe(true);
    expect(r.entry.anchor).toBe(first.anchor); // returns the one already there

    const onDisk = await readFile(heartbeatsPath(home), "utf8");
    expect(onDisk.split("\n").filter((l) => l).length).toBe(1);
  });

  test("second record WITH force → was_already_set=true but the new one is written", async () => {
    const first = fixture("2026-04-28", "2026-04-28T07:30:00+09:00");
    await recordAnchor(home, first, { force: false });

    const second = fixture("2026-04-28", "2026-04-28T08:00:00+09:00");
    const r = await recordAnchor(home, second, { force: true });
    expect(r.was_already_set).toBe(true);
    expect(r.entry.anchor).toBe(second.anchor);

    const back = await readAnchorForDate(home, "2026-04-28");
    expect(back!.anchor).toBe(second.anchor);
  });
});
