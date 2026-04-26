import { mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { ScaffoldError } from "../error";
import { atomicWrite } from "../fs/atomic-write";
import { generateEntityId } from "../ids/entity-id";
import { CURRENT_SCHEMA_VERSION, type SchemaVersion } from "../schema/version";
import type {
  CreateTodoInput,
  TodoFilter,
  TodoRepository,
  UpdateTodoInput,
} from "./repository";
import {
  type TodoArchive,
  TodoArchiveSchema,
  type TodoDetail,
  TodoDetailSchema,
  type TodoHistoryEntry,
  type TodoSummary,
  TodoSummarySchema,
  summarize,
} from "./schemas";

type TodosIndexFile = {
  schema_version: SchemaVersion;
  summaries: TodoSummary[];
};

type ArchivePartitionFile = {
  schema_version: SchemaVersion;
  archives: TodoArchive[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
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

function invalid(file: string, reason: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_INVALID_INPUT",
    summary: {
      en: `failed to parse ${file}`,
      ko: `${file} 파싱 실패`,
    },
    cause: reason,
    try: [
      "Restore the file from a recent backup under .scaffold-day/.backups/.",
      "Or run `scaffold-day rebuild-index` once it is wired (S2 placeholder for now).",
    ],
    context: { file },
  });
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

/**
 * Filesystem TODO repository (PRD §9, SLICES §S8c).
 *
 * Layout under `<home>/`:
 *
 *   todos/active/index.json         — TodosIndexFile (summaries only)
 *   todos/active/detail/<id>.json   — TodoDetail (per-id, lazy)
 *   todos/archive/<YYYY-MM>.json    — ArchivePartitionFile
 *
 * Invariant: every entry in `index.summaries` equals
 * `summarize(<detail file with same id>)`. `update` and `archive`
 * keep both files in sync. The repository is single-process by
 * design — caller should hold an `AdvisoryLock` (S8b) before mutating.
 */
export class FsTodoRepository implements TodoRepository {
  constructor(public readonly home: string) {}

  // ─── path helpers ─────────────────────────────────────────────────

  todosDir(): string {
    return path.join(this.home, "todos");
  }
  activeDir(): string {
    return path.join(this.todosDir(), "active");
  }
  detailDir(): string {
    return path.join(this.activeDir(), "detail");
  }
  indexPath(): string {
    return path.join(this.activeDir(), "index.json");
  }
  detailPath(id: string): string {
    return path.join(this.detailDir(), `${id}.json`);
  }
  archivePath(month: string): string {
    return path.join(this.todosDir(), "archive", `${month}.json`);
  }

  // ─── public API ───────────────────────────────────────────────────

  async listSummaries(filter?: TodoFilter): Promise<TodoSummary[]> {
    const index = await this.readIndex();
    return index.summaries.filter((s) => matchesFilter(s, filter));
  }

  async getSummary(id: string): Promise<TodoSummary | null> {
    const index = await this.readIndex();
    return index.summaries.find((s) => s.id === id) ?? null;
  }

  async getDetail(id: string): Promise<TodoDetail | null> {
    try {
      const raw = await readFile(this.detailPath(id), "utf8");
      const parsed = TodoDetailSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        throw invalid(this.detailPath(id), parsed.error.message);
      }
      return parsed.data;
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
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
      importance: null,
    };

    await this.ensureDirs();
    await this.writeDetail(detail);

    const index = await this.readIndex();
    index.summaries.push(summarize(detail));
    await this.writeIndex(index);

    return detail;
  }

  async update(id: string, patch: UpdateTodoInput): Promise<TodoDetail> {
    const existing = await this.getDetail(id);
    if (!existing) throw notFound(id);

    const diff: Record<string, unknown> = {};
    const next: TodoDetail = {
      ...existing,
      tags: existing.tags,
      history: existing.history,
    };

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
    if (patch.importance !== undefined) {
      next.importance = patch.importance;
      next.importance_score = patch.importance?.score ?? null;
      diff.importance = patch.importance;
      diff.importance_score = next.importance_score;
    } else if (patch.importance_score !== undefined) {
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

    next.updated_at = nowIso();
    const entry: TodoHistoryEntry = {
      at: next.updated_at,
      by: patch.by ?? "user",
      kind: patch.history_kind ?? "updated",
      notes: patch.notes ?? null,
      patch: Object.keys(diff).length > 0 ? diff : null,
    };
    next.history = [...existing.history, entry];

    await this.writeDetail(next);

    const index = await this.readIndex();
    const i = index.summaries.findIndex((s) => s.id === id);
    if (i >= 0) {
      index.summaries[i] = summarize(next);
    } else {
      // Index out of sync — re-attach.
      index.summaries.push(summarize(next));
    }
    await this.writeIndex(index);

    return next;
  }

  async archive(
    id: string,
    options: { reason?: string; by?: string } = {},
  ): Promise<TodoArchive> {
    const existing = await this.getDetail(id);
    if (!existing) throw notFound(id);

    const now = nowIso();
    const reason = options.reason ?? null;
    const by = options.by ?? "user";

    const archive: TodoArchive = {
      ...existing,
      tags: [...existing.tags],
      history: [
        ...existing.history,
        { at: now, by, kind: "archived", notes: reason, patch: null },
      ],
      archived_at: now,
      archive_reason: reason,
      final_status: existing.status,
    };

    const month = now.slice(0, 7);
    const partition = await this.readArchive(month);
    partition.archives.push(archive);
    await this.writeArchive(month, partition);

    const index = await this.readIndex();
    index.summaries = index.summaries.filter((s) => s.id !== id);
    await this.writeIndex(index);

    try {
      await unlink(this.detailPath(id));
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }

    return archive;
  }

  async listArchive(month: string): Promise<TodoArchive[]> {
    const partition = await this.readArchive(month);
    return [...partition.archives];
  }

  // ─── internals ────────────────────────────────────────────────────

  private async ensureDirs(): Promise<void> {
    await mkdir(this.detailDir(), { recursive: true });
    await mkdir(path.join(this.todosDir(), "archive"), { recursive: true });
  }

  private async readIndex(): Promise<TodosIndexFile> {
    try {
      const raw = await readFile(this.indexPath(), "utf8");
      const parsed = JSON.parse(raw) as Partial<TodosIndexFile>;
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        typeof parsed.schema_version !== "string" ||
        !Array.isArray(parsed.summaries)
      ) {
        throw invalid(this.indexPath(), "missing schema_version or summaries[]");
      }
      const validated: TodoSummary[] = [];
      for (const candidate of parsed.summaries) {
        const r = TodoSummarySchema.safeParse(candidate);
        if (!r.success) {
          throw invalid(this.indexPath(), `summary entry rejected: ${r.error.message}`);
        }
        validated.push(r.data);
      }
      return {
        schema_version: parsed.schema_version as SchemaVersion,
        summaries: validated,
      };
    } catch (err) {
      if (isEnoent(err)) {
        return { schema_version: CURRENT_SCHEMA_VERSION, summaries: [] };
      }
      throw err;
    }
  }

  private async writeIndex(index: TodosIndexFile): Promise<void> {
    await mkdir(this.activeDir(), { recursive: true });
    await atomicWrite(
      this.indexPath(),
      `${JSON.stringify(index, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  private async writeDetail(detail: TodoDetail): Promise<void> {
    await mkdir(this.detailDir(), { recursive: true });
    await atomicWrite(
      this.detailPath(detail.id),
      `${JSON.stringify(detail, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  private async readArchive(month: string): Promise<ArchivePartitionFile> {
    const p = this.archivePath(month);
    try {
      const raw = await readFile(p, "utf8");
      const parsed = JSON.parse(raw) as Partial<ArchivePartitionFile>;
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        typeof parsed.schema_version !== "string" ||
        !Array.isArray(parsed.archives)
      ) {
        throw invalid(p, "missing schema_version or archives[]");
      }
      const archives: TodoArchive[] = [];
      for (const candidate of parsed.archives) {
        const r = TodoArchiveSchema.safeParse(candidate);
        if (!r.success) {
          throw invalid(p, `archive entry rejected: ${r.error.message}`);
        }
        archives.push(r.data);
      }
      return { schema_version: parsed.schema_version as SchemaVersion, archives };
    } catch (err) {
      if (isEnoent(err)) {
        return { schema_version: CURRENT_SCHEMA_VERSION, archives: [] };
      }
      throw err;
    }
  }

  private async writeArchive(
    month: string,
    partition: ArchivePartitionFile,
  ): Promise<void> {
    await mkdir(path.join(this.todosDir(), "archive"), { recursive: true });
    await atomicWrite(
      this.archivePath(month),
      `${JSON.stringify(partition, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  /**
   * Diagnostic: list every detail file currently on disk. Useful for
   * tests and the future `rebuild-index` command.
   */
  async listDetailFiles(): Promise<string[]> {
    try {
      return (await readdir(this.detailDir())).filter((f) => f.endsWith(".json"));
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
  }

  /**
   * Diagnostic: stat the index path. Returns null if missing.
   */
  async statIndex(): Promise<{ size: number } | null> {
    try {
      const s = await stat(this.indexPath());
      return { size: s.size };
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
  }
}
