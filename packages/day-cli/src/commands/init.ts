import type { Command } from "../cli/command";
import { placeholderRun } from "./_placeholder";

export const initCommand: Command = {
  name: "init",
  summary: "initialize the local scaffold-day directory and config",
  help: {
    what: "Create ~/scaffold-day/ with the Balanced policy preset, an empty days/ tree, and an empty todos/ tree. Optionally connect Google Calendar and pick a primary AI provider.",
    when: "Run once after installing scaffold-day. Required before any other command can read or write data.",
    cost: "Local file I/O only by default. Opting in to Google Calendar adds an OAuth flow that opens a browser tab.",
    input: "(no positional args yet) [--no-browser] [--force]",
    return: "Exit 0 on success. Prints the path of ~/scaffold-day/ and the next-step suggestions.",
    gotcha: "Refuses to run if ~/scaffold-day/ already exists, unless --force is given (which backs up first). Tracking SLICES.md §S29.5.",
  },
  run: placeholderRun("init", "SLICES.md §S29.5"),
};
