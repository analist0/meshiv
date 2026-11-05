// ============================================================
// server.js — משיב: שרת מקומי + לוח בקרה בעברית.
//   npm start  → לוח בקרה + חיבור ל-WhatsApp (open-wa)
//   npm run sim → לוח בקרה וסימולטור בלבד, בלי WhatsApp
// ============================================================
import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize as normPath, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { complete } from "./ai.js";
import { DEFAULT_CONFIG, configError, createEngine, withDefaults } from "./engine.js";
import { createStore } from "./store.js";
import { startWhatsApp } from "./whatsapp.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public") + sep;
const DATA_DIR = process.env.MESHIV_DATA || join(ROOT, "data");
const PORT = Number(process.env.PORT || 3300);
const HOST = process.env.HOST || "127.0.0.1";
const SIMULATOR_ONLY = process.env.MESHIV_SIMULATOR === "1";
const PASSWORD = process.env.DASHBOARD_PASSWORD || "";
// כשהשרת פתוח לרשת (שרת ענן, Docker) — בלי סיסמה כל אחד ישלוט בוואטסאפ שלך
if (!["127.0.0.1", "localhost", "::1"].includes(HOST) && !PASSWORD) {
  console.error(`❌ HOST=${HOST} פותח את לוח הבקרה לרשת. הגדר DASHBOARD_PASSWORD והפעל שוב.`);
  process.exit(1);
}
const MAX_BODY = 1024 * 1024;
const LOG_MAX = 500;

const store = createStore(DATA_DIR);
const clone = (x) => structuredClone(x);

let config = withDefaults(await store.load("config", null));
const state = await store.load("state", {});
let simState = {};
const log = [];

const engine = createEngine({ getConfig: () => config, state, ai: complete });
let simEngine = createEngine({ getConfig: () => config, state: simState, ai: complete });

const persistState = () => store.saveSoon("state", () => state, 2000);

// ---------- Live events (SSE) ----------
const clients = new Set();
let wa = { status: SIMULATOR_ONLY ? "SIMULATOR" : "OFF", qr: null, error: null };
function broadcast(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}
function addLog(entry) {
  const e = { ts: Date.now(), ...entry };
  log.push(e);
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
  broadcast("log", e);
}
function setWa(patch) {
  wa = { ...wa, ...patch };
  broadcast("status", wa);
}

// ---------- WhatsApp ----------
let client = null;
const queues = new Map(); // הודעות באותו צ'אט מעובדות לפי הסדר

async function onWhatsAppMessage(msg) {
  const prev = queues.get(msg.chatId) || Promise.resolve();
  const next = prev.then(() => processMessage(msg)).catch((err) => addLog({ dir: "sys", text: `שגיאה: ${err.message}` }));
  queues.set(msg.chatId, next);
  next.finally(() => queues.get(msg.chatId) === next && queues.delete(msg.chatId));
}

async function processMessage(msg) {
  if (msg.fromMe && msg.isBot) return;
  if (!msg.fromMe) {
    const c = engine.contact(msg.chatId);
    if (msg.name) c.name = msg.name;
    addLog({ dir: "in", chat: msg.chatId, name: msg.name, text: msg.body || `[${msg.type}]`, group: msg.isGroup });
  }
  const d = await engine.handle(msg);
  persistState();
  if (msg.fromMe) {
    if (d.reason.startsWith("owner-")) addLog({ dir: "sys", chat: msg.chatId, text: d.reason === "owner-stop" ? "הבוט הושתק בצ'אט הזה" : "הבוט הופעל מחדש בצ'אט הזה" });
    return;
  }
  if (d.error) addLog({ dir: "sys", chat: msg.chatId, text: `AI: ${d.error}` });
  if (!d.replies.length) {
    if (!["no-match"].includes(d.reason)) addLog({ dir: "sys", chat: msg.chatId, text: `לא נשלחה תשובה (${d.reason})` });
    return;
  }
  await client?.send(msg.chatId, d.replies, { delayMs: d.delayMs, quoteId: config.quoteReply ? msg.id : null });
  for (const r of d.replies) addLog({ dir: "out", chat: msg.chatId, name: msg.name, text: r, reason: d.reason });
}

async function connectWhatsApp() {
  if (client || wa.status === "STARTING") return;
  setWa({ status: "STARTING", error: null, qr: null });
  try {
    client = await startWhatsApp({
      sessionDir: join(DATA_DIR, "session"),
      onQr: (qr) => setWa({ qr, status: qr ? "QR" : wa.status }),
      onState: (s) => setWa({ status: s }),
      onMessage: onWhatsAppMessage,
      log: (t) => addLog({ dir: "sys", text: t }),
    });
    addLog({ dir: "sys", text: "✅ מחובר ל-WhatsApp" });
  } catch (err) {
    client = null;
    setWa({ status: "ERROR", error: err.message, qr: null });
    addLog({ dir: "sys", text: `❌ החיבור ל-WhatsApp נכשל: ${err.message}` });
  }
}

// ---------- HTTP ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8" };

function json(res, status, data) {
  res.writeHead(status, { "content-type": MIME[".json"], "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    if ((size += c.length) > MAX_BODY) throw new HttpError(413, "הבקשה גדולה מדי");
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "JSON לא תקין");
  }
}

function validateConfig(c) {
  const error = configError(c);
  if (error) throw new HttpError(400, error);
  return withDefaults(c);
}

function publicConfig() {
  const c = clone(config);
  if (c.ai.apiKey) c.ai.apiKey = "••••" + c.ai.apiKey.slice(-4);
  return c;
}

