import { ScaffoldError } from "../error";
import { generateEntityId } from "../ids/entity-id";
import type {
  CreateTodoInput,
  TodoFilter,
  TodoRepository,
  UpdateTodoInput,
} from "./repository";
import type {
  TodoArchive,
  TodoDetail,
  TodoHistoryEntry,
  TodoSummary,
} from "./schemas";

function nowIso(): string {
  return new Date().toISOString();
}

function summarize(detail: TodoDetail): TodoSummary {
  const {
    description: _description,
    reasoning: _reasoning,
    history: _history,
    ...summary
  } = detail;
  return summary;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function matchesFilter(t: TodoSummary, f?: TodoFilter): boolean {
  if (!f) return true;
  if (f.status && f.status.length > 0 && !f.status.includes(t.status)) return false;
  if (f.tagsAny && f.tagsAny.length > 0) {
    if (!f.tagsAny.some((tag) => t.tags.includes(tag))) return false;
  }
  if (f.hasDeadline === true && !t.tags.some((tag) => tag.startsWith("#deadline:"))) {
    return false;
  }
  if (f.hasDeadline === false && t.tags.some((tag) => tag.startsWith("#deadline:"))) {
    return false;
  }
  return true;
}

function notFound(id: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_NOT_FOUND",
    summary: {
      en: `todo '${id}' not found`,
      ko: `todo '${id}' 를 찾을 수 없습니다`,
    },
    cause: `No active todo exists with id '${id}'.`,
    try: [
      "Run `scaffold-day todo list` to see available ids.",
      "If the todo was archived, query the archive tier for its month.",
    ],
    context: { id },
  });
}

/**
 * In-memory implementation of `TodoRepository` (SLICES §S7). Holds
 * active TODOs in a Map keyed by id and the archive partitioned by
 * YYYY-MM. All returned values are deep-cloned so callers cannot
 * mutate internal state.
 */
export class InMemoryTodoRepository implements TodoRepository {
  private readonly active: Map<string, TodoDetail> = new Map();
  private readonly archives: Map<string, TodoArchive[]> = new Map();

  async listSummaries(filter?: TodoFilter): Promise<TodoSummary[]> {
    return Array.from(this.active.values())
      .map(summarize)
      .filter((s) => matchesFilter(s, filter))
      .map(clone);
  }

  async getSummary(id: string): Promise<TodoSummary | null> {
    const detail = this.active.get(id);
    return detail ? clone(summarize(detail)) : null;
  }

  async getDetail(id: string): Promise<TodoDetail | null> {
    const detail = this.active.get(id);
    return detail ? clone(detail) : null;
  }

  async create(input: CreateTodoInput): Promise<TodoDetail> {
    const id = generateEntityId("todo");
    const now = nowIso();
    const detail: TodoDetail = {
      id,
      title: input.title.trim(),
      status: input.status ?? "open",
      tags: input.tags ? [...input.tags] : [],
      importance_score: input.importance_score ?? null,
      duration_min: input.duration_min ?? null,
      target_date: input.target_date ?? null,
      created_at: now,
      updated_at: now,
      description: input.description ?? null,
      reasoning: input.reasoning ?? null,
      history: [
        {
          at: now,
          by: input.by ?? "user",
          kind: "created",
          notes: null,
          patch: null,
        },
      ],
    };
    this.active.set(id, detail);
    return clone(detail);
  }

  async update(id: string, patch: UpdateTodoInput): Promise<TodoDetail> {
    const existing = this.active.get(id);
    if (!existing) throw notFound(id);

    const next: TodoDetail = {
      ...existing,
      tags: existing.tags,
      history: existing.history,
    };

    const diff: Record<string, unknown> = {};

    if (patch.title !== undefined && patch.title !== existing.title) {
      next.title = patch.title;
      diff.title = patch.title;
    }
    if (patch.status !== undefined && patch.status !== existing.status) {
      next.status = patch.status;
      diff.status = patch.status;
    }
    if (patch.tags !== undefined) {
      next.tags = [...patch.tags];
      diff.tags = next.tags;
    }
    if (patch.importance_score !== undefined) {
      next.importance_score = patch.importance_score;
      diff.importance_score = patch.importance_score;
    }
    if (patch.duration_min !== undefined) {
      next.duration_min = patch.duration_min;
      diff.duration_min = patch.duration_min;
    }
    if (patch.target_date !== undefined) {
      next.target_date = patch.target_date;
      diff.target_date = patch.target_date;
    }
    if (patch.description !== undefined) {
      next.description = patch.description;
      diff.description = patch.description;
    }
    if (patch.reasoning !== undefined) {
      next.reasoning = patch.reasoning;
      diff.reasoning = patch.reasoning;
    }

    const now = nowIso();
    next.updated_at = now;

    const entry: TodoHistoryEntry = {
      at: now,
      by: patch.by ?? "user",
      kind: patch.history_kind ?? "updated",
      notes: patch.notes ?? null,
      patch: Object.keys(diff).length > 0 ? diff : null,
    };
    next.history = [...existing.history, entry];

    this.active.set(id, next);
    return clone(next);
  }

  async archive(
    id: string,
    options: { reason?: string; by?: string } = {},
  ): Promise<TodoArchive> {
    const existing = this.active.get(id);
    if (!existing) throw notFound(id);

    const now = nowIso();
    const reason = options.reason ?? null;
    const by = options.by ?? "user";

    const historyEntry: TodoHistoryEntry = {
      at: now,
      by,
      kind: "archived",
      notes: reason,
      patch: null,
    };

    const archive: TodoArchive = {
      ...existing,
      tags: [...existing.tags],
      history: [...existing.history, historyEntry],
      archived_at: now,
      archive_reason: reason,
      final_status: existing.status,
    };

    const month = now.slice(0, 7); // YYYY-MM
    const bucket = this.archives.get(month) ?? [];
    bucket.push(archive);
    this.archives.set(month, bucket);
    this.active.delete(id);

    return clone(archive);
  }

  async listArchive(month: string): Promise<TodoArchive[]> {
    return clone(this.archives.get(month) ?? []);
  }
}
