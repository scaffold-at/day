import type { Command } from "../cli/command";
import { placeholderRun } from "./_placeholder";

export const rebuildIndexCommand: Command = {
  name: "rebuild-index",
  summary: "rebuild local indexes from source-of-truth files",
  help: {
    what: "Recompute todos/active/index.json and days/YYYY-MM/manifest.json from per-entity files. Useful after a manual edit, a partial restore, or when `doctor` flags index drift.",
    when: "After hand-editing files under ~/scaffold-day/, after a `restore`, or when `doctor` reports inconsistency.",
    cost: "Reads every TODO and day file once. Bound by disk speed; typically sub-second for normal corpora.",
    input: "[--dry-run] preview changes only. [--scope todos|days] limit which index to rebuild.",
    return: "Exit 0 with counts of rebuilt indexes. Exit non-zero if a source file fails to parse.",
    gotcha: "Holds the advisory lock for the duration. Cannot run while the MCP server is active. Tracking SLICES.md §S2 (placeholder).",
  },
  run: placeholderRun("rebuild-index", "SLICES.md §S2 (placeholder)"),
};
