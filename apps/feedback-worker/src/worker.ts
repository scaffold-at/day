/**
 * scaffold-day feedback Cloudflare Worker (S66).
 *
 * Receives `POST /` from the CLI's `feedback` command:
 *   {
 *     install_id: UUID,
 *     scaffold_day_version: "X.Y.Z",
 *     message: string,                  // ≤ 1024 bytes
 *     include_doctor: boolean,
 *     doctor_bundle: object | null,     // redacted
 *     sent_at: ISO 8601
 *   }
 *
 * Forwards to a Discord channel webhook (PO's private channel) as
 * a multipart message with the doctor bundle as a JSON file
 * attachment when present.
 *
 * Abuse mitigations:
 *   - per-install_id rate limit via KV (5/min, 30/hour, 100/day)
 *   - 1KB message length cap (also enforced client-side)
 *   - URL-spam heuristic (≥ 5 URLs in body → reject)
 *   - optional shared SHARED_TOKEN header check
 *   - Cloudflare's automatic per-IP DDoS protection sits in front
 */

interface Env {
  DISCORD_WEBHOOK_URL: string;
  SHARED_TOKEN?: string;
  RATE?: KVNamespace;
}

type FeedbackPayload = {
  install_id?: unknown;
  scaffold_day_version?: unknown;
  message?: unknown;
  include_doctor?: unknown;
  doctor_bundle?: unknown;
  sent_at?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_RE = /https?:\/\//gi;
const MAX_MESSAGE_BYTES = 1024;

const RATE_LIMITS: Array<{ window_seconds: number; max: number; label: string }> = [
  { window_seconds: 60, max: 5, label: "per-minute" },
  { window_seconds: 60 * 60, max: 30, label: "per-hour" },
  { window_seconds: 60 * 60 * 24, max: 100, label: "per-day" },
];

function bad(reason: string, status = 400): Response {
  return new Response(JSON.stringify({ error: reason }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function checkAndIncrementRate(
  rate: KVNamespace,
  installId: string,
  now: number,
): Promise<{ ok: true; counts: Record<string, number> } | { ok: false; reason: string }> {
  const counts: Record<string, number> = {};
  for (const limit of RATE_LIMITS) {
    const bucket = Math.floor(now / (limit.window_seconds * 1000));
    const key = `rate:${installId}:${limit.label}:${bucket}`;
    const current = Number((await rate.get(key)) ?? "0");
    if (current >= limit.max) {
      return { ok: false, reason: `${limit.label} rate limit (${limit.max}) exceeded` };
    }
    counts[limit.label] = current + 1;
    // Bucket TTL = window length, so old entries fall off automatically.
    await rate.put(key, String(current + 1), {
      expirationTtl: limit.window_seconds,
    });
  }
  return { ok: true, counts };
}

async function postedThisWeek(
  rate: KVNamespace,
  installId: string,
): Promise<number> {
  // Coarse counter: sum of 24-hour buckets covering the last 7 days.
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const bucket = Math.floor((now - i * dayMs) / dayMs);
    const key = `rate:${installId}:per-day:${bucket}`;
    total += Number((await rate.get(key)) ?? "0");
  }
  return total;
}

function buildDiscordContent(p: {
  installId: string;
  message: string;
  version: string;
  weeklyCount: number;
  hasDoctor: boolean;
}): string {
  const idShort = p.installId.slice(0, 8);
  const docMark = p.hasDoctor ? "📎 " : "";
  const ts = new Date().toISOString();
  return [
    `${docMark}feedback from \`${idShort}…\` · v${p.version} · ${ts}`,
    `> ${p.message.slice(0, 800).replace(/\n/g, "\n> ")}`,
    `🔁 ${p.weeklyCount}× from this install_id this week`,
  ].join("\n");
}

async function forwardToDiscord(
  webhookUrl: string,
  content: string,
  doctorBundle: unknown | null,
): Promise<Response> {
  if (doctorBundle === null) {
    return fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
  }
  // Attach the doctor bundle as a file. Discord webhooks accept
  // multipart with `payload_json` + `files[N]`.
  const fd = new FormData();
  fd.append("payload_json", JSON.stringify({ content }));
  const blob = new Blob([JSON.stringify(doctorBundle, null, 2)], {
    type: "application/json",
  });
  fd.append("files[0]", blob, "doctor-redacted.json");
  return fetch(webhookUrl, { method: "POST", body: fd });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "GET" && new URL(req.url).pathname === "/health") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (req.method !== "POST") {
      return bad("method not allowed", 405);
    }

    if (env.SHARED_TOKEN) {
      const got = req.headers.get("x-scaffold-day-token");
      if (got !== env.SHARED_TOKEN) {
        return bad("forbidden", 403);
      }
    }

    let payload: FeedbackPayload;
    try {
      payload = (await req.json()) as FeedbackPayload;
    } catch {
      return bad("body must be JSON");
    }

    const installId = typeof payload.install_id === "string" ? payload.install_id : "";
    if (!UUID_RE.test(installId)) {
      return bad("install_id must be a UUID v4");
    }
    const message = typeof payload.message === "string" ? payload.message : "";
    if (message.length === 0) {
      return bad("message is required");
    }
    if (new TextEncoder().encode(message).length > MAX_MESSAGE_BYTES) {
      return bad(`message exceeds ${MAX_MESSAGE_BYTES} bytes`);
    }
    const urlMatches = message.match(URL_RE) ?? [];
    if (urlMatches.length >= 5) {
      return bad("message rejected (too many URLs)");
    }

    const version = typeof payload.scaffold_day_version === "string"
      ? payload.scaffold_day_version
      : "unknown";
    const includeDoctor = Boolean(payload.include_doctor);
    const doctorBundle = includeDoctor ? payload.doctor_bundle : null;

    let weeklyCount = 0;
    if (env.RATE) {
      const gate = await checkAndIncrementRate(env.RATE, installId, Date.now());
      if (!gate.ok) return bad(gate.reason, 429);
      weeklyCount = await postedThisWeek(env.RATE, installId);
    }

    if (!env.DISCORD_WEBHOOK_URL) {
      return bad("server not configured (DISCORD_WEBHOOK_URL missing)", 503);
    }

    const content = buildDiscordContent({
      installId,
      message,
      version,
      weeklyCount,
      hasDoctor: doctorBundle !== null,
    });

    const r = await forwardToDiscord(env.DISCORD_WEBHOOK_URL, content, doctorBundle);
    if (!r.ok) {
      const text = await r.text();
      return new Response(
        JSON.stringify({ error: "discord forward failed", status: r.status, text }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, weekly_count: weeklyCount }),
      { headers: { "content-type": "application/json" } },
    );
  },
};
