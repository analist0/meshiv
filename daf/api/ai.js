// Vercel Serverless Function: POST /api/ai
import { MAX_BODY, errorResponse, runCompletion } from "../lib/ai.js";

export const config = { maxDuration: 60 };

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error("too large"), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST בלבד" });
  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.status === 413 ? "הבקשה גדולה מדי" : "JSON לא תקין" });
  }
  try {
    res.status(200).json(await runCompletion(body));
  } catch (err) {
    const { status, body: out } = errorResponse(err);
    res.status(status).json(out);
  }
}
