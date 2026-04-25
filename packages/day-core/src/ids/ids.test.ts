import { describe, expect, test } from "bun:test";
import {
  ENTITY_ID_REGEX,
  ENTITY_PREFIXES,
  type EntityKind,
  EntityIdSchema,
  entityIdSchemaOf,
  generateEntityId,
  ISODateSchema,
  ISODateTimeSchema,
  ISOTimeSchema,
  KnownEntityIdSchema,
  ModelIdSchema,
  TagSchema,
  YYYYMMSchema,
} from "./index";

describe("EntityId regex", () => {
  const valid = [
    "todo_01hf3k2mxzxxxx",
    "evt_01abcdefghi123",
    "plc_0000000000abcd",
    "cfl_zzzzzzzzzzzzzz",
    "adap_99999999999999",
  ];
  const invalid = [
    "todo_01HF3K2MXZxxxx", // uppercase forbidden
    "todo_short",
    "todo_01hf3k2mxzxxxxlong",
    "01hf3k2mxzxxxx", // no prefix
    "_01hf3k2mxzxxxx", // empty prefix
  ];

  test("accepts 5 valid examples", () => {
    for (const s of valid) {
      expect(ENTITY_ID_REGEX.test(s), s).toBe(true);
      expect(EntityIdSchema.safeParse(s).success, s).toBe(true);
    }
  });

  test("rejects 5 invalid examples", () => {
    for (const s of invalid) {
      expect(ENTITY_ID_REGEX.test(s), s).toBe(false);
      expect(EntityIdSchema.safeParse(s).success, s).toBe(false);
    }
  });

  test("KnownEntityIdSchema only accepts known prefixes", () => {
    expect(KnownEntityIdSchema.safeParse("todo_01hf3k2mxzxxxx").success).toBe(true);
    expect(KnownEntityIdSchema.safeParse("dft_01hf3k2mxzxxxx").success).toBe(true);
    // Generic prefix passes EntityIdSchema but not KnownEntityIdSchema.
    expect(EntityIdSchema.safeParse("xyz_01hf3k2mxzxxxx").success).toBe(true);
    expect(KnownEntityIdSchema.safeParse("xyz_01hf3k2mxzxxxx").success).toBe(false);
  });

  test("entityIdSchemaOf narrows to a specific kind", () => {
    const todoId = entityIdSchemaOf("todo");
    expect(todoId.safeParse("todo_01hf3k2mxzxxxx").success).toBe(true);
    expect(todoId.safeParse("evt_01hf3k2mxzxxxx").success).toBe(false);
  });
});

describe("generateEntityId", () => {
  test("produces a value matching the regex for every kind", () => {
    for (const kind of Object.keys(ENTITY_PREFIXES) as EntityKind[]) {
      const id = generateEntityId(kind);
      expect(ENTITY_ID_REGEX.test(id), `${kind} → ${id}`).toBe(true);
      expect(id.startsWith(`${ENTITY_PREFIXES[kind]}_`)).toBe(true);
    }
  });

  test("1000 todo ids are unique", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(generateEntityId("todo"));
    expect(set.size).toBe(1000);
  });

  test("encodes timestamp in lexicographic order", () => {
    const earlier = generateEntityId("todo", 1_700_000_000_000);
    const later = generateEntityId("todo", 1_800_000_000_000);
    expect(earlier < later).toBe(true);
  });
});

describe("ISODateSchema", () => {
  test.each([
    "2026-04-26",
    "2024-02-29", // leap year
    "1970-01-01",
    "9999-12-31",
    "2026-12-31",
  ])("accepts %s", (s) => {
    expect(ISODateSchema.safeParse(s).success).toBe(true);
  });

  test.each([
    "2026-4-26", // single-digit month
    "26-04-26", // 2-digit year
    "2026/04/26", // slashes
    "2026-13-01", // bad month
    "2026-02-30", // not a real day
  ])("rejects %s", (s) => {
    expect(ISODateSchema.safeParse(s).success).toBe(false);
  });
});

describe("ISOTimeSchema", () => {
  test.each(["09:30", "00:00", "23:59:59", "12:34:56"])("accepts %s", (s) => {
    expect(ISOTimeSchema.safeParse(s).success).toBe(true);
  });
  test.each(["24:00", "9:30", "23:60", "23:59:60", "abc"])("rejects %s", (s) => {
    expect(ISOTimeSchema.safeParse(s).success).toBe(false);
  });
});

describe("ISODateTimeSchema", () => {
  test.each([
    "2026-04-26T10:00:00Z",
    "2026-04-26T10:00:00.123Z",
    "2026-04-26T10:00:00+09:00",
    "2026-04-26T10:00:00-05:00",
    "2026-04-26T10:00:00+0900",
  ])("accepts %s", (s) => {
    expect(ISODateTimeSchema.safeParse(s).success).toBe(true);
  });

  test.each([
    "2026-04-26T10:00:00", // no TZ
    "2026-04-26 10:00:00Z", // space, not T
    "2026-04-26T10:00", // missing seconds
    "2026-04-26",
  ])("rejects %s", (s) => {
    expect(ISODateTimeSchema.safeParse(s).success).toBe(false);
  });
});

describe("YYYYMMSchema", () => {
  test.each(["2026-01", "2026-12", "1970-04"])("accepts %s", (s) => {
    expect(YYYYMMSchema.safeParse(s).success).toBe(true);
  });
  test.each(["2026-13", "2026-00", "26-04", "2026/04"])("rejects %s", (s) => {
    expect(YYYYMMSchema.safeParse(s).success).toBe(false);
  });
});

describe("TagSchema", () => {
  const valid = [
    "#call",
    "#deep-work",
    "#business-hours",
    "#deadline:2026-05-01",
    "#admin",
  ];
  const invalid = [
    "call", // no leading #
    "#Deep-work", // uppercase
    "#-foo", // starts with hyphen
    "#deadline:", // empty value
    "#", // empty body
  ];

  test("accepts 5 valid examples", () => {
    for (const t of valid) expect(TagSchema.safeParse(t).success, t).toBe(true);
  });
  test("rejects 5 invalid examples", () => {
    for (const t of invalid) expect(TagSchema.safeParse(t).success, t).toBe(false);
  });
});

describe("ModelIdSchema", () => {
  test.each([
    "claude-sonnet-4-5",
    "claude-opus-4-7",
    "anthropic/claude-opus-4-7",
    "gpt-4o",
    "llama3:8b",
  ])("accepts %s", (s) => {
    expect(ModelIdSchema.safeParse(s).success, s).toBe(true);
  });

  test.each([
    "Claude", // uppercase
    "", // empty
    "/foo", // starts with slash
    "model name", // space
    "1leading-digit", // doesn't start lowercase letter
  ])("rejects %s", (s) => {
    expect(ModelIdSchema.safeParse(s).success, s).toBe(false);
  });
});
