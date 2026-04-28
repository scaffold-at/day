import { createInterface } from "node:readline/promises";
import os from "node:os";
import {
  compilePolicy,
  defaultHomeDir,
  detectAvailableProviders,
  pathExists,
  readAnchorForDate,
  readOrCreateInstallId,
  readPolicyYaml,
  readSchemaVersionFile,
  ScaffoldError,
  schemaVersionPath,
  todayInTz,
} from "@scaffold/day-core";
import pkg from "../../package.json" with { type: "json" };
import type { Command } from "../cli/command";
import { emitDryRun, isDryRun } from "../cli/runtime";

const FEEDBACK_URL_ENV = "SCAFFOLD_DAY_FEEDBACK_URL";
const MAX_MESSAGE_BYTES = 1024;

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day feedback --help`.",
    try: ["Run `scaffold-day feedback --help`."],
  });
}

type RedactedDoctorBundle = {
  scaffold_day_version: string;
  bun_version: string;
  platform: string;
  arch: string;
  data_schema: string | null;
  initialized_by: string | null;
  last_seen_binary_version: string | null;
  policy_present: boolean;
  policy_fields: {
    sleep_budget_set: boolean;
    cognitive_load_set: boolean;
    recovery_block_set: boolean;
    working_hours_count: number;
    protected_ranges_count: number;
  };
  providers: Array<{ id: string; available: boolean }>;
  anchor: { source: "explicit" | "manual" | "auto" | "none"; today: string } | null;
};

async function buildRedactedDoctorBundle(home: string): Promise<RedactedDoctorBundle> {
  let dataSchema: string | null = null;
  let initialized: string | null = null;
  let lastSeen: string | null = null;
  if (await pathExists(schemaVersionPath(home))) {
    try {
      const file = await readSchemaVersionFile(home);
      dataSchema = file.schema_version;
      initialized = file.scaffold_day_version;
      lastSeen = file.last_seen_binary_version ?? null;
    } catch {
      // tolerate
    }
  }

  let policyPresent = false;
  const policyFields = {
    sleep_budget_set: false,
    cognitive_load_set: false,
    recovery_block_set: false,
    working_hours_count: 0,
    protected_ranges_count: 0,
  };
  let tz = "UTC";
  try {
    const yaml = await readPolicyYaml(home);
    if (yaml) {
      policyPresent = true;
      const p = compilePolicy(yaml);
      tz = p.context?.tz ?? "UTC";
      policyFields.sleep_budget_set = p.context?.sleep_budget !== undefined;
      policyFields.cognitive_load_set = p.context?.cognitive_load !== undefined;
      policyFields.recovery_block_set = p.context?.recovery_block !== undefined;
      policyFields.working_hours_count = p.context?.working_hours.length ?? 0;
      policyFields.protected_ranges_count = p.context?.protected_ranges.length ?? 0;
    }
  } catch {
    // tolerate
  }

  let providers: Array<{ id: string; available: boolean }> = [];
  try {
    const probes = await detectAvailableProviders();
    providers = probes.map((p) => ({ id: p.id, available: p.available }));
  } catch {
    providers = [];
  }

  let anchor: RedactedDoctorBundle["anchor"] = null;
  try {
    const today = todayInTz(tz);
    const hb = await readAnchorForDate(home, today);
    anchor = hb ? { source: hb.source, today } : { source: "none", today };
  } catch {
    // tolerate
  }

  return {
    scaffold_day_version: pkg.version,
    bun_version: typeof Bun !== "undefined" ? Bun.version : "unknown",
    platform: os.platform(),
    arch: os.arch(),
    data_schema: dataSchema,
    initialized_by: initialized,
    last_seen_binary_version: lastSeen,
    policy_present: policyPresent,
    policy_fields: policyFields,
    providers,
    anchor,
  };
}

type Options = {
  message: string;
  includeDoctor: boolean;
  noConfirm: boolean;
  json: boolean;
};

function parseArgs(args: string[]): Options {
  const opts: Options = {
    message: "",
    includeDoctor: false,
    noConfirm: false,
    json: false,
  };
  const positional: string[] = [];
  for (const a of args) {
    if (a === "--include-doctor") opts.includeDoctor = true;
    else if (a === "--no-confirm") opts.noConfirm = true;
    else if (a === "--json") opts.json = true;
    else if (a.startsWith("--")) throw usage(`feedback: unknown option '${a}'`);
    else positional.push(a);
  }
  opts.message = positional.join(" ").trim();
  if (opts.message.length === 0) {
    throw usage('feedback: <message> is required (e.g. `feedback "this command is confusing"`)');
  }
  if (Buffer.byteLength(opts.message, "utf8") > MAX_MESSAGE_BYTES) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `feedback message exceeds ${MAX_MESSAGE_BYTES} bytes` },
      cause: `Got: ${Buffer.byteLength(opts.message, "utf8")} bytes`,
      try: ["Trim the message; for longer reports open a GitHub issue."],
    });
  }
  return opts;
}

async function confirm(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question("send? [y/N] ")).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function runFeedback(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  const home = defaultHomeDir();
  const installId = await readOrCreateInstallId(home);

  const doctorBundle = opts.includeDoctor
    ? await buildRedactedDoctorBundle(home)
    : null;

  const url = process.env[FEEDBACK_URL_ENV] ?? null;
  const transportConfigured = url !== null;

  const payload = {
    install_id: installId,
    scaffold_day_version: pkg.version,
    message: opts.message,
    include_doctor: opts.includeDoctor,
    doctor_bundle: doctorBundle,
    sent_at: new Date().toISOString(),
  };

  if (isDryRun()) {
    emitDryRun(opts.json, {
      command: "feedback",
      writes: [],
      result: payload,
      note: transportConfigured
        ? `would POST to ${url}`
        : `${FEEDBACK_URL_ENV} not configured — would queue locally only`,
    });
    return 0;
  }

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("scaffold-day feedback");
    console.log(`  install_id:    ${installId}`);
    console.log(`  message:       ${opts.message} (${opts.message.length} chars)`);
    if (doctorBundle) {
      const size = Buffer.byteLength(JSON.stringify(doctorBundle), "utf8");
      console.log(`  doctor bundle: ${size} bytes redacted JSON`);
    } else {
      console.log(`  doctor bundle: (omitted; pass --include-doctor to attach)`);
    }
    console.log(
      transportConfigured
        ? `  transport:     ${url}`
        : `  transport:     ${FEEDBACK_URL_ENV} not configured — message will not be transmitted`,
    );
  }

  if (!transportConfigured) {
    // Always print the fallback notice on stderr so JSON consumers
    // can still pick it up without parsing it.
    console.error("");
    console.error("Feedback endpoint is not yet configured.");
    console.error("Open an issue instead at:");
    console.error("  https://github.com/scaffold-at/day/issues/new");
    return 0;
  }

  const ok = opts.noConfirm || (await confirm());
  if (!ok) {
    if (!opts.json) console.log("  cancelled.");
    return 0;
  }

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `feedback POST failed: ${r.status} ${r.statusText}` },
        cause: `URL: ${url}`,
        try: ["Retry, or open an issue at https://github.com/scaffold-at/day/issues."],
      });
    }
    if (opts.json) {
      console.log(JSON.stringify({ sent: true, status: r.status }));
    } else {
      console.log("  sent.");
    }
    return 0;
  } catch (err) {
    if (err instanceof ScaffoldError) throw err;
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "feedback transport error" },
      cause: (err as Error).message,
      try: ["Retry. If this persists, file an issue."],
    });
  }
}

export const feedbackCommand: Command = {
  name: "feedback",
  summary: "send anonymous feedback to the scaffold-day maintainers",
  help: {
    what: "Send a short pseudonymous note to the maintainer feedback channel. Tagged with your install_id (UUID per home) for rate-limit checks; it is NOT anonymous. With --include-doctor, attach a redacted JSON bundle (no paths, no policy values, no per-day counts).",
    when: "When something feels great, broken, surprising, or unclear — and you don't want to file a public issue.",
    cost: "One HTTPS POST to the configured feedback URL. No transmission when SCAFFOLD_DAY_FEEDBACK_URL is unset.",
    input: "<message...> [--include-doctor] [--no-confirm] [--json] [--dry-run]",
    return: "Exit 0 with a redacted preview, then a confirm prompt (skip with --no-confirm). Falls back to GitHub Issues guidance when transport is unconfigured.",
    gotcha: "TTY required for the confirm prompt; pipelines must pass --no-confirm. Tracking issue #3 §S66.",
  },
  run: async (args) => runFeedback(args),
};
