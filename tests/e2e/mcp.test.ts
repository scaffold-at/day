import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupHome, makeTmpHome } from "./_helpers";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(HERE, "../../packages/day-cli/src/index.ts");

async function connectClient(home: string): Promise<{ client: Client; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command: "bun",
    args: [CLI_PATH, "mcp"],
    env: {
      ...(process.env as Record<string, string>),
      SCAFFOLD_DAY_HOME: home,
      NO_COLOR: "1",
    },
  });
  const client = new Client(
    { name: "scaffold-day-test", version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await client.close();
    },
  };
}

let home: string;
beforeEach(async () => {
  home = await makeTmpHome();
});
afterEach(async () => {
  await cleanupHome(home);
});

describe("MCP server scaffold (S41)", () => {
  test("initialize handshake + tools/list returns the registered tools", async () => {
    const { client, close } = await connectClient(home);
    try {
      const list = await client.listTools();
      const names = list.tools.map((t) => t.name);
      // §S41: health
      expect(names).toContain("health");
      // §S42: 5 P0 tools
      expect(names).toContain("get_day");
      expect(names).toContain("query_todos");
      expect(names).toContain("create_todo");
      expect(names).toContain("suggest_placement");
      expect(names).toContain("place_todo");
      const health = list.tools.find((t) => t.name === "health")!;
      expect(typeof health.description).toBe("string");
      expect(health.description.length).toBeGreaterThan(20);
      expect(health.inputSchema.type).toBe("object");
    } finally {
      await close();
    }
  });

  test("create_todo + query_todos round-trip via MCP", async () => {
    const { client, close } = await connectClient(home);
    try {
      const created = await client.callTool({
        name: "create_todo",
        arguments: { title: "S42 todo", tags: ["#deep-work"], duration_min: 60 },
      });
      const detail = JSON.parse((created.content as Array<{ text: string }>)[0]!.text);
      expect(detail.id).toMatch(/^todo_[a-z0-9]{14}$/);
      expect(detail.title).toBe("S42 todo");

      const queryRes = await client.callTool({ name: "query_todos", arguments: {} });
      const list = JSON.parse((queryRes.content as Array<{ text: string }>)[0]!.text);
      expect(list.total).toBe(1);
      expect(list.items[0].id).toBe(detail.id);
    } finally {
      await close();
    }
  });

  test("get_day returns DayView with free_slots[]", async () => {
    const { client, close } = await connectClient(home);
    try {
      const res = await client.callTool({
        name: "get_day",
        arguments: { date: "2026-04-27", tz: "Asia/Seoul" },
      });
      const view = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
      expect(view.date).toBe("2026-04-27");
      expect(view.tz).toBe("Asia/Seoul");
      expect(Array.isArray(view.free_slots)).toBe(true);
      expect(view.summary.events_count).toBe(0);
    } finally {
      await close();
    }
  });

  test("suggest_placement + place_todo lifecycle via MCP", async () => {
    const { runCli } = await import("./_helpers");
    await runCli(["policy", "preset", "apply", "balanced"], { home });

    const { client, close } = await connectClient(home);
    try {
      const created = await client.callTool({
        name: "create_todo",
        arguments: { title: "S42 ranked", tags: ["#deep-work"], duration_min: 60 },
      });
      const detail = JSON.parse((created.content as Array<{ text: string }>)[0]!.text);

      const sug = await client.callTool({
        name: "suggest_placement",
        arguments: { todo_id: detail.id, date: "2026-04-27", within: 1, max: 3 },
      });
      const suggestion = JSON.parse((sug.content as Array<{ text: string }>)[0]!.text);
      expect(suggestion.candidates.length).toBeGreaterThan(0);

      const placeRes = await client.callTool({
        name: "place_todo",
        arguments: { todo_id: detail.id, slot: suggestion.candidates[0].start },
      });
      const placement = JSON.parse((placeRes.content as Array<{ text: string }>)[0]!.text);
      expect(placement.id).toMatch(/^plc_[a-z0-9]{14}$/);
      expect(placement.todo_id).toBe(detail.id);
      expect(placement.placed_by).toBe("ai");
      expect(placement.policy_hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await close();
    }
  });

  test("tools/call health returns home + schema_version + policy_present", async () => {
    const { client, close } = await connectClient(home);
    try {
      const res = await client.callTool({ name: "health", arguments: {} });
      // Either content[0].text (JSON) or structuredContent
      const structured = res.structuredContent as Record<string, unknown> | undefined;
      const payload = structured ?? JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
      expect(payload.home).toBe(home);
      expect(payload.home_exists).toBe(true);
      expect(payload.schema_version).toBe("0.1.0"); // makeTmpHome seeded this
      expect(payload.policy_present).toBe(false); // we did not preset apply
    } finally {
      await close();
    }
  });

  test("health reflects policy presence after `policy preset apply`", async () => {
    // Seed the policy via a one-shot CLI invocation (out of band).
    const { runCli } = await import("./_helpers");
    const seed = await runCli(["policy", "preset", "apply", "balanced"], { home });
    expect(seed.exitCode).toBe(0);

    const { client, close } = await connectClient(home);
    try {
      const res = await client.callTool({ name: "health", arguments: {} });
      const structured = res.structuredContent as Record<string, unknown> | undefined;
      const payload = structured ?? JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
      expect(payload.policy_present).toBe(true);
    } finally {
      await close();
    }
  });

  test("tools/call on an unknown tool surfaces a JSON-RPC InvalidParams error", async () => {
    const { client, close } = await connectClient(home);
    try {
      let caught: unknown;
      try {
        await client.callTool({ name: "nope", arguments: {} });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const e = caught as { code?: number; message?: string };
      expect(e.code).toBe(-32602); // InvalidParams (DAY_USAGE → InvalidParams per error-mapping)
      expect(e.message).toContain("unknown tool 'nope'");
    } finally {
      await close();
    }
  });

  test("tools/call with invalid arguments surfaces an InvalidParams error", async () => {
    const { client, close } = await connectClient(home);
    try {
      let caught: unknown;
      try {
        // health takes no arguments — pass an extra to trigger strict-zod failure.
        await client.callTool({ name: "health", arguments: { mystery: 1 } });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const e = caught as { code?: number; message?: string };
      expect(e.code).toBe(-32602); // InvalidParams (DAY_INVALID_INPUT → InvalidParams)
      expect(e.message).toMatch(/invalid arguments/i);
    } finally {
      await close();
    }
  });
});

describe("MCP morning anchor tools (S60)", () => {
  test("record_morning + get_morning_anchor round-trip", async () => {
    const { client, close } = await connectClient(home);
    try {
      // Pre-state: no anchor.
      const before = await client.callTool({ name: "get_morning_anchor", arguments: {} });
      const beforePayload =
        (before.structuredContent as Record<string, unknown> | undefined) ??
        JSON.parse((before.content as Array<{ text: string }>)[0]!.text);
      expect(beforePayload.anchor).toBeNull();

      // Record explicit.
      const rec = await client.callTool({
        name: "record_morning",
        arguments: { at: "2026-04-28T08:00:00+09:00" },
      });
      const recPayload =
        (rec.structuredContent as Record<string, unknown> | undefined) ??
        JSON.parse((rec.content as Array<{ text: string }>)[0]!.text);
      expect(recPayload.recorded).toBe(true);
      expect(recPayload.was_already_set).toBe(false);
      expect(recPayload.source).toBe("manual");

      // Read back. Pass the recorded date explicitly so the lookup
      // doesn't depend on the test machine's wall clock.
      const after = await client.callTool({
        name: "get_morning_anchor",
        arguments: { date: "2026-04-28" },
      });
      const afterPayload =
        (after.structuredContent as Record<string, unknown> | undefined) ??
        JSON.parse((after.content as Array<{ text: string }>)[0]!.text);
      expect(afterPayload.anchor).toBe("2026-04-28T08:00:00+09:00");
      expect(afterPayload.source).toBe("manual");

      // Second record without force is a no-op.
      const second = await client.callTool({
        name: "record_morning",
        arguments: { at: "2026-04-28T09:00:00+09:00" },
      });
      const secondPayload =
        (second.structuredContent as Record<string, unknown> | undefined) ??
        JSON.parse((second.content as Array<{ text: string }>)[0]!.text);
      expect(secondPayload.was_already_set).toBe(true);
      expect(secondPayload.recorded).toBe(false);
    } finally {
      await close();
    }
  });
});
