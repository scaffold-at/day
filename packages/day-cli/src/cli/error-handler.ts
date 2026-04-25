import {
  formatErrorJson,
  formatErrorText,
  isScaffoldError,
  ScaffoldError,
} from "@scaffold/day-core";

export type CliErrorOptions = {
  jsonMode: boolean;
};

/**
 * Render any caught error to stderr in either text or JSON mode and
 * return the exit code. Wraps unknown errors in `DAY_INTERNAL` so the
 * surface stays uniform.
 */
export function handleCliError(err: unknown, options: CliErrorOptions): number {
  const scaffoldErr = isScaffoldError(err) ? err : wrapAsInternal(err);
  if (options.jsonMode) {
    console.error(JSON.stringify(formatErrorJson(scaffoldErr)));
  } else {
    console.error(formatErrorText(scaffoldErr));
  }
  return scaffoldErr.exitCode;
}

function wrapAsInternal(err: unknown): ScaffoldError {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  return new ScaffoldError({
    code: "DAY_INTERNAL",
    summary: {
      en: `unexpected internal error: ${message}`,
      ko: `예상치 못한 내부 오류: ${message}`,
    },
    cause: stack ?? message,
    try: [
      "Re-run with --json to capture the structured error.",
      "File a bug at https://github.com/scaffold-at/day/issues with the JSON output.",
    ],
    context: {
      original_name: err instanceof Error ? err.name : typeof err,
    },
  });
}
