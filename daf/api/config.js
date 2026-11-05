// Vercel Serverless Function: GET /api/config
import { publicConfig } from "../lib/ai.js";

export default function handler(_req, res) {
  res.setHeader("cache-control", "no-store");
  res.status(200).json(publicConfig());
}
