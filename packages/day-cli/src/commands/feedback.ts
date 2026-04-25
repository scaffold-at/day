import type { Command } from "../cli/command";
import { placeholderRun } from "./_placeholder";

export const feedbackCommand: Command = {
  name: "feedback",
  summary: "send anonymous feedback to the scaffold-day maintainers",
  help: {
    what: "Send a short anonymous note to the project maintainers. Optionally attaches the redacted output of `scaffold-day doctor` so the team can reproduce the context.",
    when: "When something is great, broken, surprising, or unclear — and you don't want to file a public issue.",
    cost: "One HTTPS POST to the project feedback endpoint. No tokens. No content beyond what you type.",
    input: "<message...> [--include-doctor] [--no-confirm]",
    return: "Exit 0 with a thank-you and a reference id on success.",
    gotcha: "Shows you the exact JSON before sending and waits for confirmation. Read it. Tracking SLICES.md §S2 (placeholder).",
  },
  run: placeholderRun("feedback", "SLICES.md §S2 (placeholder)"),
};
