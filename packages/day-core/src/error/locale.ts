/**
 * Locale detection for the 1-line error summary (SLICES §S3).
 * v0.1 supports two locales; everything else falls back to English.
 */

export type Locale = "en" | "ko";

export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "ko"] as const;

const LOCALE_ENV_VARS = ["LC_ALL", "LC_MESSAGES", "LANG"] as const;

export function detectLocale(env: NodeJS.ProcessEnv = process.env): Locale {
  for (const key of LOCALE_ENV_VARS) {
    const raw = env[key];
    if (!raw) continue;
    const lower = raw.toLowerCase();
    if (lower.startsWith("ko")) return "ko";
    if (lower.startsWith("en")) return "en";
  }
  return "en";
}
