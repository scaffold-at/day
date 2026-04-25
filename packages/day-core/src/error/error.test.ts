import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DAY_CODE_CATALOG,
  detectLocale,
  formatErrorJson,
  formatErrorText,
  isDayCode,
  isScaffoldError,
  ScaffoldError,
} from "./index";

const sampleSpec = {
  code: "DAY_USAGE",
  summary: { en: "unknown command 'foo'", ko: "알 수 없는 명령 'foo'" },
  cause: "scaffold-day does not have a command named 'foo'.\nIt was not registered in the CLI command registry.",
  try: [
    "Run `scaffold-day --help` to list available commands.",
    "Check the spelling — commands are lower-case kebab-case.",
  ],
  context: { typed: "foo", at: "argv[2]" },
} as const;

describe("DAY_CODE_CATALOG", () => {
  test("every entry has a default exit code in [2, 255]", () => {
    for (const [code, meta] of Object.entries(DAY_CODE_CATALOG)) {
      expect(meta.defaultExitCode, code).toBeGreaterThanOrEqual(1);
      expect(meta.defaultExitCode, code).toBeLessThanOrEqual(255);
    }
  });

  test("isDayCode narrows known codes", () => {
    expect(isDayCode("DAY_USAGE")).toBe(true);
    expect(isDayCode("NOT_A_CODE")).toBe(false);
  });

  test("baseline codes are present", () => {
    for (const code of [
      "DAY_USAGE",
      "DAY_NOT_INITIALIZED",
      "DAY_INTERNAL",
      "DAY_SCHEMA_FUTURE_VERSION",
    ]) {
      expect(code in DAY_CODE_CATALOG, code).toBe(true);
    }
  });
});

describe("ScaffoldError", () => {
  test("constructs with default exit code from catalog", () => {
    const err = new ScaffoldError(sampleSpec);
    expect(err.code).toBe("DAY_USAGE");
    expect(err.exitCode).toBe(DAY_CODE_CATALOG.DAY_USAGE.defaultExitCode);
    expect(err.message).toBe(sampleSpec.summary.en);
    expect(err.try).toEqual(sampleSpec.try);
    expect(err.context).toEqual(sampleSpec.context);
  });

  test("docs falls back to catalog default when not specified", () => {
    const err = new ScaffoldError(sampleSpec);
    expect(err.docs).toBe(DAY_CODE_CATALOG.DAY_USAGE.defaultDocs);
  });

  test("explicit exitCode overrides the catalog default", () => {
    const err = new ScaffoldError({ ...sampleSpec, exitCode: 99 });
    expect(err.exitCode).toBe(99);
  });

  test("isScaffoldError narrows", () => {
    expect(isScaffoldError(new ScaffoldError(sampleSpec))).toBe(true);
    expect(isScaffoldError(new Error("plain"))).toBe(false);
    expect(isScaffoldError(undefined)).toBe(false);
  });

  test("try is frozen — push throws", () => {
    const err = new ScaffoldError(sampleSpec);
    expect(() => (err.try as string[]).push("mutate")).toThrow();
  });

  test("localizedSummary picks ko when available, falls back to en otherwise", () => {
    const err = new ScaffoldError(sampleSpec);
    expect(err.localizedSummary("ko")).toBe(sampleSpec.summary.ko);
    expect(err.localizedSummary("en")).toBe(sampleSpec.summary.en);

    const enOnly = new ScaffoldError({
      ...sampleSpec,
      summary: { en: "english only" },
    });
    expect(enOnly.localizedSummary("ko")).toBe("english only");
  });
});

describe("detectLocale", () => {
  test("LANG=ko_KR.UTF-8 → ko", () => {
    expect(detectLocale({ LANG: "ko_KR.UTF-8" })).toBe("ko");
  });

  test("LC_MESSAGES wins over LANG, LC_ALL wins over both", () => {
    expect(
      detectLocale({ LANG: "en_US.UTF-8", LC_MESSAGES: "ko_KR" }),
    ).toBe("ko");
    expect(
      detectLocale({ LANG: "ko_KR", LC_ALL: "en_US.UTF-8" }),
    ).toBe("en");
  });

  test("unknown / missing → en", () => {
    expect(detectLocale({})).toBe("en");
    expect(detectLocale({ LANG: "fr_FR.UTF-8" })).toBe("en");
  });
});

describe("formatErrorText", () => {
  let err: ScaffoldError;
  beforeEach(() => {
    err = new ScaffoldError(sampleSpec);
  });

  test("starts with the code + localized summary", () => {
    const out = formatErrorText(err, { locale: "ko" });
    expect(out.split("\n")[0]).toBe(`DAY_USAGE: ${sampleSpec.summary.ko}`);
  });

  test("contains CAUSE / TRY / DOCS section labels in order", () => {
    const out = formatErrorText(err, { locale: "en" });
    const causeIdx = out.indexOf("\nCAUSE\n");
    const tryIdx = out.indexOf("\nTRY\n");
    const docsIdx = out.indexOf("\nDOCS\n");
    expect(causeIdx).toBeGreaterThan(-1);
    expect(tryIdx).toBeGreaterThan(causeIdx);
    expect(docsIdx).toBeGreaterThan(tryIdx);
  });

  test("each TRY remediation appears as a bullet", () => {
    const out = formatErrorText(err, { locale: "en" });
    for (const step of sampleSpec.try) {
      expect(out).toContain(`• ${step}`);
    }
  });

  test("emits no ANSI escape sequences (NO_COLOR-safe)", () => {
    const out = formatErrorText(err, { locale: "en" });
    expect(out.includes("\x1b[")).toBe(false);
  });

  test("omits DOCS section when neither instance nor catalog provides a URL", () => {
    const noDefaultDocs = new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "bad input" },
      cause: "x",
      try: [],
    });
    expect(noDefaultDocs.docs).toBeUndefined();
    expect(formatErrorText(noDefaultDocs, { locale: "en" })).not.toContain("DOCS");
  });
});

describe("formatErrorJson", () => {
  test("produces a stable shape with code, summary, cause, try, context, exit_code", () => {
    const err = new ScaffoldError(sampleSpec);
    const json = formatErrorJson(err);
    expect(json).toEqual({
      error: {
        code: "DAY_USAGE",
        summary: { en: sampleSpec.summary.en, ko: sampleSpec.summary.ko },
        cause: sampleSpec.cause,
        try: sampleSpec.try,
        docs: DAY_CODE_CATALOG.DAY_USAGE.defaultDocs,
        context: sampleSpec.context,
      },
      exit_code: DAY_CODE_CATALOG.DAY_USAGE.defaultExitCode,
    });
  });

  test("omits docs key when error has no docs", () => {
    const err = new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "bad input" },
      cause: "x",
      try: [],
    });
    const json = formatErrorJson(err);
    expect("docs" in json.error).toBe(false);
  });
});
