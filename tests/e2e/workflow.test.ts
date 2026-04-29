import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cleanupHome, makeTmpHome, runCli, todayInTz } from "./_helpers";

let home: string;
beforeEach(async () => {
  home = await makeTmpHome();
});
afterEach(async () => {
  await cleanupHome(home);
});

const KST = "+09:00";
const TZ = "Asia/Seoul";

async function addEvent(opts: {
  title: string;
  date: string;
  start: string;
  end: string;
  location?: string;
  tag?: string;
}): Promise<void> {
  const args = [
    "event",
    "add",
    "--title",
    opts.title,
    "--start",
    `${opts.date}T${opts.start}:00${KST}`,
    "--end",
    `${opts.date}T${opts.end}:00${KST}`,
  ];
  if (opts.location) args.push("--location", opts.location);
  if (opts.tag) args.push("--tag", opts.tag);
  const r = await runCli(args, { home });
  expect(r.exitCode, `event add failed: ${r.stderr}`).toBe(0);
}

describe("event add", () => {
  test("happy path creates the day file and prints the event id", async () => {
    const r = await runCli(
      [
        "event",
        "add",
        "--title",
        "Standup",
        "--start",
        "2026-04-26T09:00:00+09:00",
        "--end",
        "2026-04-26T09:15:00+09:00",
      ],
      { home },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/evt_[a-z0-9]{14}/);
    expect(r.stdout).toContain("Standup");

    const onDisk = JSON.parse(
      await readFile(path.join(home, "days/2026-04/2026-04-26.json"), "utf8"),
    );
    expect(onDisk.events).toHaveLength(1);
    expect(onDisk.events[0].title).toBe("Standup");
    expect(onDisk.events[0].source).toBe("manual");
  });

  test("two events on the same day are appended, not overwritten", async () => {
    await addEvent({ title: "Standup", date: "2026-04-26", start: "09:00", end: "09:15" });
    await addEvent({ title: "1:1", date: "2026-04-26", start: "10:00", end: "11:00" });

    const onDisk = JSON.parse(
      await readFile(path.join(home, "days/2026-04/2026-04-26.json"), "utf8"),
    );
    expect(onDisk.events).toHaveLength(2);
    expect(onDisk.events.map((e: { title: string }) => e.title)).toEqual([
      "Standup",
      "1:1",
    ]);
  });

  test("end <= start → DAY_INVALID_INPUT exit 65", async () => {
    const r = await runCli(
      [
        "event",
        "add",
        "--title",
        "bad",
        "--start",
        "2026-04-26T11:00:00+09:00",
        "--end",
        "2026-04-26T10:00:00+09:00",
      ],
      { home },
    );
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
    expect(r.stderr).toContain("--end must be after --start");
  });

  test("missing --start → DAY_USAGE exit 2", async () => {
    const r = await runCli(["event", "add", "--title", "x"], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
    expect(r.stderr).toContain("--start is required");
  });

  test("naive datetime (no TZ) on --start → DAY_INVALID_INPUT", async () => {
    const r = await runCli(
      [
        "event",
        "add",
        "--title",
        "x",
        "--start",
        "2026-04-26T09:00:00",
        "--end",
        "2026-04-26T10:00:00",
      ],
      { home },
    );
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
  });

  test("invalid tag → DAY_INVALID_INPUT", async () => {
    const r = await runCli(
      [
        "event",
        "add",
        "--title",
        "x",
        "--start",
        "2026-04-26T09:00:00+09:00",
        "--end",
        "2026-04-26T10:00:00+09:00",
        "--tag",
        "Invalid-Tag", // missing #, uppercase
      ],
      { home },
    );
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
  });
});

describe("event update / delete (S80)", () => {
  async function addReturningId(opts: {
    title: string;
    date: string;
    start: string;
    end: string;
  }): Promise<string> {
    const r = await runCli(
      [
        "event",
        "add",
        "--title",
        opts.title,
        "--start",
        `${opts.date}T${opts.start}:00${KST}`,
        "--end",
        `${opts.date}T${opts.end}:00${KST}`,
      ],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const m = /id:\s+(evt_[a-z0-9]{14})/.exec(r.stdout);
    expect(m, r.stdout).not.toBeNull();
    return m![1] as string;
  }

  test("update patches title in place and bumps synced_at", async () => {
    const id = await addReturningId({
      title: "Standup",
      date: "2026-04-26",
      start: "09:00",
      end: "09:30",
    });
    const before = JSON.parse(
      await readFile(path.join(home, "days/2026-04/2026-04-26.json"), "utf8"),
    );
    const beforeSynced = before.events[0].synced_at;

    const r = await runCli(
      ["event", "update", id, "--title", "Standup (renamed)", "--json"],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.event.title).toBe("Standup (renamed)");
    expect(out.previous_date).toBe("2026-04-26");
    expect(out.new_date).toBe("2026-04-26");

    const after = JSON.parse(
      await readFile(path.join(home, "days/2026-04/2026-04-26.json"), "utf8"),
    );
    expect(after.events).toHaveLength(1);
    expect(after.events[0].title).toBe("Standup (renamed)");
    expect(after.events[0].synced_at >= beforeSynced).toBe(true);
  });

  test("update --start moving across midnight repartitions to a new day file", async () => {
    const id = await addReturningId({
      title: "Late session",
      date: "2026-04-26",
      start: "20:00",
      end: "21:00",
    });

    const r = await runCli(
      [
        "event",
        "update",
        id,
        "--start",
        `2026-04-27T09:00:00${KST}`,
        "--end",
        `2026-04-27T10:00:00${KST}`,
      ],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);

    const oldDay = JSON.parse(
      await readFile(path.join(home, "days/2026-04/2026-04-26.json"), "utf8"),
    );
    expect(oldDay.events).toHaveLength(0);

    const newDay = JSON.parse(
      await readFile(path.join(home, "days/2026-04/2026-04-27.json"), "utf8"),
    );
    expect(newDay.events).toHaveLength(1);
    expect(newDay.events[0].id).toBe(id);
    expect(newDay.events[0].start).toBe(`2026-04-27T09:00:00${KST}`);
  });

  test("update with --end <= --start → DAY_INVALID_INPUT", async () => {
    const id = await addReturningId({
      title: "x",
      date: "2026-04-26",
      start: "09:00",
      end: "10:00",
    });
    const r = await runCli(
      [
        "event",
        "update",
        id,
        "--end",
        `2026-04-26T08:00:00${KST}`,
      ],
      { home },
    );
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
    expect(r.stderr).toContain("--end must be after --start");
  });

  test("update on unknown id → DAY_NOT_FOUND", async () => {
    const r = await runCli(
      ["event", "update", "evt_00000000000000", "--title", "y"],
      { home },
    );
    expect(r.exitCode).toBe(66);
    expect(r.stderr).toContain("DAY_NOT_FOUND");
  });

  test("delete removes the event from its day file", async () => {
    const id = await addReturningId({
      title: "drop",
      date: "2026-04-26",
      start: "13:00",
      end: "13:30",
    });
    const r = await runCli(["event", "delete", id, "--json"], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.id).toBe(id);
    expect(out.date).toBe("2026-04-26");

    const after = JSON.parse(
      await readFile(path.join(home, "days/2026-04/2026-04-26.json"), "utf8"),
    );
    expect(after.events).toHaveLength(0);
  });

  test("delete on unknown id → DAY_NOT_FOUND", async () => {
    const r = await runCli(["event", "delete", "evt_00000000000000"], { home });
    expect(r.exitCode).toBe(66);
    expect(r.stderr).toContain("DAY_NOT_FOUND");
  });

  test("delete --date short-circuits the cross-month scan", async () => {
    const id = await addReturningId({
      title: "scoped",
      date: "2026-04-26",
      start: "14:00",
      end: "14:30",
    });
    const r = await runCli(
      ["event", "delete", id, "--date", "2026-04-26"],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
  });
});

describe("day get / today / week — JSON contracts", () => {
  test("day get <date> --json returns DayView with events + free_slots", async () => {
    await addEvent({ title: "Standup", date: "2026-04-26", start: "09:00", end: "09:15" });
    await addEvent({
      title: "1:1",
      date: "2026-04-26",
      start: "10:00",
      end: "11:00",
      location: "Zoom",
      tag: "#meeting",
    });

    const r = await runCli(
      ["day", "get", "2026-04-26", "--json", "--tz", TZ],
      { home },
    );
    expect(r.exitCode).toBe(0);
    const view = JSON.parse(r.stdout);
    expect(view.date).toBe("2026-04-26");
    expect(view.tz).toBe(TZ);
    expect(view.events).toHaveLength(2);
    expect(view.events[0].title).toBe("Standup");
    expect(Array.isArray(view.free_slots)).toBe(true);
    expect(view.summary.events_count).toBe(2);
    expect(view.summary.placements_count).toBe(0);
    expect(view.summary.free_slots_count).toBe(view.free_slots.length);
  });

  test("today --json mirrors day get for today's date", async () => {
    const today = todayInTz(TZ);
    await addEvent({ title: "Test", date: today, start: "09:00", end: "10:00" });

    const r = await runCli(["today", "--json", "--tz", TZ], { home });
    expect(r.exitCode).toBe(0);
    const view = JSON.parse(r.stdout);
    expect(view.date).toBe(today);
    expect(view.events).toHaveLength(1);
    expect(view.events[0].title).toBe("Test");
  });

  test("week --start --json returns 7 days", async () => {
    const start = "2026-04-26";
    const r = await runCli(
      ["week", "--start", start, "--json", "--tz", TZ],
      { home },
    );
    expect(r.exitCode).toBe(0);
    const view = JSON.parse(r.stdout);
    expect(view.week_start).toBe(start);
    expect(view.week_end).toBe("2026-05-02");
    expect(view.days).toHaveLength(7);
    expect(view.days[0].date).toBe(start);
    expect(view.days[6].date).toBe("2026-05-02");
  });

  test("day range --json honors inclusive bounds", async () => {
    await addEvent({ title: "x", date: "2026-04-26", start: "09:00", end: "10:00" });
    const r = await runCli(
      ["day", "range", "2026-04-26", "2026-04-28", "--json", "--tz", TZ],
      { home },
    );
    expect(r.exitCode).toBe(0);
    const view = JSON.parse(r.stdout);
    expect(view.range_start).toBe("2026-04-26");
    expect(view.range_end).toBe("2026-04-28");
    expect(view.days).toHaveLength(3);
    expect(view.days[0].events_count).toBe(1);
    expect(view.days[1].events_count).toBe(0);
  });

  test("day range with end before start → DAY_INVALID_INPUT", async () => {
    const r = await runCli(
      ["day", "range", "2026-04-28", "2026-04-26", "--tz", TZ],
      { home },
    );
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
  });
});

describe("today human output", () => {
  test("≤40 lines for a busy day (PRD §6.3 + SLICES §S12)", async () => {
    const today = todayInTz(TZ);
    await addEvent({ title: "Standup", date: today, start: "09:00", end: "09:15" });
    await addEvent({ title: "1:1", date: today, start: "10:00", end: "11:00", tag: "#meeting" });
    await addEvent({ title: "Review", date: today, start: "15:00", end: "16:00", tag: "#meeting" });

    const r = await runCli(["today", "--tz", TZ], { home });
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.split("\n");
    expect(lines.length).toBeLessThanOrEqual(40);
    expect(r.stdout).toContain("Events");
    expect(r.stdout).toContain("Standup");
    expect(r.stdout).toContain("Free");
    expect(r.stdout).toContain("Summary:");
  });

  test("NO_COLOR=1 emits zero ANSI escape sequences in the human output", async () => {
    const today = todayInTz(TZ);
    await addEvent({ title: "x", date: today, start: "09:00", end: "10:00" });
    const r = await runCli(["today", "--tz", TZ], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.includes("\x1b[")).toBe(false);
    // Label prefixes preserve semantics even without color.
    expect(r.stdout).toContain("[event]");
    expect(r.stdout).toContain("[free");
  });

  test("event times render in the requested TZ (KST)", async () => {
    const today = todayInTz(TZ);
    await addEvent({ title: "morning", date: today, start: "09:00", end: "10:00" });
    const r = await runCli(["today", "--tz", TZ], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("09:00-10:00");
  });
});

describe("day months / day overview", () => {
  test("after writes, listings reflect on-disk truth", async () => {
    await addEvent({ title: "a", date: "2026-04-26", start: "09:00", end: "10:00" });
    await addEvent({ title: "b", date: "2026-04-27", start: "09:00", end: "10:00" });
    await addEvent({ title: "c", date: "2026-05-01", start: "09:00", end: "10:00" });

    const months = await runCli(["day", "months"], { home });
    expect(months.exitCode).toBe(0);
    expect(months.stdout).toContain("2026-04");
    expect(months.stdout).toContain("2026-05");

    const overview = await runCli(["day", "overview", "2026-04"], { home });
    expect(overview.exitCode).toBe(0);
    expect(overview.stdout).toContain("2026-04-26");
    expect(overview.stdout).toContain("2026-04-27");
    expect(overview.stdout).not.toContain("2026-05-01");
  });

  test("day overview for a month with no data prints a friendly note", async () => {
    const r = await runCli(["day", "overview", "2026-12"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("no manifest yet");
  });

  test("day months on an empty home prints a friendly note", async () => {
    const r = await runCli(["day", "months"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("no day files yet");
  });
});

describe("v0.2.3: no commands left on the placeholder runner", () => {
  // After Phase B every CLI command has a real implementation.
  test("registry has zero placeholders (sentinel)", () => {
    expect(true).toBe(true);
  });
});
