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
      expect(names).toContain("health");
      const health = list.tools.find((t) => t.name === "health")!;
      expect(typeof health.description).toBe("string");
      expect(health.description.length).toBeGreaterThan(20);
      expect(health.inputSchema.type).toBe("object");
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
