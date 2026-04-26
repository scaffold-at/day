import { describe, expect, test } from "bun:test";
import { isScaffoldError } from "../error";
import {
  type AIProvider,
  MockAIProvider,
  ProviderCapabilitiesSchema,
  ProviderRegistry,
  validateImportanceDimensions,
} from "./index";

describe("ProviderCapabilitiesSchema", () => {
  test("accepts a sane Tier-1 mock capabilities object", () => {
    const sample = {
      supports_classification: true,
      supports_importance: true,
      approx_context_window: 200_000,
      approx_cost_per_call: "zero",
      tier: 1,
    };
    expect(ProviderCapabilitiesSchema.safeParse(sample).success).toBe(true);
  });

  test("rejects unknown tier / cost", () => {
    expect(
      ProviderCapabilitiesSchema.safeParse({
        supports_classification: true,
        supports_importance: true,
        approx_context_window: 8000,
        approx_cost_per_call: "free",
        tier: 5,
      }).success,
    ).toBe(false);
  });
});

describe("MockAIProvider", () => {
  test("default fixture: available=true, neutral importance, uniform classification", async () => {
    const p = new MockAIProvider();
    expect(p.id).toBe("mock");
    expect(await p.available()).toBe(true);

    const caps = p.capabilities();
    expect(caps.tier).toBe(1);
    expect(caps.approx_cost_per_call).toBe("zero");

    const imp = await p.scoreImportance({ title: "x" });
    expect(imp.urgency).toBe(5);
    expect(imp.deadline).toBe("none");
    expect(imp.computed_by).toBe("mock");
    // Cross-check that the AI-returned dimensions still parse through the
    // canonical ImportanceDimensions schema (drop the AI-only metadata).
    const { reasoning: _r, computed_by: _c, ...dimsOnly } = imp;
    const validated = validateImportanceDimensions(dimsOnly);
    expect(validated.urgency).toBe(5);

    const cls = await p.classifyEvent(
      { title: "y", start: "2026-04-26T10:00:00+09:00", end: "2026-04-26T11:00:00+09:00" },
      ["meeting", "deep-work", "admin"],
    );
    expect(Object.keys(cls.scores).sort()).toEqual(["admin", "deep-work", "meeting"]);
    for (const v of Object.values(cls.scores)) expect(v).toBeCloseTo(1 / 3, 5);
  });

  test("fixture overrides importance and classification", async () => {
    const p = new MockAIProvider({
      importance: { urgency: 9, impact: 8, deadline: "hard" },
      classification: {
        scores: { meeting: 0.9, "deep-work": 0.1 },
        reasoning: "deterministic",
        computed_by: "mock-fixture",
      },
    });
    const imp = await p.scoreImportance({ title: "x" });
    expect(imp.urgency).toBe(9);
    expect(imp.impact).toBe(8);
    expect(imp.deadline).toBe("hard");
    expect(imp.effort).toBe(5); // default fills

    const cls = await p.classifyEvent(
      { title: "y", start: "2026-04-26T10:00:00+09:00", end: "2026-04-26T11:00:00+09:00" },
      ["meeting", "deep-work"],
    );
    expect(cls.scores.meeting).toBe(0.9);
    expect(cls.computed_by).toBe("mock-fixture");
  });

  test("fixture available=false flips availability", async () => {
    const p = new MockAIProvider({ available: false, id: "mock-down" });
    expect(p.id).toBe("mock-down");
    expect(await p.available()).toBe(false);
  });

  test("empty category list classification returns empty scores", async () => {
    const p = new MockAIProvider();
    const cls = await p.classifyEvent(
      { title: "x", start: "2026-04-26T10:00:00+09:00", end: "2026-04-26T11:00:00+09:00" },
      [],
    );
    expect(cls.scores).toEqual({});
  });
});

describe("ProviderRegistry", () => {
  function makeRegistry(): ProviderRegistry {
    return new ProviderRegistry();
  }

  test("register / get / list / unregister", () => {
    const reg = makeRegistry();
    const p1 = new MockAIProvider({ id: "a" });
    const p2 = new MockAIProvider({ id: "b" });
    reg.register(p1).register(p2);
    expect(reg.list().map((p) => p.id)).toEqual(["a", "b"]);
    expect(reg.get("a")).toBe(p1);
    expect(reg.get("c")).toBeUndefined();
    expect(reg.unregister("a")).toBe(true);
    expect(reg.unregister("a")).toBe(false);
    expect(reg.list().map((p) => p.id)).toEqual(["b"]);
  });

  test("duplicate registration throws", () => {
    const reg = makeRegistry();
    reg.register(new MockAIProvider({ id: "x" }));
    expect(() => reg.register(new MockAIProvider({ id: "x" }))).toThrow(
      /already registered/,
    );
  });

  test("availableProviders filters by available()", async () => {
    const reg = makeRegistry();
    reg
      .register(new MockAIProvider({ id: "down", available: false }))
      .register(new MockAIProvider({ id: "up" }));
    const ok = await reg.availableProviders();
    expect(ok.map((p) => p.id)).toEqual(["up"]);
  });

  test("resolve(primary) returns the named provider when available", async () => {
    const reg = makeRegistry();
    reg.register(new MockAIProvider({ id: "alpha" }));
    const p = await reg.resolve("alpha");
    expect(p.id).toBe("alpha");
  });

  test("resolve(primary) on unknown id throws DAY_PROVIDER_UNAVAILABLE", async () => {
    const reg = makeRegistry();
    let caught: unknown;
    try {
      await reg.resolve("nope");
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_PROVIDER_UNAVAILABLE");
  });

  test("resolve(primary) on unavailable provider throws DAY_PROVIDER_UNAVAILABLE", async () => {
    const reg = makeRegistry();
    reg.register(new MockAIProvider({ id: "down", available: false }));
    let caught: unknown;
    try {
      await reg.resolve("down");
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_PROVIDER_UNAVAILABLE");
  });

  test("resolve() with no primary picks first available in registration order", async () => {
    const reg = makeRegistry();
    reg
      .register(new MockAIProvider({ id: "down", available: false }))
      .register(new MockAIProvider({ id: "up-1" }))
      .register(new MockAIProvider({ id: "up-2" }));
    const p = await reg.resolve();
    expect(p.id).toBe("up-1");
  });

  test("resolve() with empty / all-unavailable registry throws", async () => {
    const empty = makeRegistry();
    let caught: unknown;
    try {
      await empty.resolve();
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_PROVIDER_UNAVAILABLE");

    const allDown = makeRegistry();
    allDown
      .register(new MockAIProvider({ id: "x", available: false }))
      .register(new MockAIProvider({ id: "y", available: false }));
    let caught2: unknown;
    try {
      await allDown.resolve();
    } catch (err) {
      caught2 = err;
    }
    expect(isScaffoldError(caught2)).toBe(true);
  });
});

describe("AIProvider interface — typecheck via assignment", () => {
  test("MockAIProvider conforms to AIProvider", () => {
    const p: AIProvider = new MockAIProvider();
    expect(p.id).toBe("mock");
  });
});
