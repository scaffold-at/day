import { describe, expect, test } from "bun:test";
import { type Day, type FixedEvent } from "../day";
import { BALANCED_PRESET } from "../policy";
import { suggestPlacements, type SuggestionInput } from "./suggest";

const TZ = "+09:00";
const DATE = "2026-04-27"; // Monday in 2026
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00${TZ}`;

const event = (
  date: string,
  start: string,
  end: string,
  title = "x",
  tags: string[] = [],
): FixedEvent => ({
  id: "evt_01abcdefghi100",
  source: "manual",
  external_id: null,
  title,
  start: at(date, start),
  end: at(date, end),
  all_day: false,
  location: null,
  notes: null,
  recurring: null,
  tags,
  synced_at: at(date, "00:00"),
});

const dayOf = (date: string, events: FixedEvent[] = []): Day => ({
  schema_version: "0.1.0",
  date,
  events,
  placements: [],
  conflicts_open: [],
});

const baseInput = (over: Partial<SuggestionInput> = {}): SuggestionInput => ({
  todo: {
    id: "todo_01abcdefghi100",
    tags: ["#deep-work"],
    duration_min: 60,
    importance_score: 60,
  },
  daysByDate: new Map([[DATE, dayOf(DATE)]]),
  policy: BALANCED_PRESET,
  max: 5,
  ...over,
});

describe("suggestPlacements", () => {
  test("empty day produces multiple candidates inside the working window", () => {
    const result = suggestPlacements(baseInput());
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(5);
    expect(result.no_fit_reason).toBeNull();
  });

  test("each candidate's score = importance + soft_total + reactivity_penalty", () => {
    const result = suggestPlacements(baseInput());
    for (const c of result.candidates) {
      expect(c.score).toBeCloseTo(
        c.importance + c.soft_total + c.reactivity_penalty,
        6,
      );
    }
  });

  test("higher score sorts first; ranks are 1..N", () => {
    const result = suggestPlacements(baseInput());
    let prev = Infinity;
    for (const c of result.candidates) {
      expect(c.score).toBeLessThanOrEqual(prev + 1e-9);
      prev = c.score;
    }
    expect(result.candidates.map((c) => c.rank)).toEqual(
      result.candidates.map((_, i) => i + 1),
    );
  });

  test("deep-work in 09-12 range receives the prefer_tag_in_range bonus", () => {
    const result = suggestPlacements(baseInput());
    const top = result.candidates[0];
    expect(top).toBeDefined();
    // Convert the UTC ISO timestamp to KST (+09:00) and verify the
    // local hour is in 09..11 (the Balanced preset preference window).
    const localHour = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(top!.start));
    expect(Number(localHour)).toBeGreaterThanOrEqual(9);
    expect(Number(localHour)).toBeLessThan(12);
    expect(top!.contributions.some((c) => c.preference.kind === "prefer_tag_in_range")).toBe(true);
  });

  test("packed day with no free room yields zero candidates with a no_fit_reason", () => {
    const packed = dayOf(DATE, [
      event(DATE, "09:00", "12:00", "block-am"),
      event(DATE, "12:00", "13:00", "lunch"), // overlaps protected lunch anyway
      event(DATE, "13:00", "18:00", "block-pm"),
    ]);
    const result = suggestPlacements(
      baseInput({ daysByDate: new Map([[DATE, packed]]) }),
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.no_fit_reason).not.toBeNull();
    expect(result.no_fit_reason!.length).toBeGreaterThan(0);
  });

  test("weekend day with no working_hours falls through to no_fit_reason", () => {
    const SAT = "2026-04-25"; // Saturday in 2026
    const result = suggestPlacements(
      baseInput({ daysByDate: new Map([[SAT, dayOf(SAT)]]) }),
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.no_fit_reason).toContain("no working hours");
  });

  test("max parameter caps the candidate list", () => {
    const result = suggestPlacements(baseInput({ max: 2 }));
    expect(result.candidates.length).toBeLessThanOrEqual(2);
  });

  test("breakdown carries every contribution with a non-empty note", () => {
    const result = suggestPlacements(baseInput());
    const top = result.candidates[0]!;
    for (const c of top.contributions) {
      expect(typeof c.note).toBe("string");
      expect(c.note.length).toBeGreaterThan(0);
    }
  });
});
