import { describe, expect, test } from "bun:test";
import {
  extractDeadlineDate,
  TODO_STATUSES,
  TodoArchiveSchema,
  TodoDetailSchema,
  TodoSummarySchema,
} from "./index";

const baseSummary = {
  id: "todo_01hf3k2mxzxxxx",
  title: "Write the S6 schema",
  status: "open" as const,
  tags: ["#deep-work"],
  importance_score: 72,
  duration_min: 60,
  target_date: "2026-04-30",
  created_at: "2026-04-26T09:00:00Z",
  updated_at: "2026-04-26T09:00:00Z",
};

describe("TodoSummarySchema — 5 valid", () => {
  const cases = [
    baseSummary,
    {
      ...baseSummary,
      tags: [],
      importance_score: null,
      duration_min: null,
      target_date: null,
    },
    {
      ...baseSummary,
      id: "todo_zzzzzzzzzzzzzz",
      tags: ["#call", "#business-hours", "#deadline:2026-05-01"],
      status: "in_progress",
    },
    {
      ...baseSummary,
      id: "todo_00000000000000",
      status: "done",
      importance_score: 0,
      duration_min: 0,
    },
    {
      ...baseSummary,
      title: "B".repeat(280),
      tags: Array.from({ length: 32 }, (_, i) => `#tag-${i}`),
      importance_score: 100,
    },
  ];

  for (const [i, c] of cases.entries()) {
    test(`case ${i + 1}`, () => {
      const result = TodoSummarySchema.safeParse(c);
      if (!result.success) {
        console.error(JSON.stringify(result.error.issues, null, 2));
      }
      expect(result.success).toBe(true);
    });
  }
});

describe("TodoSummarySchema — 5 invalid", () => {
  const cases: Array<[string, unknown]> = [
    ["wrong id prefix", { ...baseSummary, id: "evt_01hf3k2mxzxxxx" }],
    ["empty title", { ...baseSummary, title: "" }],
    ["unknown status", { ...baseSummary, status: "blocked" }],
    ["importance > 100", { ...baseSummary, importance_score: 101 }],
    ["tag uppercase", { ...baseSummary, tags: ["#Deep-Work"] }],
  ];

  for (const [label, value] of cases) {
    test(label, () => {
      expect(TodoSummarySchema.safeParse(value).success).toBe(false);
    });
  }
});

describe("Tag — #deadline:YYYY-MM-DD", () => {
  test("TodoSummary accepts a deadline tag", () => {
    const ok = TodoSummarySchema.safeParse({
      ...baseSummary,
      tags: ["#deadline:2026-05-01"],
    });
    expect(ok.success).toBe(true);
  });

  test("extractDeadlineDate finds the YYYY-MM-DD value", () => {
    expect(extractDeadlineDate(["#deep-work", "#deadline:2026-05-01"])).toBe(
      "2026-05-01",
    );
  });

  test("extractDeadlineDate returns null for malformed values", () => {
    // Note: TagSchema would already have rejected these; helper is permissive.
    expect(extractDeadlineDate(["#deadline:2026-5-1" as never])).toBeNull();
    expect(extractDeadlineDate(["#deep-work"])).toBeNull();
    expect(extractDeadlineDate([])).toBeNull();
  });
});

describe("status enum", () => {
  test("contains exactly the 3 documented states", () => {
    expect([...TODO_STATUSES]).toEqual(["open", "in_progress", "done"]);
  });
});

describe("TodoDetailSchema", () => {
  test("extends summary with description / reasoning / history", () => {
    const detail = {
      ...baseSummary,
      description: "Land the Two-tier data model.",
      reasoning: "Unblocks Phase 2.",
      history: [
        {
          at: "2026-04-26T09:00:00Z",
          by: "user",
          kind: "created",
          notes: null,
          patch: null,
        },
      ],
    };
    const result = TodoDetailSchema.safeParse(detail);
    expect(result.success).toBe(true);
  });

  test("rejects unknown history kind", () => {
    const detail = {
      ...baseSummary,
      description: null,
      reasoning: null,
      history: [
        {
          at: "2026-04-26T09:00:00Z",
          by: "user",
          kind: "exploded",
          notes: null,
          patch: null,
        },
      ],
    };
    expect(TodoDetailSchema.safeParse(detail).success).toBe(false);
  });
});

describe("TodoArchiveSchema", () => {
  test("requires archived_at + final_status on top of detail fields", () => {
    const archive = {
      ...baseSummary,
      description: null,
      reasoning: null,
      history: [],
      archived_at: "2026-04-30T10:00:00Z",
      archive_reason: "completed",
      final_status: "done",
    };
    expect(TodoArchiveSchema.safeParse(archive).success).toBe(true);
  });

  test("rejects when archived_at is missing", () => {
    const archive = {
      ...baseSummary,
      description: null,
      reasoning: null,
      history: [],
      archive_reason: "completed",
      final_status: "done",
    };
    expect(TodoArchiveSchema.safeParse(archive).success).toBe(false);
  });
});
