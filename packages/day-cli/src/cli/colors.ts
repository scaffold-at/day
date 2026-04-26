/**
 * Tiny ANSI color helper — Engineer Chic palette (PRD §13).
 *
 * Disabled when stdout is not a TTY or when `NO_COLOR` is set, per the
 * NO_COLOR informal standard (https://no-color.org/). Section labels
 * stay as plain text in either mode so the meaning of the output is
 * preserved when color is stripped.
 */

const noColorEnv = process.env.NO_COLOR;
const colorEnabled = process.stdout.isTTY === true && !noColorEnv;

type Wrap = (s: string) => string;
const wrap = (open: string, close: string): Wrap => {
  if (!colorEnabled) return (s) => s;
  return (s) => `\x1b[${open}m${s}\x1b[${close}m`;
};

export const colors = {
  bold: wrap("1", "22"),
  dim: wrap("2", "22"),
  cyan: wrap("36", "39"),
  emerald: wrap("32", "39"), // ANSI green stands in for the brand emerald
  amber: wrap("33", "39"), // ANSI yellow
  red: wrap("31", "39"),
  reset: () => (colorEnabled ? "\x1b[0m" : ""),
};

export function isColorEnabled(): boolean {
  return colorEnabled;
}
