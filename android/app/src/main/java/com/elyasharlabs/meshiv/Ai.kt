package com.elyasharlabs.meshiv

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// קריאה לכל מודל: API תואם OpenAI (Ollama, OpenRouter, Groq, Gemini...) או Anthropic
object Ai {
    private const val TIMEOUT_MS = 60_000

    fun complete(provider: JSONObject, messages: List<Pair<String, String>>): String {
        val kind = provider.optString("kind", "openai")
        val base = provider.optString("baseUrl").trim().trimEnd('/')
        val model = provider.optString("model").trim()
        val key = provider.optString("apiKey").trim()
        if (!base.startsWith("http://") && !base.startsWith("https://")) throw IllegalArgumentException("חסרה כתובת בסיס תקינה לספק ה-AI")
        if (model.isEmpty()) throw IllegalArgumentException("חסר שם מודל")

        return if (kind == "anthropic") {
            val system = messages.filter { it.first == "system" }.joinToString("\n\n") { it.second }
            val body = JSONObject().put("model", model).put("max_tokens", 1024)
                .put("messages", JSONArray(messages.filter { it.first != "system" }.map { JSONObject().put("role", it.first).put("content", it.second) }))
            if (system.isNotEmpty()) body.put("system", system)
            val j = post("${base.removeSuffix("/v1")}/v1/messages", body, mapOf("x-api-key" to key, "anthropic-version" to "2023-06-01"))
            val content = j.optJSONArray("content") ?: JSONArray()
            (0 until content.length()).mapNotNull { content.optJSONObject(it) }.filter { it.optString("type") == "text" }.joinToString("") { it.optString("text") }
        } else {
            val body = JSONObject().put("model", model).put("temperature", 0.5).put("stream", false)
                .put("messages", JSONArray(messages.map { JSONObject().put("role", it.first).put("content", it.second) }))
            val headers = if (key.isNotEmpty()) mapOf("authorization" to "Bearer $key") else emptyMap()
            val j = post("$base/chat/completions", body, headers)
            j.optJSONArray("choices")?.optJSONObject(0)?.optJSONObject("message")?.optString("content") ?: ""
        }
    }

    private fun post(url: String, body: JSONObject, headers: Map<String, String>): JSONObject {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = TIMEOUT_MS
            readTimeout = TIMEOUT_MS
            doOutput = true
            setRequestProperty("content-type", "application/json")
            headers.forEach { (k, v) -> setRequestProperty(k, v) }
        }
        try {
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) {
                val msg = runCatching { JSONObject(text).let { it.optJSONObject("error")?.optString("message") ?: it.optString("error", text) } }.getOrDefault(text)
                throw RuntimeException("הספק החזיר $code: ${msg.take(300)}")
            }
            return JSONObject(text)
        } catch (e: java.net.SocketTimeoutException) {
            throw RuntimeException("ספק ה-AI לא ענה בזמן")
        } catch (e: java.io.IOException) {
            throw RuntimeException("אין חיבור לספק ה-AI (${e.message})")
        } finally {
            conn.disconnect()
        }
    }
}
