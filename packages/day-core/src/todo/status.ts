/**
 * Live TODO statuses (PRD §9.4, SLICES §S6).
 *
 * v0.1 ships three live states. Archived items move out of the active
 * tier into `todos/archive/YYYY-MM.json` and gain `archived_at` —
 * being archived is implied by location, not by a fourth status.
 */

export const TODO_STATUSES = ["open", "in_progress", "done"] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number];
