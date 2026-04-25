import { type DayCode, getCodeMetadata } from "./codes";
import type { Locale } from "./locale";

export type ErrorSummary = {
  /** English summary (always required — fallback for unsupported locales). */
  readonly en: string;
  /** Korean summary (optional). */
  readonly ko?: string;
};

export type ScaffoldErrorSpec = {
  /** Catalog code (`DAY_*`). */
  readonly code: DayCode;
  /** One-line localized summary, shown after the code on stderr. */
  readonly summary: ErrorSummary;
  /** Multi-line "why this happened" body — printed in the CAUSE section. */
  readonly cause: string;
  /** Ordered remediation steps — printed in the TRY section. */
  readonly try: readonly string[];
  /** Optional canonical docs URL — overrides the catalog default. */
  readonly docs?: string;
  /** Override the default exit code for this code. */
  readonly exitCode?: number;
  /** Free-form structured payload (echoed in --json output). */
  readonly context?: Record<string, unknown>;
};

/**
 * Canonical scaffold-day error.
 *
 * Subclasses Error so it interoperates with regular catch / instanceof,
 * but the formatted output (text or JSON) is produced by `format.ts`.
 * Field name `try` is intentionally chosen to match the SLICES §S3
 * vocabulary; it is allowed as a property name even though it is a
 * reserved keyword in expression position.
 */
export class ScaffoldError extends Error {
  override readonly name = "ScaffoldError";
  readonly code: DayCode;
  readonly summary: ErrorSummary;
  readonly causeText: string;
  readonly try: readonly string[];
  readonly docs?: string;
  readonly exitCode: number;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(spec: ScaffoldErrorSpec) {
    super(spec.summary.en);
    this.code = spec.code;
    this.summary = spec.summary;
    this.causeText = spec.cause;
    this.try = Object.freeze([...spec.try]);
    const meta = getCodeMetadata(spec.code);
    this.docs = spec.docs ?? meta.defaultDocs;
    this.exitCode = spec.exitCode ?? meta.defaultExitCode;
    this.context = Object.freeze({ ...(spec.context ?? {}) });
  }

  /** Resolve the localized one-line summary, falling back to English. */
  localizedSummary(locale: Locale): string {
    if (locale === "ko" && this.summary.ko) return this.summary.ko;
    return this.summary.en;
  }
}

export function isScaffoldError(value: unknown): value is ScaffoldError {
  return value instanceof ScaffoldError;
}
