import type { Command } from "../cli/command";
import { placeholderRun } from "./_placeholder";

export const telemetryCommand: Command = {
  name: "telemetry",
  summary: "inspect or change opt-in heartbeat telemetry preferences",
  help: {
    what: "Read or set the telemetry preference. Telemetry, if on, sends an anonymous install_id and event-kind counters only — never TODO or calendar content.",
    when: "Whenever you want to opt in, opt out, or check the current state.",
    cost: "Local config write only. The first heartbeat (after opt-in) is one HTTPS POST.",
    input: "on | off | ask | status",
    return: "Exit 0 with the new state printed.",
    gotcha: "Default is 'ask' on first run — nothing is sent until you actively opt in. Tracking SLICES.md §S45.",
  },
  run: placeholderRun("telemetry", "SLICES.md §S45"),
};
