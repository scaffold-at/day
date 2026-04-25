import { detectLocale, type Locale } from "./locale";
import type { ScaffoldError } from "./scaffold-error";

export type FormatOptions = {
  /** Override the auto-detected locale. */
  locale?: Locale;
};

export type ErrorJsonShape = {
  error: {
    code: string;
    summary: { en: string; ko?: string };
    cause: string;
    try: readonly string[];
    docs?: string;
    context: Readonly<Record<string, unknown>>;
  };
  exit_code: number;
};

function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? "" : prefix + line))
    .join("\n");
}

function indentList(items: readonly string[], prefix = "  • "): string {
  return items.map((item) => `${prefix}${item}`).join("\n");
}

/**
 * Format an error for human-readable stderr output.
 *
 * Layout:
 *
 *     DAY_CODE: localized summary
 *
 *     CAUSE
 *       multi-line cause body
 *
 *     TRY
 *       • step 1
 *       • step 2
 *
 *     DOCS
 *       https://scaffold.at/...
 *
 * No ANSI escapes are emitted. Section labels stay uppercase regardless
 * of NO_COLOR, so the meaning is preserved when color is added later
 * (SLICES §S12).
 */
export function formatErrorText(
  err: ScaffoldError,
  options: FormatOptions = {},
): string {
  const locale = options.locale ?? detectLocale();
  const head = `${err.code}: ${err.localizedSummary(locale)}`;
  const sections: string[] = [`CAUSE\n${indent(err.causeText)}`];
  if (err.try.length > 0) {
    sections.push(`TRY\n${indentList(err.try)}`);
  }
  if (err.docs) {
    sections.push(`DOCS\n${indent(err.docs)}`);
  }
  return `${head}\n\n${sections.join("\n\n")}\n`;
}

/**
 * Format an error as a stable JSON shape for `--json` mode and MCP.
 */
export function formatErrorJson(err: ScaffoldError): ErrorJsonShape {
  return {
    error: {
      code: err.code,
      summary: { en: err.summary.en, ...(err.summary.ko ? { ko: err.summary.ko } : {}) },
      cause: err.causeText,
      try: err.try,
      ...(err.docs ? { docs: err.docs } : {}),
      context: err.context,
    },
    exit_code: err.exitCode,
  };
}
