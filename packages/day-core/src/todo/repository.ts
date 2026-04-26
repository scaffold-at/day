import type { ISODate, Tag } from "../ids/schemas";
import type { TaskImportance } from "../policy/importance";
import type { TodoArchive, TodoDetail, TodoHistoryKind, TodoSummary } from "./schemas";
import type { TodoStatus } from "./status";

export type TodoFilter = {
  /** Match any of the listed statuses. */
  status?: readonly TodoStatus[];
  /** Match if the todo has at least one of the listed tags. */
  tagsAny?: readonly Tag[];
  /** Filter by presence/absence of a `#deadline:` tag. */
  hasDeadline?: boolean;
};

export type CreateTodoInput = {
  title: string;
  status?: TodoStatus;
  tags?: readonly Tag[];
  importance_score?: number | null;
  duration_min?: number | null;
  target_date?: ISODate | null;
  description?: string | null;
  reasoning?: string | null;
  /** Attribution string for the initial history entry. Defaults to "user". */
  by?: string;
};

export type UpdateTodoInput = {
  title?: string;
  status?: TodoStatus;
  tags?: readonly Tag[];
  importance_score?: number | null;
  /**
   * Full TaskImportance record. When provided, the repository also
   * mirrors `.score` into `importance_score` so the summary stays in
   * sync. Default history_kind for these updates is "scored".
   */
  importance?: TaskImportance | null;
  duration_min?: number | null;
  target_date?: ISODate | null;
  description?: string | null;
  reasoning?: string | null;
  /** Attribution string for the appended history entry. Defaults to "user". */
  by?: string;
  /** Override the default history kind ("updated"). */
  history_kind?: TodoHistoryKind;
  /** Free-form note recorded with the history entry. */
  notes?: string | null;
};

export interface TodoRepository {
  /** Active tier — Summary projection (cheap to load in bulk). */
  listSummaries(filter?: TodoFilter): Promise<TodoSummary[]>;
  /** Active tier — Summary by id, or null if absent. */
  getSummary(id: string): Promise<TodoSummary | null>;
  /** Active tier — full Detail by id, or null if absent. */
  getDetail(id: string): Promise<TodoDetail | null>;

  /** Create a new TODO and return its full Detail. */
  create(input: CreateTodoInput): Promise<TodoDetail>;
  /** Apply a partial patch and append a history entry. Throws DAY_NOT_FOUND if absent. */
  update(id: string, patch: UpdateTodoInput): Promise<TodoDetail>;
  /** Move from active → archive tier. Throws DAY_NOT_FOUND if absent. */
  archive(id: string, options?: { reason?: string; by?: string }): Promise<TodoArchive>;

  /** Archive tier — list archives for a given YYYY-MM partition. */
  listArchive(month: string): Promise<TodoArchive[]>;
}
