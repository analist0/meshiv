// ============================================================
// server.js — שרת מקומי בלי תלויות:
//   * מגיש את האפליקציה מתוך public/
//   * /api/ai — מעביר בקשות לכל מודל (ראה lib/ai.js)
// ברירת מחדל: מאזין רק ל-127.0.0.1 (המחשב שלך בלבד).
// ============================================================
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError, MAX_BODY, errorResponse, publicConfig, runCompletion } from "./lib/ai.js";

const PORT = Number(process.env.PORT || 3210);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": MIME[".json"], "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "הבקשה גדולה מדי");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "JSON לא תקין");
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : PUBLIC_DIR + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("לא נמצא");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/api/ai" && req.method === "POST") return sendJson(res, 200, await runCompletion(await readBody(req)));
    if (req.url === "/api/config" && req.method === "GET") return sendJson(res, 200, publicConfig());
    if (req.method === "GET") return await serveStatic(req, res);
    res.writeHead(405).end();
  } catch (err) {
    const { status, body } = errorResponse(err);
    sendJson(res, status, body);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`📝 דף רץ בכתובת http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
});
