import { chmod, mkdir, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { ScaffoldError } from "@scaffold/day-core";
import type { Command } from "../cli/command";
import { emitDryRun, isDryRun } from "../cli/runtime";

const REPO = "scaffold-at/day";
const BACKUP_GLOB_PREFIX = ".scaffold-day-self-update.";

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day self-update --help`.",
    try: ["Run `scaffold-day self-update --help`."],
  });
}

function tierTarget(): "darwin-arm64" | "linux-x64" {
  const platform = os.platform();
  const arch = os.arch();
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  throw new ScaffoldError({
    code: "DAY_INVALID_INPUT",
    summary: { en: `${platform}/${arch} is not a Tier 1 target` },
    cause: "v0.2 self-update only supports darwin/arm64 and linux/x64.",
    try: [
      "Use brew if installed via brew tap.",
      "Or wait for a tier-2 build (file an issue).",
    ],
    context: { platform, arch },
  });
}

/** Resolve the latest scaffold-day release tag via GitHub redirect. */
async function resolveLatestTag(repo: string): Promise<string> {
  // GitHub redirects /releases/latest to /releases/tag/<tag>; we
  // follow with `redirect: "manual"` so we can read the Location
  // header without pulling the full HTML.
  const r = await fetch(`https://github.com/${repo}/releases/latest`, {
    redirect: "manual",
  });
  if (r.status >= 300 && r.status < 400) {
    const loc = r.headers.get("location");
    const m = loc ? /\/releases\/tag\/([^/?]+)/.exec(loc) : null;
    if (m) return m[1] ?? "";
  }
  if (r.ok) {
    // Some GitHub deployments resolve directly; try parsing url.
    const m = /\/releases\/tag\/([^/?]+)/.exec(r.url);
    if (m) return m[1] ?? "";
  }
  throw new ScaffoldError({
    code: "DAY_INVALID_INPUT",
    summary: { en: "could not resolve the latest release tag" },
    cause: `GitHub returned ${r.status} for /releases/latest. Network down?`,
    try: ["Retry with --version <tag> when supported, or run install.sh manually."],
  });
}

function compareSemver(a: string, b: string): number {
  // Strip leading "v".
  const norm = (s: string) => s.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10));
  const av = norm(a);
  const bv = norm(b);
  for (let i = 0; i < 3; i++) {
    const x = av[i] ?? 0;
    const y = bv[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `download failed: ${r.status} ${r.statusText}` },
      cause: `URL: ${url}`,
      try: ["Retry. If GitHub is up, check connectivity."],
    });
  }
  return r.text();
}

async function fetchBinary(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `binary download failed: ${r.status} ${r.statusText}` },
      cause: `URL: ${url}`,
      try: ["Retry. The release may not have finished publishing assets yet."],
    });
  }
  return new Uint8Array(await r.arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // bun's WebCrypto requires BufferSource over a plain ArrayBuffer.
  // Copy into a fresh ArrayBuffer view to satisfy the typecheck on
  // SharedArrayBuffer-tainted Uint8Array<ArrayBufferLike>.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", ab);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function execPath(): string {
  // bun build --compile sets process.execPath to the compiled binary;
  // when running via `bun run dev:cli` it's the bun runtime — caller
  // should refuse self-update in that case. (See guardSourceMode.)
  return process.execPath;
}

function isPackageManagerPath(p: string): "brew" | null {
  if (p.includes("/Cellar/") || p.includes("/homebrew/")) return "brew";
  return null;
}

async function ensureWritable(target: string): Promise<void> {
  // Try touching a sibling tmp file; ENOENT is fine, we'll create it.
  const dir = path.dirname(target);
  try {
    await stat(dir);
  } catch {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `binary directory does not exist: ${dir}` },
      cause: "self-update needs a writable directory.",
      try: ["Reinstall via install.sh."],
    });
  }
  // We don't actively `access` here — the rename will surface EACCES
  // with a clearer message if needed.
}

