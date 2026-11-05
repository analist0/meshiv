// ============================================================
// ai.js — קריאה לכל מודל: API תואם OpenAI (Ollama, LM Studio,
// OpenRouter, Groq, Gemini, Hugging Face, OpenAI...) או Anthropic.
// ============================================================
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 60000);

async function providerError(r) {
  const raw = await r.text();
  let msg = raw;
  try {
    const j = JSON.parse(raw);
    msg = j.error?.message || j.error || j.message || raw;
    if (typeof msg !== "string") msg = JSON.stringify(msg);
  } catch {}
  return new Error(`הספק החזיר ${r.status}: ${String(msg).slice(0, 300)}`);
}

export async function complete(provider, messages) {
  const kind = provider.kind || "openai";
  const baseUrl = String(provider.baseUrl || "").trim().replace(/\/+$/, "");
  const model = String(provider.model || "").trim();
  const apiKey = String(provider.apiKey || process.env.AI_API_KEY || "").trim();
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("חסרה כתובת בסיס תקינה לספק ה-AI");
  if (!model) throw new Error("חסר שם מודל");

  try {
    if (kind === "anthropic") {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const r = await fetch(`${baseUrl.replace(/\/v1$/, "")}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 1024, system: system || undefined, messages: messages.filter((m) => m.role !== "system") }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r.ok) throw await providerError(r);
      const j = await r.json();
      return (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    }
    const headers = { "content-type": "application/json" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages, temperature: 0.5, stream: false }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) throw await providerError(r);
    const j = await r.json();
    const content = j.choices?.[0]?.message?.content;
    return Array.isArray(content) ? content.map((c) => c.text || "").join("") : String(content ?? "");
  } catch (err) {
    if (err.name === "TimeoutError") throw new Error("ספק ה-AI לא ענה בזמן");
    if (err.message === "fetch failed") throw new Error(`אין חיבור לספק ה-AI (${err.cause?.code || "שגיאת רשת"})`);
    throw err;
  }
}
