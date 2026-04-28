import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeEach(async () => {
  home = await makeTmpHome();
});
afterEach(async () => {
  await cleanupHome(home);
});

const KST_NOW_8AM = "2026-04-28T08:00:00+09:00";
const KST_NOW_9AM = "2026-04-28T09:00:00+09:00";
const KST_NOW_NEXT_DAY = "2026-04-29T07:30:00+09:00";

function fixedClock(now: string): Record<string, string> {
  return { SCAFFOLD_DAY_NOW: now };
}

describe("scaffold-day morning (S60)", () => {
  test("first call records an explicit anchor at the fixed clock instant", async () => {
    await runCli(["init", "--force"], { home });
    const r = await runCli(["morning", "--json"], {
      home,
      env: fixedClock(KST_NOW_8AM),
    });
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.date).toBe("2026-04-28");
    expect(out.anchor).toBe("2026-04-28T08:00:00+09:00");
    expect(out.source).toBe("explicit");
    expect(out.was_already_set).toBe(false);
    expect(out.upgraded_from_auto).toBe(false);
    expect(out.recorded).toBe(true);

    const log = await readFile(path.join(home, "logs/heartbeats.jsonl"), "utf8");
    const lines = log.split("\n").filter((l) => l);
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.source).toBe("explicit");
    expect(entry.anchor).toBe("2026-04-28T08:00:00+09:00");
  });

  test("second call without --force is idempotent (no new line, returns existing)", async () => {
    await runCli(["init", "--force"], { home });
    await runCli(["morning"], { home, env: fixedClock(KST_NOW_8AM) });
    const r = await runCli(["morning", "--json"], {
      home,
      env: fixedClock(KST_NOW_9AM),
    });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.was_already_set).toBe(true);
    expect(out.recorded).toBe(false);
    expect(out.anchor).toBe("2026-04-28T08:00:00+09:00");

    const log = await readFile(path.join(home, "logs/heartbeats.jsonl"), "utf8");
    expect(log.split("\n").filter((l) => l).length).toBe(1);
  });

  test("--force overrides the existing anchor", async () => {
    await runCli(["init", "--force"], { home });
    await runCli(["morning"], { home, env: fixedClock(KST_NOW_8AM) });
    const r = await runCli(["morning", "--force", "--json"], {
      home,
      env: fixedClock(KST_NOW_9AM),
    });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.recorded).toBe(true);
    expect(out.was_already_set).toBe(true);
    expect(out.anchor).toBe("2026-04-28T09:00:00+09:00");
  });

  test("--at HH:MM records a manual anchor for today (in policy TZ)", async () => {
    await runCli(["init", "--force"], { home });
    const r = await runCli(["morning", "--at", "07:30", "--json"], {
      home,
      env: fixedClock(KST_NOW_8AM),
    });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.source).toBe("manual");
    expect(out.anchor).toBe("2026-04-28T07:30:00+09:00");
  });

  test("auto fallback fires on the first non-init command, then explicit silently upgrades", async () => {
    await runCli(["init", "--force"], { home });
    // First non-init command — should record auto-anchor.
    await runCli(["today", "--tz", "Asia/Seoul"], {
      home,
      env: fixedClock(KST_NOW_8AM),
    });
    const log1 = await readFile(path.join(home, "logs/heartbeats.jsonl"), "utf8");
    const entries1 = log1.split("\n").filter((l) => l).map((l) => JSON.parse(l));
    expect(entries1.length).toBe(1);
    expect(entries1[0].source).toBe("auto");

    // Now an explicit `morning` call should *upgrade* without --force.
    const r = await runCli(["morning", "--json"], {
      home,
      env: fixedClock(KST_NOW_9AM),
    });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.upgraded_from_auto).toBe(true);
    expect(out.was_already_set).toBe(false);
    expect(out.recorded).toBe(true);
    expect(out.source).toBe("explicit");

    const log2 = await readFile(path.join(home, "logs/heartbeats.jsonl"), "utf8");
    const entries2 = log2.split("\n").filter((l) => l).map((l) => JSON.parse(l));
    expect(entries2.length).toBe(2); // auto + explicit upgrade
    expect(entries2[1].source).toBe("explicit");
  });

  test("init itself does NOT trigger the auto fallback (no heartbeats.jsonl)", async () => {
    await runCli(["init", "--force"], { home, env: fixedClock(KST_NOW_8AM) });
    let exists = true;
    try {
      await stat(path.join(home, "logs/heartbeats.jsonl"));
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  test("--dry-run does not write the heartbeats file", async () => {
    await runCli(["init", "--force"], { home });
    const r = await runCli(["morning", "--dry-run", "--json"], {
      home,
      env: fixedClock(KST_NOW_8AM),
    });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.dry_run).toBe(true);
    expect(out.would.command).toBe("morning");

    let exists = true;
    try {
      await stat(path.join(home, "logs/heartbeats.jsonl"));
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  test("today displays a 'Day started' line when an anchor exists", async () => {
    await runCli(["init", "--force"], { home });
    await runCli(["morning"], { home, env: fixedClock(KST_NOW_8AM) });
    const r = await runCli(["today", "--tz", "Asia/Seoul"], {
      home,
      env: fixedClock(KST_NOW_8AM),
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Day started 08:00");
  });

  test("today --json carries the anchor field", async () => {
    await runCli(["init", "--force"], { home });
    await runCli(["morning"], { home, env: fixedClock(KST_NOW_8AM) });
    const r = await runCli(["today", "--json", "--tz", "Asia/Seoul"], {
      home,
      env: fixedClock(KST_NOW_8AM),
    });
    expect(r.exitCode).toBe(0);
    const view = JSON.parse(r.stdout);
    expect(view.anchor).not.toBeNull();
    expect(view.anchor.anchor).toBe("2026-04-28T08:00:00+09:00");
    expect(view.anchor.source).toBe("explicit");
  });

  test("doctor surfaces today's anchor (or warns when missing)", async () => {
    await runCli(["init", "--force"], { home });
    // No anchor yet → warn line.
    const r1 = await runCli(["doctor"], {
      home,
      env: fixedClock(KST_NOW_8AM),
    });
    expect(r1.stdout).toContain("Anchor");
    expect(r1.stdout).toContain("today's anchor: not set");

    // Record one → ok line with the wall-clock time.
    await runCli(["morning"], { home, env: fixedClock(KST_NOW_8AM) });
    const r2 = await runCli(["doctor"], {
      home,
      env: fixedClock(KST_NOW_8AM),
    });
    expect(r2.stdout).toContain("today's anchor: 08:00 (explicit)");
  });

  test("a fresh day re-runs auto fallback (one heartbeat per day)", async () => {
    await runCli(["init", "--force"], { home });
    await runCli(["today", "--tz", "Asia/Seoul"], {
      home,
      env: fixedClock(KST_NOW_8AM),
    });
    await runCli(["today", "--tz", "Asia/Seoul"], {
      home,
      env: fixedClock(KST_NOW_NEXT_DAY),
    });
    const log = await readFile(path.join(home, "logs/heartbeats.jsonl"), "utf8");
    const entries = log.split("\n").filter((l) => l).map((l) => JSON.parse(l));
    const dates = new Set(entries.map((e) => e.date));
    expect(dates.has("2026-04-28")).toBe(true);
    expect(dates.has("2026-04-29")).toBe(true);
  });
});
