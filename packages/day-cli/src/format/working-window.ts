/**
 * Hard-coded "default" working window for v0.1 day views. Policy
 * (§S13) will replace this with a user-configurable preset.
 */

const TZ_RE = /([+-]\d{2}):?(\d{2})?$/;

function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Resolve the wall-clock offset (`±HH:MM`) of a named timezone on a
 * given calendar date. Falls back to `+00:00` if the platform's Intl
 * data is missing.
 */
export function offsetFor(date: string, tz: string): string {
  try {
    const sample = new Date(`${date}T12:00:00Z`);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
      hour: "numeric",
    });
    const part = fmt
      .formatToParts(sample)
      .find((p) => p.type === "timeZoneName");
    if (!part) return "+00:00";
    // Possible shapes: "GMT", "GMT+9", "GMT-3", "GMT+09:00", "GMT+05:30"
    if (part.value === "GMT") return "+00:00";
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part.value);
    if (!m) return "+00:00";
    const sign = m[1] ?? "+";
    const hh = (m[2] ?? "0").padStart(2, "0");
    const mm = (m[3] ?? "00").padStart(2, "0");
    return `${sign}${hh}:${mm}`;
  } catch {
    return "+00:00";
  }
}

export type WorkingWindow = {
  date: string;
  tz: string;
  windowStart: string;
  windowEnd: string;
  protectedRanges: Array<{ start: string; end: string; label: string }>;
};

/**
 * v0.1 default: 09:00–18:00 in the user's system TZ, lunch protected
 * 12:00–13:00. The TZ can be picked up from the day's events when
 * available — the event suffix is already in the user's TZ.
 */
export function defaultWorkingWindow(date: string, hintTz?: string): WorkingWindow {
  const tz = hintTz ?? systemTimeZone();
  const off = offsetFor(date, tz);
  const at = (hhmm: string) => `${date}T${hhmm}:00${off}`;
  return {
    date,
    tz,
    windowStart: at("09:00"),
    windowEnd: at("18:00"),
    protectedRanges: [
      { start: at("12:00"), end: at("13:00"), label: "lunch" },
    ],
  };
}

/** Pull the offset (`+09:00`) out of an ISODateTime if present. */
export function tzFromISODateTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = TZ_RE.exec(value);
  if (!m) return undefined;
  return undefined; // we only have the offset, not a TZ name; caller falls back to system
}