type Options = {
  check: boolean;
  rollback: boolean;
  json: boolean;
};

async function runSelfUpdate(args: string[]): Promise<number> {
  const opts: Options = { check: false, rollback: false, json: false };
  for (const a of args) {
    if (a === "--check") opts.check = true;
    else if (a === "--rollback") opts.rollback = true;
    else if (a === "--json") opts.json = true;
    else throw usage(`self-update: unexpected argument '${a}'`);
  }
  if (opts.check && opts.rollback) {
    throw usage("--check and --rollback are mutually exclusive");
  }

  const binPath = execPath();

  // Refuse if the binary path looks like a package-manager-managed
  // location (brew etc.) — they have their own update story.
  const pm = isPackageManagerPath(binPath);
  if (pm && !opts.check) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `binary is managed by ${pm}` },
      cause: `self-update refuses to overwrite ${binPath}.`,
      try: pm === "brew" ? ["Run `brew upgrade scaffold-at/tap/day`."] : ["Use your package manager."],
    });
  }

  // Refuse if running through `bun run` (dev mode) — execPath would
  // be the bun runtime, not the scaffold-day binary.
  if (path.basename(binPath).startsWith("bun")) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "self-update is for compiled binaries only" },
      cause: `process.execPath is ${binPath} — looks like a 'bun run' / dev invocation.`,
      try: ["Install a release binary via install.sh, then call self-update."],
    });
  }

  // ─── --rollback ─────────────────────────────────────────────────
  if (opts.rollback) {
    const dir = path.dirname(binPath);
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir);
    const backups = entries
      .filter((e) => e.startsWith(BACKUP_GLOB_PREFIX))
      .sort()
      .reverse();
    if (backups.length === 0) {
      throw new ScaffoldError({
        code: "DAY_NOT_FOUND",
        summary: { en: "no self-update backup to roll back to" },
        cause: `Looked under ${dir} for ${BACKUP_GLOB_PREFIX}*`,
        try: ["A previous self-update creates the backup. Reinstall via install.sh if you need a specific older version."],
      });
    }
    const backup = path.join(dir, backups[0]!);
    if (isDryRun()) {
      emitDryRun(opts.json, {
        command: "self-update --rollback",
        writes: [{ path: binPath, op: "update" }],
        result: { restored_from: backup },
      });
      return 0;
    }
    // Move current away then restore the backup.
    const aside = `${binPath}.rollback-aside-${Date.now()}`;
    await rename(binPath, aside);
    await rename(backup, binPath);
    if (opts.json) {
      console.log(JSON.stringify({ rolled_back: true, restored_from: backup, aside }));
    } else {
      console.log(`scaffold-day self-update --rollback`);
      console.log(`  restored: ${binPath}`);
      console.log(`  was:      ${aside}`);
    }
    return 0;
  }

  // ─── resolve latest ─────────────────────────────────────────────
  const target = tierTarget();
  const tag = await resolveLatestTag(REPO);
  const latestSemver = tag.replace(/^v/, "");
  const upToDate = compareSemver(pkg.version, latestSemver) >= 0;

  if (opts.check) {
    const payload = {
      current: pkg.version,
      latest: latestSemver,
      up_to_date: upToDate,
      target_asset: `scaffold-day-${target}`,
    };
    if (opts.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else if (upToDate) {
      console.log(`scaffold-day self-update --check`);
      console.log(`  up to date (v${pkg.version})`);
    } else {
      console.log(`scaffold-day self-update --check`);
      console.log(`  update available: v${pkg.version} → v${latestSemver}`);
      console.log(`  run \`scaffold-day self-update\` to install.`);
    }
    return 0;
  }

  if (upToDate) {
    if (opts.json) {
      console.log(JSON.stringify({ up_to_date: true, current: pkg.version }));
    } else {
      console.log(`scaffold-day self-update: already at v${pkg.version}`);
    }
    return 0;
  }

  // ─── plan + (dry-run | execute) ─────────────────────────────────
  const base = `https://github.com/${REPO}/releases/download/${tag}`;
  const assetUrl = `${base}/scaffold-day-${target}`;
  const sumUrl = `${assetUrl}.sha256`;
  const backupPath = path.join(
    path.dirname(binPath),
    `${BACKUP_GLOB_PREFIX}${pkg.version}.${Date.now()}`,
  );

  if (isDryRun()) {
    emitDryRun(opts.json, {
      command: "self-update",
      writes: [
        { path: binPath, op: "update" },
        { path: backupPath, op: "create" },
      ],
      result: {
        from: pkg.version,
        to: latestSemver,
        asset: assetUrl,
        sha256_url: sumUrl,
      },
    });
    return 0;
  }

  await ensureWritable(binPath);

  // Download + verify.
  console.error(`self-update: resolving ${tag} (${target})`);
  const [bin, sumText] = await Promise.all([
    fetchBinary(assetUrl),
    fetchText(sumUrl),
  ]);
  const expected = sumText.split(/\s+/)[0]?.toLowerCase().trim();
  const actual = (await sha256Hex(bin)).toLowerCase();
  if (!expected) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: ".sha256 sidecar was empty or malformed" },
      cause: `Got: ${JSON.stringify(sumText.slice(0, 80))}`,
      try: ["Retry; release publishing may not be complete."],
    });
  }
  if (expected !== actual) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "sha256 mismatch on downloaded binary" },
      cause: `expected ${expected}\nactual   ${actual}`,
      try: ["Retry. If this repeats, file a security issue."],
    });
  }

  // Write tmp + rename + clear quarantine + chmod.
  const tmp = `${binPath}.next.${Date.now()}`;
  await mkdir(path.dirname(tmp), { recursive: true });
  await writeFile(tmp, bin, { mode: 0o755 });
  await chmod(tmp, 0o755);

  if (os.platform() === "darwin") {
    // Best-effort xattr removal. Avoid throwing if the attribute
    // wasn't set; xattr is built-in on macOS.
    try {
      const proc = Bun.spawn(["xattr", "-d", "com.apple.quarantine", tmp]);
      await proc.exited;
    } catch {
      // ignore
    }
  }

  // Backup current → new.
  await rename(binPath, backupPath);
  try {
    await rename(tmp, binPath);
  } catch (err) {
    // Try to restore on failure.
    try {
      await rename(backupPath, binPath);
    } catch {
      // worst case: backup is left in place; user can rollback.
    }
    throw err;
  }

  if (opts.json) {
    console.log(
      JSON.stringify({
        updated: true,
        from: pkg.version,
        to: latestSemver,
        backup: backupPath,
      }),
    );
  } else {
    console.log(`scaffold-day self-update`);
    console.log(`  ${pkg.version} → ${latestSemver}`);
    console.log(`  backup: ${backupPath}`);
    console.log(`  run --rollback to revert.`);
  }
  return 0;
}

export const selfUpdateCommand: Command = {
  name: "self-update",
  summary: "check for and install a newer scaffold-day binary",
  help: {
    what: "Resolve the latest scaffold-day release from GitHub, verify SHA-256, and replace the running binary in place. Keeps a sibling backup of the previous version so --rollback can revert.",
    when: "Periodically, or when release notes mention a fix. Auto-update is intentionally OFF; this command is the only path.",
    cost: "One HTTPS HEAD to /releases/latest plus the binary + sha256 download (~60 MB). No telemetry.",
    input: "[--check] check only, no install. [--rollback] revert to the previous binary. [--json] [--dry-run]",
    return: "Exit 0 with the new version printed. DAY_INVALID_INPUT on sha256 mismatch / unsupported platform / brew-managed path.",
    gotcha: "Refuses to run when the binary path is under a package manager (Homebrew). Refuses on `bun run` dev invocations. Tracking SLICES.md §S47 / scaffold-at/day#3 §S67.",
  },
  run: async (args) => runSelfUpdate(args),
};
