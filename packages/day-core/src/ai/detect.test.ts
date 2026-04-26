import { describe, expect, test } from "bun:test";
import { detectAvailableProviders } from "./detect";
import { MockAIProvider } from "./mock-provider";

describe("detectAvailableProviders", () => {
  test("default candidates include claude-cli and mock", async () => {
    const results = await detectAvailableProviders();
    const ids = results.map((r) => r.id);
    expect(ids).toContain("claude-cli");
    expect(ids).toContain("mock");
  });

  test("mock is always available (default)", async () => {
    const results = await detectAvailableProviders();
    const mock = results.find((r) => r.id === "mock");
    expect(mock?.available).toBe(true);
    expect(mock?.capabilities?.tier).toBe(1);
  });

  test("claude-cli on a clean fork reports unavailable + a hint note", async () => {
    // We can't guarantee the host doesn't have claude installed, so
    // this test only checks that claude-cli's record exists. The
    // unavailable+note path is exercised when claude is absent.
    const results = await detectAvailableProviders();
    const claude = results.find((r) => r.id === "claude-cli");
    expect(claude).toBeDefined();
    if (claude && !claude.available) {
      expect(claude.note).toContain("PATH");
    }
  });

  test("custom candidates override the default catalog", async () => {
    const results = await detectAvailableProviders({
      candidates: [new MockAIProvider({ id: "alpha" }), new MockAIProvider({ id: "beta", available: false })],
      includeMock: false,
    });
    expect(results.map((r) => r.id)).toEqual(["alpha", "beta"]);
    expect(results[0]?.available).toBe(true);
    expect(results[1]?.available).toBe(false);
  });

  test("includeMock: false drops the default mock from the catalog", async () => {
    const results = await detectAvailableProviders({ includeMock: false });
    expect(results.map((r) => r.id)).toEqual(["claude-cli"]);
  });
});
