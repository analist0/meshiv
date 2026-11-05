package com.elyasharlabs.meshiv

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// ============================================================
// Api.kt — אותם נתיבי /api כמו בשרת (src/server.js), כדי שלוח
// הבקרה ירוץ באפליקציה בלי שינויים. נקרא מה-WebView דרך גשר JS.
// ============================================================
class Api(private val context: Context, private val actions: Actions) {
    interface Actions {
        fun openNotificationAccess()
        fun openBatterySettings()
        fun shareText(fileName: String, text: String)
    }

    class HttpError(val status: Int, message: String) : Exception(message)

    private var simState = JSONObject()
    private var sim = newSim()
    private fun newSim() = Engine({ Meshiv.config }, simState, Ai::complete)

    private fun masked(c: JSONObject): JSONObject {
        val copy = JSONObject(c.toString())
        val ai = copy.optJSONObject("ai")
        val key = ai?.optString("apiKey").orEmpty()
        if (key.isNotEmpty()) ai!!.put("apiKey", "••••" + key.takeLast(4))
        return copy
    }

    /** מחזיר (סטטוס HTTP, JSON). */
    fun handle(path: String, method: String, body: String?): Pair<Int, String> = try {
        200 to route(path.substringBefore("?"), method, body?.takeIf { it.isNotBlank() }?.let { JSONObject(it) }, path.substringAfter("?", "")).toString()
    } catch (e: HttpError) {
        e.status to JSONObject().put("error", e.message).toString()
    } catch (e: org.json.JSONException) {
        400 to JSONObject().put("error", "JSON לא תקין").toString()
    } catch (e: Exception) {
        500 to JSONObject().put("error", e.message ?: "שגיאה פנימית").toString()
    }

    private fun route(p: String, m: String, b: JSONObject?, query: String): Any {
        when {
            p == "/api/status" -> {
                val on = Meshiv.notificationAccess(context)
                return JSONObject().put("status", if (on) "ANDROID_ON" else "ANDROID_OFF").put("qr", JSONObject.NULL).put("error", JSONObject.NULL).put("platform", "android")
            }
            p == "/api/config" && m == "GET" -> return masked(Meshiv.config)
            p == "/api/config" && m == "PUT" -> {
                val incoming = b ?: throw HttpError(400, "הגדרות לא תקינות")
                Config.error(incoming)?.let { throw HttpError(400, it) }
                val ai = incoming.optJSONObject("ai")
                if (ai != null && ai.optString("apiKey").startsWith("••••")) ai.put("apiKey", Meshiv.config.optJSONObject("ai")?.optString("apiKey").orEmpty())
                Meshiv.saveConfig(incoming)
                Meshiv.addLog(JSONObject().put("dir", "sys").put("text", "ההגדרות נשמרו"))
                return masked(Meshiv.config)
            }
            p == "/api/config/default" -> return JSONObject(Meshiv.defaults.toString())
            p == "/api/stats" -> {
                val s = Meshiv.stateSnapshot()
                return (s.optJSONObject("stats") ?: JSONObject()).put("contacts", s.optJSONObject("contacts")?.length() ?: 0)
            }
            p == "/api/log" -> return Meshiv.logJson(query.substringAfter("since=", "0").toLongOrNull() ?: 0)
            p == "/api/contacts" -> {
                val contacts = Meshiv.stateSnapshot().optJSONObject("contacts") ?: JSONObject()
                val now = System.currentTimeMillis()
                val list = contacts.keys().asSequence().map { id ->
                    val c = contacts.getJSONObject(id)
                    JSONObject().put("id", id).put("name", c.optString("name"))
                        .put("firstSeen", c.opt("firstSeen") ?: JSONObject.NULL)
                        .put("pausedUntil", if (c.optLong("pausedUntil") > now) c.optLong("pausedUntil") else 0)
                        .put("today", c.optJSONObject("day")?.optInt("n") ?: 0)
                }.sortedByDescending { it.optLong("firstSeen") }.take(300).toList()
                return JSONArray(list)
            }
            p.startsWith("/api/contacts/") && m == "POST" -> {
                val parts = p.removePrefix("/api/contacts/").split("/")
                val id = java.net.URLDecoder.decode(parts.getOrNull(0).orEmpty(), "UTF-8")
                val act = parts.getOrNull(1)
                if (act != "pause" && act != "resume") throw HttpError(404, "לא נמצא")
                synchronized(Meshiv.engine) {
                    Meshiv.engine.contact(id).put("pausedUntil", if (act == "pause") System.currentTimeMillis() + 365L * 86400000 else 0)
                }
                Meshiv.saveState()
                return JSONObject().put("ok", true)
            }
            p == "/api/simulate" -> {
                val body = b ?: JSONObject()
                val phone = body.optString("phone", "972500000000").filter { it.isDigit() }
                val group = body.optBoolean("isGroup")
                val msg = Msg(
                    chatId = if (group) "120363000000000000@g.us" else "$phone@c.us",
                    from = "$phone@c.us",
                    name = body.optString("name"),
                    body = body.optString("body"),
                    isGroup = group,
                    fromMe = body.optBoolean("fromMe"),
                )
                return sim.handle(msg).toJson()
            }
            p == "/api/simulate/reset" -> {
                simState = JSONObject()
                sim = newSim()
                return JSONObject().put("ok", true)
            }
            p == "/api/ai/test" -> return try {
                JSONObject().put("ok", true).put("text", Ai.complete(Meshiv.config.optJSONObject("ai") ?: JSONObject(), listOf("user" to "ענה במילה אחת בלבד: שלום")))
            } catch (e: Exception) {
                JSONObject().put("ok", false).put("error", e.message)
            }
            p == "/api/whatsapp/start" || p == "/api/whatsapp/stop" -> {
                actions.openNotificationAccess()
                return JSONObject().put("ok", true)
            }
            p == "/api/android/battery" -> {
                actions.openBatterySettings()
                return JSONObject().put("ok", true)
            }
            p == "/api/android/share" -> {
                val body = b ?: throw HttpError(400, "חסר תוכן")
                actions.shareText(body.optString("name", "meshiv.json"), body.optString("text"))
                return JSONObject().put("ok", true)
            }
        }
        throw HttpError(404, "לא נמצא")
    }
}
