import { z } from "zod";

/**
 * ISODate — `YYYY-MM-DD`. Validated against a real calendar day (so
 * `2026-02-30` is rejected even though it matches the regex).
 */
export const ISODateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "ISODate must match YYYY-MM-DD")
  .refine((d) => {
    const date = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === d;
  }, "ISODate must be a real calendar day");

/**
 * ISOTime — `HH:MM` or `HH:MM:SS` with hour 00-23, minute/second 00-59.
 */
export const ISOTimeSchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
    "ISOTime must match HH:MM or HH:MM:SS (24h)",
  );

/**
 * ISODateTime — full ISO 8601 with explicit timezone (`Z` or `±HH:MM`).
 * Naive timestamps are rejected so we never write a timezone-ambiguous
 * value to disk.
 */
export const ISODateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/,
    "ISODateTime must be ISO 8601 with explicit timezone",
  )
  .refine((s) => !Number.isNaN(Date.parse(s)), "ISODateTime must be parseable");

/**
 * YYYYMM — `YYYY-MM`, month 01-12. Used for the day partition keys.
 */
export const YYYYMMSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYYMM must match YYYY-MM (month 01-12)");

/**
 * Tag — `#kebab-name` with an optional `:value` suffix (e.g.
 * `#deadline:2026-05-01`). Lower-case only; value can include digits
 * and hyphens, which lets dates serialize naturally.
 */
export const TagSchema = z
  .string()
  .regex(
    /^#[a-z0-9][a-z0-9-]*(?::[a-z0-9-]+)?$/,
    "Tag must start with # and use lower-case kebab; optional :value suffix",
  );

/**
 * ModelId — provider/model identifier, lower-case. Permits common
 * shapes:
 *   - `claude-sonnet-4-5`
 *   - `anthropic/claude-opus-4-7`
 *   - `llama3:8b`
 *   - `gpt-4o`
 */
export const ModelIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z][a-z0-9._:/-]*$/,
    "ModelId must be lower-case alphanumeric with ./_:- separators",
  );

export type ISODate = z.infer<typeof ISODateSchema>;
export type ISOTime = z.infer<typeof ISOTimeSchema>;
export type ISODateTime = z.infer<typeof ISODateTimeSchema>;
export type YYYYMM = z.infer<typeof YYYYMMSchema>;
export type Tag = z.infer<typeof TagSchema>;
export type ModelId = z.infer<typeof ModelIdSchema>;
