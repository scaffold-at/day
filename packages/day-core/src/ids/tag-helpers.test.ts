import { describe, expect, test } from "bun:test";
import {
  extractDeadline,
  filterTags,
  isTag,
  isTimeSensitiveTag,
  normalizeTag,
  parseTag,
  searchTagsByName,
  TIME_SENSITIVE_TAGS,
} from "./tag-helpers";

describe("normalizeTag", () => {
  test("lowercases + prepends #", () => {
    expect(normalizeTag("Deep-Work")).toBe("#deep-work");
    expect(normalizeTag("#Deep-Work")).toBe("#deep-work");
    expect(normalizeTag("  #call  ")).toBe("#call");
  });

  test("empty input returns empty", () => {
    expect(normalizeTag("")).toBe("");
    expect(normalizeTag("   ")).toBe("");
  });
});

describe("parseTag", () => {
  test("plain name has no value", () => {
    expect(parseTag("#deep-work")).toEqual({ name: "deep-work", value: null });
  });

  test("colon-suffixed extracts value", () => {
    expect(parseTag("#deadline:2026-05-01")).toEqual({
      name: "deadline",
      value: "2026-05-01",
    });
  });

  test("non-tag returns empty name", () => {
    expect(parseTag("plain")).toEqual({ name: "", value: null });
  });
});

describe("extractDeadline", () => {
  test("pulls YYYY-MM-DD out of #deadline:", () => {
    expect(extractDeadline(["#deep-work", "#deadline:2026-05-01"])).toBe("2026-05-01");
  });

  test("malformed deadline ignored", () => {
    expect(extractDeadline(["#deadline:tomorrow"])).toBeNull();
    expect(extractDeadline([])).toBeNull();
  });
});

describe("isTimeSensitiveTag", () => {
  test("recognized literals + #deadline:* prefix", () => {
    for (const t of TIME_SENSITIVE_TAGS) expect(isTimeSensitiveTag(t)).toBe(true);
    expect(isTimeSensitiveTag("#deadline:2026-05-01")).toBe(true);
    expect(isTimeSensitiveTag("#deep-work")).toBe(false);
  });
});

describe("isTag", () => {
  test("matches the TagSchema regex", () => {
    expect(isTag("#deep-work")).toBe(true);
    expect(isTag("#deadline:2026-05-01")).toBe(true);
    expect(isTag("call")).toBe(false);
    expect(isTag("#")).toBe(false);
  });
});

describe("filterTags + searchTagsByName", () => {
  const tags = ["#deep-work", "#admin", "#deadline:2026-05-01"];

  test("filterTags AND-matches every query entry", () => {
    expect(filterTags(tags, ["#admin"])).toEqual(["#admin"]);
    expect(filterTags(tags, ["#nope"])).toEqual([]);
    expect(filterTags(tags, [])).toEqual(tags);
    // Normalize input
    expect(filterTags(tags, ["Admin"])).toEqual(["#admin"]);
  });

  test("searchTagsByName matches by name prefix", () => {
    expect(searchTagsByName(tags, "deep")).toEqual(["#deep-work"]);
    expect(searchTagsByName(tags, "#admin")).toEqual(["#admin"]);
    expect(searchTagsByName(tags, "deadline")).toEqual(["#deadline:2026-05-01"]);
  });
});
