import { describe, expect, test } from "bun:test";
import { isScaffoldError } from "../error";
import { InMemoryTodoRepository } from "./in-memory";
import type { CreateTodoInput } from "./repository";
import { TodoSummarySchema } from "./schemas";

const baseInput: CreateTodoInput = {
  title: "  Write S7 repository  ",
  tags: ["#deep-work"],
  importance_score: 60,
  duration_min: 45,
};

describe("InMemoryTodoRepository — create + read", () => {
  test("create returns a Detail with a valid todo_ id and trimmed title", async () => {
    const repo = new InMemoryTodoRepository();
    const created = await repo.create(baseInput);
    expect(created.id).toMatch(/^todo_[a-z0-9]{14}$/);
    expect(created.title).toBe("Write S7 repository");
    expect(created.status).toBe("open");
    expect(created.history).toHaveLength(1);
    expect(created.history[0]?.kind).toBe("created");
  });

  test("create defaults nullable fields", async () => {
    const repo = new InMemoryTodoRepository();
    const created = await repo.create({ title: "minimal" });
    expect(created.tags).toEqual([]);
    expect(created.importance_score).toBeNull();
    expect(created.duration_min).toBeNull();
    expect(created.target_date).toBeNull();
    expect(created.description).toBeNull();
    expect(created.reasoning).toBeNull();
  });

  test("created Summary projection passes the Zod schema", async () => {
    const repo = new InMemoryTodoRepository();
    const created = await repo.create(baseInput);
    const summary = await repo.getSummary(created.id);
    expect(summary).not.toBeNull();
    expect(TodoSummarySchema.safeParse(summary).success).toBe(true);
  });

  test("getDetail returns a clone (mutating it does not corrupt the repo)", async () => {
    const repo = new InMemoryTodoRepository();
    const created = await repo.create(baseInput);
    const detail = await repo.getDetail(created.id);
    expect(detail).not.toBeNull();
    detail!.title = "MUTATED";
    detail!.tags.push("#leak");
    const reread = await repo.getDetail(created.id);
    expect(reread!.title).toBe("Write S7 repository");
    expect(reread!.tags).toEqual(["#deep-work"]);
  });

  test("get* returns null for unknown id", async () => {
    const repo = new InMemoryTodoRepository();
    expect(await repo.getDetail("todo_00000000000000")).toBeNull();
    expect(await repo.getSummary("todo_00000000000000")).toBeNull();
  });
});

describe("InMemoryTodoRepository — list + filter", () => {
  test("listSummaries with no filter returns every active todo", async () => {
    const repo = new InMemoryTodoRepository();
    await repo.create({ title: "a" });
    await repo.create({ title: "b" });
    await repo.create({ title: "c" });
    const summaries = await repo.listSummaries();
    expect(summaries).toHaveLength(3);
  });

  test("filter by status", async () => {
    const repo = new InMemoryTodoRepository();
    const a = await repo.create({ title: "a" });
    await repo.create({ title: "b" });
    await repo.update(a.id, { status: "in_progress" });
    const inProgress = await repo.listSummaries({ status: ["in_progress"] });
    expect(inProgress.map((s) => s.title)).toEqual(["a"]);
  });

  test("filter by tagsAny (any-of)", async () => {
    const repo = new InMemoryTodoRepository();
    await repo.create({ title: "a", tags: ["#deep-work"] });
    await repo.create({ title: "b", tags: ["#admin"] });
    await repo.create({ title: "c", tags: ["#admin", "#deep-work"] });
    const matched = await repo.listSummaries({ tagsAny: ["#admin"] });
    expect(matched.map((s) => s.title).sort()).toEqual(["b", "c"]);
  });

  test("filter by hasDeadline true/false", async () => {
    const repo = new InMemoryTodoRepository();
    await repo.create({ title: "with", tags: ["#deadline:2026-05-01"] });
    await repo.create({ title: "without", tags: [] });
    const withDeadline = await repo.listSummaries({ hasDeadline: true });
    const withoutDeadline = await repo.listSummaries({ hasDeadline: false });
    expect(withDeadline.map((s) => s.title)).toEqual(["with"]);
    expect(withoutDeadline.map((s) => s.title)).toEqual(["without"]);
  });
});

