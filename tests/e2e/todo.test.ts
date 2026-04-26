import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeEach(async () => {
  home = await makeTmpHome();
});
afterEach(async () => {
  await cleanupHome(home);
});

async function addBasic(title = "Write S17"): Promise<string> {
  const r = await runCli(
    ["todo", "add", "--title", title, "--tag", "#deep-work", "--target-date", "2026-05-01"],
    { home },
  );
  expect(r.exitCode, r.stderr).toBe(0);
  const m = /id:\s+(todo_[a-z0-9]{14})/.exec(r.stdout);
  expect(m).not.toBeNull();
  return m![1] as string;
}

describe("todo add / list / get", () => {
  test("add → list shows it; get prints details", async () => {
    const id = await addBasic();

    const list = await runCli(["todo", "list", "--json"], { home });
    expect(list.exitCode).toBe(0);
    const items = JSON.parse(list.stdout).items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(id);
    expect(items[0].title).toBe("Write S17");
    expect(items[0].importance_score).toBeNull();

    const get = await runCli(["todo", "get", id], { home });
    expect(get.exitCode).toBe(0);
    expect(get.stdout).toContain("Write S17");
    expect(get.stdout).toContain("#deep-work");
  });

  test("list filters by status / tag / has-deadline", async () => {
    await runCli(["todo", "add", "--title", "A"], { home });
    await runCli(["todo", "add", "--title", "B", "--tag", "#admin"], { home });
    await runCli(
      ["todo", "add", "--title", "C", "--tag", "#deadline:2026-05-01"],
      { home },
    );

    const admin = JSON.parse(
      (await runCli(["todo", "list", "--tag", "#admin", "--json"], { home })).stdout,
    );
    expect(admin.items.map((s: { title: string }) => s.title)).toEqual(["B"]);

    const deadlines = JSON.parse(
      (await runCli(["todo", "list", "--has-deadline", "--json"], { home })).stdout,
    );
    expect(deadlines.items.map((s: { title: string }) => s.title)).toEqual(["C"]);

    const noDeadlines = JSON.parse(
      (await runCli(["todo", "list", "--no-deadline", "--json"], { home })).stdout,
    );
    expect(noDeadlines.items.map((s: { title: string }) => s.title).sort()).toEqual([
      "A",
      "B",
    ]);
  });

  test("add without --title → DAY_USAGE", async () => {
    const r = await runCli(["todo", "add"], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
    expect(r.stderr).toContain("--title");
  });

  test("get unknown id → DAY_NOT_FOUND", async () => {
    const r = await runCli(["todo", "get", "todo_00000000000000"], { home });
    expect(r.exitCode).toBe(66);
    expect(r.stderr).toContain("DAY_NOT_FOUND");
  });
});

describe("todo update / archive", () => {
  test("update modifies status and adds a history entry", async () => {
    const id = await addBasic();
    const r = await runCli(["todo", "update", id, "--status", "in_progress"], { home });
    expect(r.exitCode).toBe(0);

    const get = await runCli(["todo", "get", id, "--json"], { home });
    const detail = JSON.parse(get.stdout);
    expect(detail.status).toBe("in_progress");
    expect(detail.history.length).toBeGreaterThanOrEqual(2);
  });

  test("archive moves the todo into the YYYY-MM partition", async () => {
    const id = await addBasic();
    const r = await runCli(
      ["todo", "archive", id, "--reason", "shipped"],
      { home },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("shipped");

    const list = JSON.parse(
      (await runCli(["todo", "list", "--json"], { home })).stdout,
    );
    expect(list.items).toHaveLength(0);
  });
});

describe("todo score", () => {
  test("computes a deterministic score and stores TaskImportance", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const id = await addBasic();

    const r = await runCli(
      [
        "todo",
        "score",
        id,
        "--urgency",
        "7",
        "--impact",
        "8",
        "--effort",
        "4",
        "--reversibility",
        "6",
        "--deadline",
        "soft",
        "--reasoning",
        "OKR-relevant",
      ],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/score:\s+\d+\.\d+\s+\/ 100/);

    const get = await runCli(["todo", "get", id, "--json"], { home });
    const detail = JSON.parse(get.stdout);
    expect(detail.importance).not.toBeNull();
    expect(detail.importance.score).toBeCloseTo(59.509, 2);
    expect(detail.importance.policy_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(detail.importance_score).toBeCloseTo(59.509, 2);

    // History records the "scored" entry.
    const scoredEntry = detail.history.find((h: { kind: string }) => h.kind === "scored");
    expect(scoredEntry).toBeDefined();
  });

  test("score before policy preset apply → DAY_NOT_INITIALIZED", async () => {
    const id = await addBasic();
    const r = await runCli(
      [
        "todo", "score", id,
        "--urgency", "5", "--impact", "5", "--effort", "5", "--reversibility", "5",
      ],
      { home },
    );
    expect(r.exitCode).toBe(78);
    expect(r.stderr).toContain("DAY_NOT_INITIALIZED");
  });

  test("score with missing dimension → DAY_USAGE", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const id = await addBasic();
    const r = await runCli(
      ["todo", "score", id, "--urgency", "5", "--impact", "5", "--effort", "5"],
      { home },
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
    expect(r.stderr).toContain("--reversibility");
  });

  test("score on unknown id → DAY_NOT_FOUND", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const r = await runCli(
      [
        "todo", "score", "todo_00000000000000",
        "--urgency", "5", "--impact", "5", "--effort", "5", "--reversibility", "5",
      ],
      { home },
    );
    expect(r.exitCode).toBe(66);
    expect(r.stderr).toContain("DAY_NOT_FOUND");
  });

  test("--ai delegates to the configured provider (S37)", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const id = await addBasic("AI-scored todo");
    const r = await runCli(
      ["todo", "score", id, "--ai", "--ai-provider", "mock", "--reasoning", "auto"],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/score:\s+\d+\.\d+\s+\/ 100/);

    const detail = JSON.parse(
      (await runCli(["todo", "get", id, "--json"], { home })).stdout,
    );
    expect(detail.importance).not.toBeNull();
    // MockAIProvider's neutral defaults yield the §S16 baseline score
    // (urgency=impact=effort=reversibility=5 → 34.905 under Balanced).
    expect(detail.importance.score).toBeCloseTo(34.905, 2);
    expect(detail.importance.computed_by).toBe("mock");
  });

  test("--ai with unknown provider → DAY_PROVIDER_UNAVAILABLE", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const id = await addBasic();
    const r = await runCli(
      ["todo", "score", id, "--ai", "--ai-provider", "nope"],
      { home },
    );
    expect(r.exitCode).toBe(69);
    expect(r.stderr).toContain("DAY_PROVIDER_UNAVAILABLE");
  });

  test("--json output contains the full TaskImportance", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const id = await addBasic();
    const r = await runCli(
      [
        "todo", "score", id, "--json",
        "--urgency", "5", "--impact", "5", "--effort", "5", "--reversibility", "5",
        "--deadline", "hard", "--external-dependency",
      ],
      { home },
    );
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.id).toBe(id);
    expect(out.importance.score).toBeCloseTo(54.905, 2);
    expect(out.importance.dimensions.deadline).toBe("hard");
    expect(out.importance.dimensions.external_dependency).toBe(true);
  });
});