function contactsSummary() {
  return Object.entries(state.contacts || {})
    .map(([id, c]) => ({ id, name: c.name || "", firstSeen: c.firstSeen, pausedUntil: c.pausedUntil > Date.now() ? c.pausedUntil : 0, today: c.day?.n || 0 }))
    .sort((a, b) => (b.firstSeen || 0) - (a.firstSeen || 0))
    .slice(0, 300);
}

function authorized(req) {
  if (!PASSWORD) return true;
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const decoded = Buffer.from(h.slice(6), "base64").toString();
  const given = createHash("sha256").update(decoded.slice(decoded.indexOf(":") + 1)).digest();
  return timingSafeEqual(given, createHash("sha256").update(PASSWORD).digest());
}
// בקשה שהגיעה דרך Cloudflare (Tunnel) — כלומר מהאינטרנט
const viaCloudflare = (req) => Boolean(req.headers["cf-connecting-ip"]);

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  const m = req.method;

  if (p === "/api/events" && m === "GET") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`event: status\ndata: ${JSON.stringify(wa)}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }
  if (p === "/api/status" && m === "GET") return json(res, 200, { ...wa, simulatorOnly: SIMULATOR_ONLY });
  if (p === "/api/config" && m === "GET") return json(res, 200, publicConfig());
  if (p === "/api/config" && m === "PUT") {
    const incoming = await body(req);
    if (typeof incoming?.ai?.apiKey === "string" && incoming.ai.apiKey.startsWith("••••")) incoming.ai.apiKey = config.ai.apiKey;
    config = validateConfig(incoming);
    await store.saveNow("config", config);
    addLog({ dir: "sys", text: "ההגדרות נשמרו" });
    return json(res, 200, publicConfig());
  }
  if (p === "/api/config/default" && m === "GET") return json(res, 200, clone(DEFAULT_CONFIG));
  if (p === "/api/stats" && m === "GET") return json(res, 200, { ...state.stats, contacts: Object.keys(state.contacts || {}).length });
  if (p === "/api/log" && m === "GET") return json(res, 200, log);
  if (p === "/api/contacts" && m === "GET") return json(res, 200, contactsSummary());
  const resume = p.match(/^\/api\/contacts\/([^/]+)\/(resume|pause)$/);
  if (resume && m === "POST") {
    const c = state.contacts?.[decodeURIComponent(resume[1])];
    if (!c) throw new HttpError(404, "איש קשר לא נמצא");
    c.pausedUntil = resume[2] === "pause" ? Date.now() + 365 * 86400000 : 0;
    persistState();
    return json(res, 200, { ok: true });
  }
  if (p === "/api/simulate" && m === "POST") {
    const b = await body(req);
    const phone = String(b.phone || "972500000000").replace(/\D/g, "");
    const msg = { id: `sim-${Date.now()}`, chatId: b.isGroup ? "120363000000000000@g.us" : `${phone}@c.us`, from: `${phone}@c.us`, name: String(b.name || ""), body: String(b.body || ""), isGroup: Boolean(b.isGroup), fromMe: Boolean(b.fromMe), type: "chat" };
    const d = await simEngine.handle(msg);
    return json(res, 200, d);
  }
  if (p === "/api/simulate/reset" && m === "POST") {
    simState = {};
    simEngine = createEngine({ getConfig: () => config, state: simState, ai: complete });
    return json(res, 200, { ok: true });
  }
  if (p === "/api/ai/test" && m === "POST") {
    const b = await body(req);
    const provider = { ...config.ai, ...(b || {}) };
    if (!provider.apiKey || provider.apiKey.startsWith("••••")) provider.apiKey = config.ai.apiKey;
    try {
      const text = await complete(provider, [{ role: "user", content: "ענה במילה אחת בלבד: שלום" }]);
      return json(res, 200, { ok: true, text });
    } catch (err) {
      return json(res, 200, { ok: false, error: err.message });
    }
  }
  if (p === "/api/whatsapp/start" && m === "POST") {
    if (SIMULATOR_ONLY) throw new HttpError(400, "השרת רץ במצב סימולטור (npm run sim)");
    connectWhatsApp();
    return json(res, 200, { ok: true });
  }
  if (p === "/api/whatsapp/stop" && m === "POST") {
    await client?.stop();
    client = null;
    setWa({ status: "OFF", qr: null });
    return json(res, 200, { ok: true });
  }
  if (m === "GET" && !p.startsWith("/api/")) {
    const file = normPath(join(PUBLIC_DIR, p === "/" ? "index.html" : decodeURIComponent(p)));
    if (!file.startsWith(PUBLIC_DIR)) throw new HttpError(403, "אסור");
    try {
      const data = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
      return res.end(data);
    } catch {
      throw new HttpError(404, "לא נמצא");
    }
  }
  throw new HttpError(404, "לא נמצא");
}

const server = http.createServer(async (req, res) => {
  if (!PASSWORD && viaCloudflare(req)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    return res.end("משיב: הגישה מבחוץ חסומה כי לא הוגדרה סיסמה. הגדר DASHBOARD_PASSWORD בקובץ .env והפעל מחדש.");
  }
  if (!authorized(req)) {
    res.writeHead(401, { "www-authenticate": 'Basic realm="meshiv", charset="UTF-8"' });
    return res.end();
  }
  try {
    await route(req, res);
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (!res.headersSent) json(res, err.status || 500, { error: err instanceof HttpError ? err.message : "שגיאה פנימית" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`💬 משיב: לוח בקרה בכתובת http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  if (SIMULATOR_ONLY) console.log("   מצב סימולטור — בלי WhatsApp");
  else if (config.autoStart !== false) connectWhatsApp();
});

async function shutdown() {
  await store.flush([["state", () => state]]).catch(() => {});
  await client?.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