describe("InMemoryTodoRepository — update", () => {
  test("update modifies only the listed fields and appends a history entry", async () => {
    const repo = new InMemoryTodoRepository();
    const created = await repo.create(baseInput);
    const updated = await repo.update(created.id, {
      title: "renamed",
      status: "in_progress",
    });
    expect(updated.title).toBe("renamed");
    expect(updated.status).toBe("in_progress");
    expect(updated.tags).toEqual(["#deep-work"]); // untouched
    expect(updated.history).toHaveLength(2);
    const last = updated.history[1]!;
    expect(last.kind).toBe("updated");
    expect(last.patch).toEqual({ title: "renamed", status: "in_progress" });
  });

  test("explicit null clears optional fields", async () => {
    const repo = new InMemoryTodoRepository();
    const created = await repo.create({ ...baseInput, target_date: "2026-05-01" });
    const updated = await repo.update(created.id, { target_date: null });
    expect(updated.target_date).toBeNull();
    expect(updated.history[1]!.patch).toEqual({ target_date: null });
  });

  test("history_kind override + notes are recorded", async () => {
    const repo = new InMemoryTodoRepository();
    const created = await repo.create(baseInput);
    const updated = await repo.update(created.id, {
      importance_score: 90,
      history_kind: "scored",
      by: "claude-cli",
      notes: "auto-scored after intake",
    });
    const entry = updated.history.at(-1)!;
    expect(entry.kind).toBe("scored");
    expect(entry.by).toBe("claude-cli");
    expect(entry.notes).toBe("auto-scored after intake");
  });

  test("update on unknown id throws DAY_NOT_FOUND", async () => {
    const repo = new InMemoryTodoRepository();
    let caught: unknown;
    try {
      await repo.update("todo_00000000000000", { title: "x" });
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_NOT_FOUND");
  });

  test("no-op update still appends a history entry with patch=null", async () => {
    const repo = new InMemoryTodoRepository();
    const created = await repo.create(baseInput);
    const updated = await repo.update(created.id, {});
    expect(updated.history).toHaveLength(2);
    expect(updated.history[1]!.patch).toBeNull();
  });
});

describe("InMemoryTodoRepository — archive", () => {
  test("archive moves the todo from active to the YYYY-MM partition", async () => {
    const repo = new InMemoryTodoRepository();
    const created = await repo.create(baseInput);
    const archived = await repo.archive(created.id, { reason: "completed", by: "user" });
    expect(archived.archived_at).toBeTruthy();
    expect(archived.archive_reason).toBe("completed");
    expect(archived.final_status).toBe("open");
    expect(archived.history.at(-1)!.kind).toBe("archived");

    expect(await repo.getDetail(created.id)).toBeNull();
    expect(await repo.listSummaries()).toEqual([]);

    const month = archived.archived_at.slice(0, 7);
    const list = await repo.listArchive(month);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(created.id);
  });

  test("archive nonexistent throws DAY_NOT_FOUND", async () => {
    const repo = new InMemoryTodoRepository();
    let caught: unknown;
    try {
      await repo.archive("todo_00000000000000");
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_NOT_FOUND");
  });

  test("listArchive returns clones (mutation does not affect repo)", async () => {
    const repo = new InMemoryTodoRepository();
    const created = await repo.create(baseInput);
    const archived = await repo.archive(created.id);
    const month = archived.archived_at.slice(0, 7);
    const list = await repo.listArchive(month);
    list[0]!.title = "MUTATED";
    list.push({ ...list[0]!, id: "todo_aaaaaaaaaaaaaa" });
    const reread = await repo.listArchive(month);
    expect(reread).toHaveLength(1);
    expect(reread[0]!.title).toBe("Write S7 repository");
  });
});

describe("InMemoryTodoRepository — round-trip", () => {
  test("create → list → update → list → archive → listArchive", async () => {
    const repo = new InMemoryTodoRepository();
    const created = await repo.create({
      title: "round trip",
      tags: ["#deep-work", "#deadline:2026-05-01"],
      importance_score: 55,
    });

    const beforeList = await repo.listSummaries();
    expect(beforeList).toHaveLength(1);
    expect(beforeList[0]!.id).toBe(created.id);

    await repo.update(created.id, { status: "done" });
    const afterUpdate = await repo.listSummaries({ status: ["done"] });
    expect(afterUpdate).toHaveLength(1);

    const archived = await repo.archive(created.id, { reason: "shipped" });
    expect(await repo.listSummaries()).toHaveLength(0);

    const month = archived.archived_at.slice(0, 7);
    const archivesThisMonth = await repo.listArchive(month);
    expect(archivesThisMonth).toHaveLength(1);
    expect(archivesThisMonth[0]!.history.map((h) => h.kind)).toEqual([
      "created",
      "updated",
      "archived",
    ]);
  });
});
