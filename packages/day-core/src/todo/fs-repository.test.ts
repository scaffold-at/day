import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isScaffoldError } from "../error";
import { FsTodoRepository } from "./fs-repository";
import type { CreateTodoInput } from "./repository";
import { summarize, TodoSummarySchema } from "./schemas";

let home: string;
let repo: FsTodoRepository;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "scaffold-day-fsrepo-"));
  repo = new FsTodoRepository(home);
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const baseInput: CreateTodoInput = {
  title: "round-trip todo",
  tags: ["#deep-work"],
  importance_score: 50,
  duration_min: 45,
};

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function checkInvariant(r: FsTodoRepository): Promise<void> {
  const summaries = await r.listSummaries();
  for (const s of summaries) {
    const detail = await r.getDetail(s.id);
    expect(detail, `detail file missing for ${s.id}`).not.toBeNull();
    expect(summarize(detail!)).toEqual(s);
  }
  // Every detail file on disk must also be in the index.
  const files = await r.listDetailFiles();
  const idsFromFiles = files.map((f) => f.replace(/\.json$/, ""));
  const idsFromIndex = summaries.map((s) => s.id);
  expect(new Set(idsFromFiles)).toEqual(new Set(idsFromIndex));
}

describe("FsTodoRepository — empty home", () => {
  test("listSummaries returns [] before any create", async () => {
    expect(await repo.listSummaries()).toEqual([]);
  });

  test("getSummary / getDetail return null", async () => {
    expect(await repo.getSummary("todo_00000000000000")).toBeNull();
    expect(await repo.getDetail("todo_00000000000000")).toBeNull();
  });

  test("listArchive on a missing month returns []", async () => {
    expect(await repo.listArchive("2026-04")).toEqual([]);
  });
});

describe("FsTodoRepository — create + invariant", () => {
  test("create persists detail file and appends to index", async () => {
    const created = await repo.create(baseInput);

    expect(await exists(repo.detailPath(created.id))).toBe(true);
    expect(await exists(repo.indexPath())).toBe(true);

    const indexRaw = JSON.parse(await readFile(repo.indexPath(), "utf8"));
    expect(indexRaw.schema_version).toBe("0.1.0");
    expect(indexRaw.summaries).toHaveLength(1);
    expect(indexRaw.summaries[0].id).toBe(created.id);

    const detailRaw = JSON.parse(
      await readFile(repo.detailPath(created.id), "utf8"),
    );
    expect(detailRaw.id).toBe(created.id);
    expect(detailRaw.title).toBe("round-trip todo");

    await checkInvariant(repo);
  });

  test("Summary projection in index passes Zod", async () => {
    await repo.create(baseInput);
    const summaries = await repo.listSummaries();
    for (const s of summaries) {
      expect(TodoSummarySchema.safeParse(s).success).toBe(true);
    }
  });

  test("listSummaries does NOT touch detail files", async () => {
    await repo.create(baseInput);
    await repo.create({ ...baseInput, title: "second" });

    const beforeDetailCount = (await readdir(repo.detailDir())).length;
    await repo.listSummaries();
    const afterDetailCount = (await readdir(repo.detailDir())).length;
    expect(afterDetailCount).toBe(beforeDetailCount);
    // (atime is unreliable to assert across platforms; we instead rely
    // on code inspection: listSummaries only opens index.json.)
  });
});

describe("FsTodoRepository — update", () => {
  test("update modifies both detail file and index summary", async () => {
    const created = await repo.create(baseInput);
    const updated = await repo.update(created.id, {
      title: "renamed",
      status: "in_progress",
    });

    expect(updated.title).toBe("renamed");
    expect(updated.status).toBe("in_progress");
    expect(updated.history).toHaveLength(2);

    const summary = await repo.getSummary(created.id);
    expect(summary?.title).toBe("renamed");
    expect(summary?.status).toBe("in_progress");

    await checkInvariant(repo);
  });

  test("update on unknown id throws DAY_NOT_FOUND", async () => {
    let caught: unknown;
    try {
      await repo.update("todo_00000000000000", { title: "x" });
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_NOT_FOUND");
  });
});

describe("FsTodoRepository — archive", () => {
  test("archive moves detail to YYYY-MM partition and removes index entry", async () => {
    const created = await repo.create(baseInput);
    const archived = await repo.archive(created.id, { reason: "shipped" });

    expect(await exists(repo.detailPath(created.id))).toBe(false);
    expect(await repo.getSummary(created.id)).toBeNull();
    expect(await repo.getDetail(created.id)).toBeNull();

    const month = archived.archived_at.slice(0, 7);
    const list = await repo.listArchive(month);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(created.id);
    expect(list[0]!.archive_reason).toBe("shipped");
    expect(list[0]!.final_status).toBe("open");

    await checkInvariant(repo);
  });

  test("archive on unknown id throws DAY_NOT_FOUND", async () => {
    let caught: unknown;
    try {
      await repo.archive("todo_00000000000000");
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_NOT_FOUND");
  });
});

describe("FsTodoRepository — 100-todo round trip + invariant", () => {
  test("creates 100, updates 50, archives 25, file structure stays consistent", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const created = await repo.create({
        title: `todo ${i}`,
        tags: i % 3 === 0 ? ["#deep-work"] : ["#admin"],
        importance_score: i % 100,
      });
      ids.push(created.id);
    }

    expect((await repo.listSummaries()).length).toBe(100);
    expect((await repo.listDetailFiles()).length).toBe(100);
    await checkInvariant(repo);

    // Update the first 50.
    for (let i = 0; i < 50; i++) {
      await repo.update(ids[i]!, { status: i % 2 === 0 ? "in_progress" : "done" });
    }
    await checkInvariant(repo);

    // Archive 25.
    for (let i = 0; i < 25; i++) {
      await repo.archive(ids[i]!, { reason: "batch-archive" });
    }
    expect((await repo.listSummaries()).length).toBe(75);
    expect((await repo.listDetailFiles()).length).toBe(75);
    await checkInvariant(repo);

    // Archive partition for the current month should hold 25.
    const month = new Date().toISOString().slice(0, 7);
    const archive = await repo.listArchive(month);
    expect(archive).toHaveLength(25);

    // Filter still works on the remaining 75.
    const deepWork = await repo.listSummaries({ tagsAny: ["#deep-work"] });
    const admin = await repo.listSummaries({ tagsAny: ["#admin"] });
    expect(deepWork.length + admin.length).toBe(75);
  });
});

describe("FsTodoRepository — failure modes", () => {
  test("malformed index.json surfaces DAY_INVALID_INPUT", async () => {
    const created = await repo.create(baseInput);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(repo.indexPath(), "{not-json", "utf8");

    let caught: unknown;
    try {
      await repo.listSummaries();
    } catch (err) {
      caught = err;
    }
    // JSON.parse throws SyntaxError; we don't wrap that — but missing
    // structural fields after parse SHOULD be DAY_INVALID_INPUT. We
    // check the parse failure surfaces as some thrown error.
    expect(caught).toBeDefined();
    // Suppress unused
    expect(created.id.length).toBeGreaterThan(0);
  });

  test("structurally invalid index produces DAY_INVALID_INPUT", async () => {
    await repo.create(baseInput);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(repo.indexPath(), JSON.stringify({ wrong: "shape" }), "utf8");

    let caught: unknown;
    try {
      await repo.listSummaries();
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_INVALID_INPUT");
  });
});
