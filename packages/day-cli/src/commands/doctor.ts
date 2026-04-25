import type { Command } from "../cli/command";
import { placeholderRun } from "./_placeholder";

export const doctorCommand: Command = {
  name: "doctor",
  summary: "diagnose the local install, adapters, and AI providers",
  help: {
    what: "Inspect ~/scaffold-day/ permissions, schema version, advisory lock state, connected adapters (e.g. Google Calendar), and configured AI providers. Reports per-section status with a `cause / try / docs` block on every failure.",
    when: "When something feels wrong, before reporting a bug, or after a self-update.",
    cost: "Local checks plus one light ping per adapter and AI provider. No data mutation.",
    input: "[--json] for machine output. [--section <name>] to scope the run.",
    return: "Exit 0 if all sections green. Non-zero with a structured report on failure.",
    gotcha: "Strictly read-only. Tracking SLICES.md §S35.",
  },
  run: placeholderRun("doctor", "SLICES.md §S35"),
};
