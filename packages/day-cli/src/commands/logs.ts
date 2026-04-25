import type { Command } from "../cli/command";
import { placeholderRun } from "./_placeholder";

export const logsCommand: Command = {
  name: "logs",
  summary: "tail or query scaffold-day operational logs",
  help: {
    what: "Read logs/YYYY-MM/{placements,conflicts,user-decisions}.jsonl with simple filters. Outputs JSON Lines or formatted lines.",
    when: "When debugging an unexpected placement, conflict resolution, or sync event.",
    cost: "Local read only. Streams; bounded by disk and stdout speed.",
    input: "[--since <duration>] [--kind placement|conflict|decision] [--json] [--follow]",
    return: "JSON Lines on stdout (one event per line) when --json, otherwise human-formatted lines.",
    gotcha: "Logs never contain TODO content (that lives in todos/active/detail/). Tracking SLICES.md §S25 (placement log) and §S2 (entrypoint).",
  },
  run: placeholderRun("logs", "SLICES.md §S25 / §S2"),
};
