// ============================================================
// lib/ai.js — לוגיקה משותפת לשרת המקומי ולפונקציות של Vercel:
// מעביר בקשות לכל API תואם OpenAI או ל-Anthropic.
// ============================================================

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 180000);
export const MAX_BODY = 2 * 1024 * 1024;

// בפריסה ציבורית (Vercel) אסור לשרת לשמש כמתווך לכתובות פנימיות.
export const PUBLIC_MODE = Boolean(process.env.VERCEL) || process.env.DAF_PUBLIC === "1";

export const serverDefaults = {
  kind: process.env.AI_KIND || "",
  baseUrl: process.env.AI_BASE_URL || "",
  model: process.env.AI_MODEL || "",
  apiKey: process.env.AI_API_KEY || "",
};

export function publicConfig() {
  const { apiKey, ...rest } = serverDefaults;
  return { ...rest, hasServerKey: Boolean(apiKey), publicMode: PUBLIC_MODE };
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isPrivateHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;
  if (h === "::1" || h === "::" || /^f[cd]/.test(h) || /^fe80:/.test(h) || h.startsWith("::ffff:")) return true;
  return false;
}

export function resolveProvider(input = {}) {
  const p = {
    kind: input.kind || serverDefaults.kind || "openai",
    baseUrl: (input.baseUrl || serverDefaults.baseUrl || "").trim().replace(/\/+$/, ""),
    model: (input.model || serverDefaults.model || "").trim(),
    apiKey: (input.apiKey || serverDefaults.apiKey || "").trim(),
  };
  if (!["openai", "anthropic"].includes(p.kind)) throw new HttpError(400, `סוג ספק לא מוכר: ${p.kind}`);
  if (!p.baseUrl) throw new HttpError(400, "חסרה כתובת בסיס (Base URL) לספק");
  let url;
  try {
    url = new URL(p.baseUrl);
  } catch {
    throw new HttpError(400, "כתובת הבסיס לא תקינה");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new HttpError(400, "כתובת הבסיס חייבת להתחיל ב-http:// או https://");
  if (PUBLIC_MODE && (url.protocol !== "https:" || isPrivateHost(url.hostname))) {
    throw new HttpError(400, "בגרסה המפורסמת אפשר להתחבר רק לספקי ענן ב-https. מודלים מקומיים (Ollama / LM Studio) עובדים כשמריצים את האפליקציה על המחשב שלך (npm start).");
  }
  if (!p.model) throw new HttpError(400, "חסר שם מודל");
  return p;
}

async function providerError(r) {
  const raw = await r.text();
  let msg = raw;
  try {
    const j = JSON.parse(raw);
    msg = j.error?.message || j.error || j.message || raw;
    if (typeof msg !== "string") msg = JSON.stringify(msg);
  } catch {}
  return new HttpError(502, `הספק החזיר ${r.status}: ${String(msg).slice(0, 500)}`);
}

async function callOpenAICompatible(p, messages, temperature) {
  const headers = { "content-type": "application/json" };
  if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
  if (/openrouter\.ai/i.test(p.baseUrl)) {
    headers["HTTP-Referer"] = "https://daf.local";
    headers["X-Title"] = "Daf";
  }
  const r = await fetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: p.model, messages, temperature, stream: false }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
  });
  if (!r.ok) throw await providerError(r);
  const j = await r.json();
  const content = j.choices?.[0]?.message?.content;
  if (Array.isArray(content)) return content.map((c) => c.text || "").join("");
  if (typeof content !== "string") throw new HttpError(502, "תשובה לא צפויה מהספק");
  return content;
}

async function callAnthropic(p, messages, temperature) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  const base = p.baseUrl.replace(/\/v1$/, "");
  const r = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": p.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: p.model, max_tokens: 4096, temperature, system: system || undefined, messages: rest }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
  });
  if (!r.ok) throw await providerError(r);
  const j = await r.json();
  return (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
}

// body: { provider, messages, temperature }
export async function runCompletion(body) {
  const p = resolveProvider(body?.provider);
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) throw new HttpError(400, "אין הודעות לשליחה");
  for (const m of messages) {
    if (!["system", "user", "assistant"].includes(m?.role) || typeof m.content !== "string") throw new HttpError(400, "פורמט הודעה לא תקין");
  }
  const temperature = typeof body.temperature === "number" ? body.temperature : 0.7;
  const started = Date.now();
  const text = p.kind === "anthropic" ? await callAnthropic(p, messages, temperature) : await callOpenAICompatible(p, messages, temperature);
  return { text, model: p.model, ms: Date.now() - started };
}

export function errorResponse(err) {
  if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
  if (err?.name === "TimeoutError") return { status: 504, body: { error: "הספק לא ענה בזמן" } };
  if (err?.message === "fetch failed") {
    const code = err.cause?.code || err.cause?.errors?.[0]?.code || "שגיאת רשת";
    return { status: 502, body: { error: `אין חיבור לספק (${code}). אם זה מודל מקומי — האם Ollama/LM Studio רץ?` } };
  }
  console.error(err);
  return { status: 500, body: { error: "שגיאה פנימית בשרת" } };
}
