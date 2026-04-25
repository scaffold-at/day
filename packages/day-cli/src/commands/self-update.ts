import type { Command } from "../cli/command";
import { placeholderRun } from "./_placeholder";

export const selfUpdateCommand: Command = {
  name: "self-update",
  summary: "check for and install a newer scaffold-day binary",
  help: {
    what: "Resolve the latest scaffold-day release from scaffold.at/day/latest, verify the SHA-256, and replace the running binary. Auto-update is OFF by default; this command is the only path.",
    when: "Periodically, or when release notes mention a fix you need.",
    cost: "One HTTPS GET to the latest pointer plus a binary download (~60 MB). No telemetry.",
    input: "[--check] check only, no install. [--rollback] revert to the previous binary.",
    return: "Exit 0 with the new version printed. Exit non-zero with a clear cause/try/docs block on failure.",
    gotcha: "Refuses to run if launched from a package manager path (Homebrew, etc.) where you should update via that manager. Tracking SLICES.md §S47.",
  },
  run: placeholderRun("self-update", "SLICES.md §S47"),
};
