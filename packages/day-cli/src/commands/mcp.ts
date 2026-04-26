import { runMcpServer } from "@scaffold/day-mcp";
import pkg from "../../package.json" with { type: "json" };
import type { Command } from "../cli/command";

export const mcpCommand: Command = {
  name: "mcp",
  summary: "run the scaffold-day MCP server over stdio",
  help: {
    what: "Speak the Model Context Protocol over stdin/stdout so an AI client (Claude Desktop, Cursor, etc.) can call scaffold-day tools. Currently registers `health`; the rest of the P0 surface lands in §S42–§S43d.",
    when: "Started by the AI client, not by hand. You only run this directly when debugging.",
    cost: "Long-running process while the client stays connected; near-zero CPU when idle.",
    input: "(no flags in v0.1)",
    return: "Streams MCP JSON-RPC on stdin/stdout until the client disconnects. Exit 0 on clean shutdown.",
    gotcha: "Logs MUST go to stderr — stdout is reserved for protocol bytes. Tracking SLICES.md §S41 (scaffold) / §S42–§S43d (full tool surface) / §S44 (token meter).",
  },
  run: async () => {
    await runMcpServer({ version: pkg.version });
    return 0;
  },
};
