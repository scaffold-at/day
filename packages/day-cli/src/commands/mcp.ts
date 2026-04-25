import type { Command } from "../cli/command";
import { placeholderRun } from "./_placeholder";

export const mcpCommand: Command = {
  name: "mcp",
  summary: "run the scaffold-day MCP server over stdio",
  help: {
    what: "Speak the Model Context Protocol over stdin/stdout so an AI client (Claude Desktop, Cursor, etc.) can call scaffold-day tools.",
    when: "Started by the AI client, not by hand. You only run this directly when debugging.",
    cost: "Long-running process while the client stays connected; near-zero CPU when idle.",
    input: "[--name <id>] when registering with the client. [--log-level <level>] for stderr noise.",
    return: "Streams MCP JSON-RPC on stdin/stdout until the client disconnects. Exit 0 on clean shutdown.",
    gotcha: "Logs MUST go to stderr — stdout is reserved for protocol bytes. Tracking SLICES.md §S41.",
  },
  run: placeholderRun("mcp", "SLICES.md §S41"),
};
