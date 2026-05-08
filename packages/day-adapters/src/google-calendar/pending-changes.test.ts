import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  compactPendingChanges,
  PENDING_FILE,
  pendingChangesPath,
  readPendingChanges,
  recordPendingChange,
  SYNC_DIR,
} from "./pending-changes";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "scaffold-day-pending-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("pending-changes JSONL", () => {
  test("record + read round-trips entries in append order", async () => {
    await recordPendingChange(home, {
      at: "2026-05-08T10:00:00.000Z",
      kind: "create",
      event_id: "evt_first",
      external_id: null,
      snapshot: { id: "evt_first", title: "first" },
      patch: null,
    });
    await recordPendingChange(home, {
      at: "2026-05-08T10:01:00.000Z",
      kind: "update",
      event_id: "evt_second",
      external_id: "g_second",
      snapshot: null,
      patch: { title: "renamed" },
    });
    const out = await readPendingChanges(home);
    expect(out).toHaveLength(2);
    expect(out[0]!.kind).toBe("create");
    expect(out[0]!.event_id).toBe("evt_first");
    expect(out[1]!.kind).toBe("update");
    expect(out[1]!.patch).toEqual({ title: "renamed" });
  });

  test("read on a missing file returns empty array (not an error)", async () => {
    const out = await readPendingChanges(home);
    expect(out).toEqual([]);
  });

  test("attempts defaults to 0 when not provided", async () => {
    await recordPendingChange(home, {
      at: "2026-05-08T10:00:00.000Z",
      kind: "delete",
      event_id: "evt_x",
      external_id: "g_x",
      snapshot: null,
      patch: null,
    });
    const [first] = await readPendingChanges(home);
    expect(first!.attempts).toBe(0);
  });

  test("compact replaces the file atomically with given survivors", async () => {
    await recordPendingChange(home, {
      at: "2026-05-08T10:00:00.000Z",
      kind: "create",
      event_id: "evt_a",
      external_id: null,
      snapshot: { id: "evt_a" },
      patch: null,
    });
    await recordPendingChange(home, {
      at: "2026-05-08T10:01:00.000Z",
      kind: "create",
      event_id: "evt_b",
      external_id: null,
      snapshot: { id: "evt_b" },
      patch: null,
    });
    const all = await readPendingChanges(home);
    await compactPendingChanges(home, [all[1]!]);
    const after = await readPendingChanges(home);
    expect(after).toHaveLength(1);
    expect(after[0]!.event_id).toBe("evt_b");
  });

  test("compact with empty survivors deletes the file entirely", async () => {
    await recordPendingChange(home, {
      at: "2026-05-08T10:00:00.000Z",
      kind: "delete",
      event_id: "evt_only",
      external_id: "g",
      snapshot: null,
      patch: null,
    });
    await compactPendingChanges(home, []);
    const after = await readPendingChanges(home);
    expect(after).toEqual([]);
    let exists = false;
    try {
      await readFile(pendingChangesPath(home), "utf8");
      exists = true;
    } catch {
      /* expected */
    }
    expect(exists).toBe(false);
  });

  test("malformed line raises DAY_INVALID_INPUT with the bad line number", async () => {
    const target = pendingChangesPath(home);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "{ broken json\n", "utf8");
    let caught: unknown;
    try {
      await readPendingChanges(home);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect((caught as Error).message).toMatch(/line 1/);
  });

  test("path constants stay aligned with the documented layout", () => {
    const expected = path.join(home, SYNC_DIR, PENDING_FILE);
    expect(pendingChangesPath(home)).toBe(expected);
  });
});
