import type { Tag } from "./schemas";

/**
 * Tags that carry time-sensitive semantics in v0.1 (PRD §10.3).
 * Used by the `require_tag_in_range` hard rule and by the future
 * §S40 `suggest_tags` AI helper.
 */
export const TIME_SENSITIVE_TAGS = ["#call", "#business-hours"] as const;
export type TimeSensitiveTag = (typeof TIME_SENSITIVE_TAGS)[number];

const DEADLINE_PREFIX = "#deadline:";
const DEADLINE_VALUE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TAG_RE = /^#[a-z0-9][a-z0-9-]*(?::[a-z0-9-]+)?$/;

export function isTag(value: string): value is Tag {
  return TAG_RE.test(value);
}

/**
 * Lower-case + drop surrounding whitespace + prepend `#` if missing.
 * Throws nothing — callers should validate the result with `isTag`.
 */
export function normalizeTag(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

/**
 * Decompose a tag into name and optional `:value`.
 * `#deadline:2026-05-01` → `{name: "deadline", value: "2026-05-01"}`
 * `#deep-work` → `{name: "deep-work", value: null}`
 */
export function parseTag(tag: string): { name: string; value: string | null } {
  if (!tag.startsWith("#")) return { name: "", value: null };
  const body = tag.slice(1);
  const colon = body.indexOf(":");
  if (colon === -1) return { name: body, value: null };
  return { name: body.slice(0, colon), value: body.slice(colon + 1) };
}

/**
 * Pure helper that pulls `YYYY-MM-DD` out of a `#deadline:` tag list.
 * (PRD §6.1, §S26.) Mirrors `todo/schemas.ts::extractDeadlineDate`
 * but is exposed under ids/ so non-todo consumers can use it without
 * importing the todo schemas.
 */
export function extractDeadline(tags: readonly string[]): string | null {
  for (const tag of tags) {
    if (!tag.startsWith(DEADLINE_PREFIX)) continue;
    const value = tag.slice(DEADLINE_PREFIX.length);
    if (DEADLINE_VALUE_RE.test(value)) return value;
  }
  return null;
}

export function isTimeSensitiveTag(tag: string): boolean {
  if ((TIME_SENSITIVE_TAGS as readonly string[]).includes(tag)) return true;
  if (tag.startsWith(DEADLINE_PREFIX)) return true;
  return false;
}

/**
 * Filter helper: returns the subset of `tags` matching every entry
 * in `query` (AND semantics). Returns the original array on empty
 * query.
 */
export function filterTags(tags: readonly string[], query: readonly string[]): string[] {
  if (query.length === 0) return [...tags];
  const queryNorm = query.map(normalizeTag);
  return tags.filter((t) => queryNorm.every((q) => t === q));
}

/**
 * Find tags within a list that match a name prefix (without `#`).
 * Useful for AI auto-completion or `query_todos --tag-prefix admin`.
 */
export function searchTagsByName(tags: readonly string[], namePrefix: string): string[] {
  const prefix = namePrefix.startsWith("#") ? namePrefix.slice(1) : namePrefix;
  return tags.filter((t) => parseTag(t).name.startsWith(prefix.toLowerCase()));
}
