/**
 * Shape of every scaffold-day command.
 *
 * The 6-section help (`HelpDoc`) is intentionally rigid: every command must
 * answer the same six questions so AI clients and humans get a predictable
 * description surface. S2.5 adds runtime + CI validation of this contract.
 */

export type HelpDoc = {
  /** One paragraph: what does this command do? */
  what: string;
  /** One paragraph: when should the caller reach for it? */
  when: string;
  /** One paragraph: I/O cost (local read/write, network, tokens, time). */
  cost: string;
  /** Flags / positional args summary. */
  input: string;
  /** Exit codes and shape of stdout/stderr. */
  return: string;
  /** Surprising behavior, footguns, gotchas. */
  gotcha: string;
};

export type Command = {
  /** Subcommand name as the user types it. */
  name: string;
  /** One-line summary shown in the root `--help` listing. */
  summary: string;
  /** Full 6-section help shown on `<command> --help`. */
  help: HelpDoc;
  /** Run with the args after the command name. Returns exit code. */
  run(args: string[]): Promise<number> | number;
};
