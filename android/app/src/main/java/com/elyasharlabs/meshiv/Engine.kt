package com.elyasharlabs.meshiv

import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.regex.Pattern
import kotlin.math.max
import kotlin.math.min

// ============================================================
// Engine.kt — מנוע המענה, תרגום נאמן של meshiv/src/engine.js.
// ההגדרות והמצב נשמרים כ-JSON באותו מבנה של השרת, כך שלוח
// הבקרה וקבצי הגיבוי זהים בשתי הגרסאות.
// ============================================================

data class Msg(
    val chatId: String,
    val from: String,
    val name: String,
    val body: String,
    val isGroup: Boolean = false,
    val fromMe: Boolean = false,
    val isBot: Boolean = false,
)

data class Decision(
    val reason: String,
    val replies: List<String>,
    val ruleId: String? = null,
    val error: String? = null,
    var delayMs: Long = 0,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("reason", reason)
        .put("replies", JSONArray(replies))
        .put("ruleId", ruleId ?: JSONObject.NULL)
        .put("delayMs", delayMs)
        .apply { if (error != null) put("error", error) }
}

typealias AiCall = (provider: JSONObject, messages: List<Pair<String, String>>) -> String

private val DAY_NAMES = listOf("ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת")
private val FINALS = mapOf('ך' to 'כ', 'ם' to 'מ', 'ן' to 'נ', 'ף' to 'פ', 'ץ' to 'צ')
private val CANTILLATION = Regex("[\\u0591-\\u05C7]")
private val COMBINING = Regex("[\\u0300-\\u036f]")
private val NON_WORD = Regex("[^\\p{L}\\p{N}\\s]")
private val SPACES = Regex("\\s+")

fun JSONObject.strings(key: String): List<String> {
    val a = optJSONArray(key) ?: return emptyList()
    return (0 until a.length()).map { a.optString(it) }
}

object Text {
    fun normalize(text: String?): String {
        var s = Normalizer.normalize((text ?: "").lowercase(), Normalizer.Form.NFKD)
        s = CANTILLATION.replace(s, "")
        s = COMBINING.replace(s, "")
        s = s.map { FINALS[it] ?: it }.joinToString("")
        s = NON_WORD.replace(s, " ")
        return SPACES.replace(s, " ").trim()
    }

    private fun levenshtein(a: String, b: String): Int {
        if (a == b) return 0
        if (a.isEmpty()) return b.length
        if (b.isEmpty()) return a.length
        var prev = IntArray(b.length + 1) { it }
        for (i in 1..a.length) {
            val cur = IntArray(b.length + 1)
            cur[0] = i
            for (j in 1..b.length) {
                cur[j] = min(min(prev[j] + 1, cur[j - 1] + 1), prev[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
            }
            prev = cur
        }
        return prev[b.length]
    }

    fun similarity(a: String, b: String): Double {
        val m = max(a.length, b.length)
        return if (m == 0) 1.0 else 1.0 - levenshtein(a, b).toDouble() / m
    }

    private fun fuzzyContains(text: String, keyword: String, threshold: Double): Boolean {
        if (keyword.isEmpty()) return false
        if (" $text ".contains(" $keyword ")) return true
        val words = text.split(" ")
        val n = keyword.split(" ").size
        var i = 0
        while (i + n <= words.size) {
            if (similarity(words.subList(i, i + n).joinToString(" "), keyword) >= threshold) return true
            i++
        }
        return false
    }

    fun matchRule(rule: JSONObject, body: String): Boolean {
        val text = normalize(body)
        val keywords = rule.strings("keywords")
        return when (rule.optString("match", "contains")) {
            "any" -> true
            "exact" -> keywords.any { normalize(it) == text }
            "startsWith" -> keywords.any { val k = normalize(it); k.isNotEmpty() && text.startsWith(k) }
            "endsWith" -> keywords.any { val k = normalize(it); k.isNotEmpty() && text.endsWith(k) }
            "regex" -> keywords.any {
                try {
                    Pattern.compile(it, Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE).matcher(body).find()
                } catch (e: Exception) {
                    false
                }
            }
            "fuzzy" -> keywords.any { fuzzyContains(text, normalize(it), rule.optDouble("fuzzyThreshold", 0.8)) }
            else -> keywords.any {
                val k = normalize(it)
                // מילים קצרות (עד 2 אותיות) — רק כמילה שלמה; ארוכות — גם עם תחילית (והמחיר, במחיר)
                k.isNotEmpty() && (" $text ".contains(" $k ") || (k.length > 2 && text.contains(k)))
            }
        }
    }
}

data class Parts(val day: Int, val hour: Int, val minute: Int, val dateKey: String, val date: String, val time: String, val ts: Long)

object Clock {
    fun parts(ts: Long, zone: String): Parts {
        val z = try { ZoneId.of(zone) } catch (e: Exception) { ZoneId.of("Asia/Jerusalem") }
        val d = ZonedDateTime.ofInstant(Instant.ofEpochMilli(ts), z)
        val dd = "%02d".format(d.dayOfMonth)
        val mm = "%02d".format(d.monthValue)
        return Parts(
            day = d.dayOfWeek.value % 7,
            hour = d.hour,
            minute = d.minute,
            dateKey = "${d.year}-$mm-$dd",
            date = "$dd/$mm/${d.year}",
            time = "%02d:%02d".format(d.hour, d.minute),
            ts = ts,
        )
    }

    private fun toMinutes(hhmm: String): Int {
        val p = hhmm.split(":")
        return (p.getOrNull(0)?.toIntOrNull() ?: 0) * 60 + (p.getOrNull(1)?.toIntOrNull() ?: 0)
    }

    fun inWindow(win: JSONObject?, p: Parts): Boolean {
        if (win == null) return true
        val daysArr = win.optJSONArray("days")
        val days = if (daysArr != null && daysArr.length() > 0) (0 until daysArr.length()).map { daysArr.optInt(it) } else (0..6).toList()
        val now = p.hour * 60 + p.minute
        val from = toMinutes(win.optString("from", "00:00"))
        val to = toMinutes(win.optString("to", "24:00"))
        if (from == to) return p.day in days
        if (from < to) return p.day in days && now >= from && now < to
        // חלון שחוצה חצות: אחרי חצות שייך ליום הקודם
        if (now >= from) return p.day in days
        if (now < to) return (p.day + 6) % 7 in days
        return false
    }

    fun greeting(hour: Int) = when (hour) {
        in 5..11 -> "בוקר טוב"
        in 12..16 -> "צהריים טובים"
        in 17..20 -> "ערב טוב"
        else -> "לילה טוב"
    }
}

fun fillTemplate(text: String, msg: Msg, p: Parts): String {
    val vars = mapOf(
        "name" to msg.name,
        "phone" to msg.from.substringBefore("@"),
        "date" to p.date,
        "time" to p.time,
        "day" to (DAY_NAMES.getOrNull(p.day) ?: ""),
        "greeting" to Clock.greeting(p.hour),
        "message" to msg.body,
    )
    return Regex("\\{(\\w+)\\}").replace(text) { m -> vars[m.groupValues[1]] ?: m.value }
        .replace(Regex("[ \\t]{2,}"), " ")
        .replace(Regex(" ([!?.,])"), "$1")
        .trim()
}

object Config {
    fun withDefaults(cfg: JSONObject?, defaults: JSONObject): JSONObject {
        val out = JSONObject(defaults.toString())
        if (cfg == null) return out
        for (k in cfg.keys()) out.put(k, cfg.get(k))
        for (k in listOf("delay", "welcome", "businessHours", "menu", "ai")) {
            val merged = JSONObject(defaults.optJSONObject(k)?.toString() ?: "{}")
            cfg.optJSONObject(k)?.let { c -> for (kk in c.keys()) merged.put(kk, c.get(kk)) }
            out.put(k, merged)
        }
        if (out.optJSONArray("rules") == null) out.put("rules", defaults.optJSONArray("rules") ?: JSONArray())
        return out
    }

    // מחזיר הודעת שגיאה בעברית, או null אם ההגדרות תקינות
    fun error(c: JSONObject?): String? {
        if (c == null) return "הגדרות לא תקינות"
        if (c.has("rules") && c.optJSONArray("rules") == null) return "rules חייב להיות רשימה"
        val rules = c.optJSONArray("rules") ?: return null
        for (i in 0 until rules.length()) {
            val r = rules.optJSONObject(i) ?: return "לכל חוק חייב להיות id"
            if (r.optString("id").isEmpty()) return "לכל חוק חייב להיות id"
            if (r.optString("match") != "regex") continue
            for (k in r.strings("keywords")) {
                try {
                    Pattern.compile(k)
                } catch (e: Exception) {
                    return "ביטוי רגולרי לא תקין בחוק \"${r.optString("name", r.optString("id"))}\": $k"
                }
            }
        }
        return null
    }
}

class Engine(
    private val getConfig: () -> JSONObject,
    val state: JSONObject,
    private val ai: AiCall? = null,
    private val now: () -> Long = { System.currentTimeMillis() },
    private val random: () -> Double = { Math.random() },
) {
    private val contacts: JSONObject
    private val stats: JSONObject
    private val rr: JSONObject

    init {
        contacts = state.optJSONObject("contacts") ?: JSONObject().also { state.put("contacts", it) }
        stats = state.optJSONObject("stats") ?: JSONObject()
            .put("incoming", 0).put("replied", 0).put("ai", 0).put("byRule", JSONObject()).put("byDay", JSONObject())
            .also { state.put("stats", it) }
        rr = state.optJSONObject("rr") ?: JSONObject().also { state.put("rr", it) }
    }

    @Synchronized
    fun contact(id: String): JSONObject = contacts.optJSONObject(id) ?: JSONObject()
        .put("firstSeen", JSONObject.NULL).put("lastWelcome", 0).put("lastAway", 0).put("ruleHits", JSONObject())
        .put("day", JSONObject().put("key", "").put("n", 0)).put("pausedUntil", 0).put("menu", JSONObject.NULL)
        .put("history", JSONArray())
        .also { contacts.put(id, it) }

    private fun inc(obj: JSONObject, key: String) = obj.put(key, obj.optLong(key, 0) + 1)

    private fun digits(s: String) = s.substringBefore("@").filter { it.isDigit() }

    // ברשימות אפשר לכתוב מספר טלפון או שם איש קשר (באנדרואיד יש רק שם)
    private fun listHas(list: List<String>, msg: Msg): Boolean = list.any { entry ->
        val d = digits(entry)
        (d.isNotEmpty() && d == digits(msg.from)) || (Text.normalize(entry).isNotEmpty() && Text.normalize(entry) == Text.normalize(msg.name))
    }

    private fun pickReply(rule: JSONObject): List<String> {
        val replies = rule.strings("replies").filter { it.isNotBlank() }
        if (replies.isEmpty()) return emptyList()
        return when (rule.optString("replyMode", "random")) {
            "sequence" -> {
                val id = rule.optString("id")
                val i = rr.optInt(id, 0)
                rr.put(id, (i + 1) % replies.size)
                listOf(replies[i % replies.size])
            }
            "all" -> replies
            else -> listOf(replies[(random() * replies.size).toInt().coerceIn(0, replies.size - 1)])
        }
    }

    private fun remember(c: JSONObject, role: String, content: String, cfg: JSONObject) {
        val max = max(0, cfg.optJSONObject("ai")?.optInt("memoryMessages", 10) ?: 10)
        if (max == 0) return
        val h = c.optJSONArray("history") ?: JSONArray().also { c.put("history", it) }
        h.put(JSONObject().put("role", role).put("content", content.take(2000)))
        while (h.length() > max) h.remove(0)
    }

    private fun menuText(node: JSONObject): String {
        val lines = mutableListOf(node.optString("title", "בחר:").ifEmpty { "בחר:" })
        val items = node.optJSONArray("items") ?: JSONArray()
        for (i in 0 until items.length()) lines += "${i + 1}. ${items.optJSONObject(i)?.optString("label")}"
        lines += ""
        lines += "0. חזרה לתפריט הראשי"
        return lines.joinToString("\n")
    }

    private fun menuNode(menu: JSONObject, path: JSONArray): JSONObject? {
        var node: JSONObject? = menu
        for (i in 0 until path.length()) node = node?.optJSONArray("items")?.optJSONObject(path.optInt(i))
        return node
    }

    private fun handleMenu(cfg: JSONObject, c: JSONObject, msg: Msg, p: Parts): List<String>? {
        val menu = cfg.optJSONObject("menu") ?: return null
        val items = menu.optJSONArray("items")
        if (!menu.optBoolean("enabled") || items == null || items.length() == 0) return null
        val text = Text.normalize(msg.body)
        val triggers = menu.strings("triggers").map { Text.normalize(it) }
        val cm = c.optJSONObject("menu")
        val active = cm != null && p.ts - cm.optLong("ts") < menu.optDouble("timeoutMinutes", 15.0) * 60000
        if (text in triggers && (text != "0" || active || triggers.size == 1)) {
            c.put("menu", JSONObject().put("path", JSONArray()).put("ts", p.ts))
            return listOf(menuText(menu))
        }
        if (!active) {
            c.put("menu", JSONObject.NULL)
            return null
        }
        val n = text.toIntOrNull()
        if (n == null || n.toString() != text) return null // לא בחירה — ממשיכים לחוקים
        if (n == 0) {
            c.put("menu", JSONObject().put("path", JSONArray()).put("ts", p.ts))
            return listOf(menuText(menu))
        }
        val path = cm!!.optJSONArray("path") ?: JSONArray()
        val node = menuNode(menu, path)
        val item = node?.optJSONArray("items")?.optJSONObject(n - 1)
            ?: return listOf("אין אפשרות $n.\n\n${menuText(node ?: menu)}")
        val sub = item.optJSONArray("items")
        if (sub != null && sub.length() > 0) {
            val next = JSONArray(path.toString()).put(n - 1)
            c.put("menu", JSONObject().put("path", next).put("ts", p.ts))
            return listOf(menuText(item))
        }
        c.put("menu", JSONObject.NULL)
        val pause = item.optDouble("pauseBotMinutes", 0.0)
        if (pause > 0) c.put("pausedUntil", p.ts + (pause * 60000).toLong())
        return listOf(item.optString("reply"))
    }

    @Synchronized
    fun handle(msg: Msg): Decision {
        val cfg = getConfig()
        val p = Clock.parts(now(), cfg.optString("timezone", "Asia/Jerusalem"))
        val c = contact(msg.chatId)
        val fill = { r: String -> fillTemplate(r, msg, p) }
        fun decision(reason: String, replies: List<String> = emptyList(), ruleId: String? = null, error: String? = null) =
            Decision(reason, replies.filter { it.isNotBlank() }, ruleId, error)

        // --- הודעות שלך ---
        if (msg.fromMe) {
            val body = Text.normalize(msg.body)
            if (cfg.optBoolean("ownerCommands", true) && body in listOf("עצור", "stop").map { Text.normalize(it) }) {
                c.put("pausedUntil", p.ts + 365L * 86400000)
                return decision("owner-stop")
            }
            if (cfg.optBoolean("ownerCommands", true) && body in listOf("המשך", "start").map { Text.normalize(it) }) {
                c.put("pausedUntil", 0)
                return decision("owner-start")
            }
            val takeover = cfg.optDouble("humanTakeoverMinutes", 30.0)
            if (!msg.isBot && takeover > 0) c.put("pausedUntil", max(c.optLong("pausedUntil"), p.ts + (takeover * 60000).toLong()))
            return decision("from-me")
        }

        inc(stats, "incoming")
        if (!cfg.optBoolean("enabled", true)) return decision("disabled")
        if (if (msg.isGroup) !cfg.optBoolean("replyToGroups") else !cfg.optBoolean("replyToPrivate", true)) {
            return decision(if (msg.isGroup) "group-off" else "private-off")
        }
        if (listHas(cfg.strings("ignoreContacts"), msg)) return decision("ignored-contact")
        val only = cfg.strings("onlyContacts")
        if (only.isNotEmpty() && !listHas(only, msg)) return decision("not-in-only-list")
        if (c.optLong("pausedUntil") > p.ts) return decision("paused")

        val day = c.optJSONObject("day") ?: JSONObject().also { c.put("day", it) }
        if (day.optString("key") != p.dateKey) day.put("key", p.dateKey).put("n", 0)
        val limit = cfg.optInt("dailyLimitPerContact", 30)
        if (limit > 0 && day.optInt("n") >= limit) return decision("daily-limit")

        remember(c, "user", msg.body, cfg)
        val out = mutableListOf<String>()
        var reason = "no-match"
        var ruleId: String? = null
        var stop = false

        // 1. ברוך הבא
        val isNew = c.isNull("firstSeen")
        if (isNew) c.put("firstSeen", p.ts)
        val w = cfg.optJSONObject("welcome")
        if (w != null && w.optBoolean("enabled")) {
            val every = w.optDouble("everyDays", 0.0)
            if (isNew || (every > 0 && p.ts - c.optLong("lastWelcome") >= every * 86400000)) {
                c.put("lastWelcome", p.ts)
                out += fill(w.optString("text"))
                reason = "welcome"
            }
        }

        // 2. מחוץ לשעות הפעילות
        val bh = cfg.optJSONObject("businessHours")
        if (bh != null && bh.optBoolean("enabled") && !Clock.inWindow(bh, p)) {
            if (p.ts - c.optLong("lastAway") >= bh.optDouble("awayCooldownMinutes", 180.0) * 60000) {
                c.put("lastAway", p.ts)
                out += fill(bh.optString("awayText"))
                reason = "away"
            }
            if (bh.optBoolean("stopAfterAway", true)) stop = true
        }

        // 3. תפריט
        if (!stop) {
            handleMenu(cfg, c, msg, p)?.let {
                out += it.map(fill)
                reason = "menu"
                stop = true
            }
        }

        // 4. חוקים
        val aiCfg = cfg.optJSONObject("ai") ?: JSONObject()
        val aiOn = aiCfg.optBoolean("enabled")
        var matched = false
        if (!stop && !(aiOn && aiCfg.optString("mode") == "always")) {
            val rules = cfg.optJSONArray("rules") ?: JSONArray()
            val hits = c.optJSONObject("ruleHits") ?: JSONObject().also { c.put("ruleHits", it) }
            for (i in 0 until rules.length()) {
                val rule = rules.optJSONObject(i) ?: continue
                if (!rule.optBoolean("enabled")) continue
                val scope = rule.optString("scope", "all")
                if (scope == "private" && msg.isGroup) continue
                if (scope == "groups" && !msg.isGroup) continue
                if (!rule.isNull("schedule") && rule.optJSONObject("schedule") != null && !Clock.inWindow(rule.optJSONObject("schedule"), p)) continue
                if (!Text.matchRule(rule, msg.body)) continue
                val id = rule.optString("id")
                val cooldown = rule.optDouble("cooldownMinutes", 0.0)
                if (cooldown > 0 && p.ts - hits.optLong(id, 0) < cooldown * 60000) {
                    matched = true // התאים אבל בהשהיה — לא נופלים ל-AI
                    if (!rule.optBoolean("continue")) break
                    continue
                }
                hits.put(id, p.ts)
                inc(stats.optJSONObject("byRule") ?: JSONObject().also { stats.put("byRule", it) }, id)
                matched = true
                ruleId = id
                reason = "rule"
                if (rule.optString("action") == "ai") {
                    matched = false
                    break
                }
                out += pickReply(rule).map(fill)
                val pause = rule.optDouble("pauseBotMinutes", 0.0)
                if (pause > 0) c.put("pausedUntil", p.ts + (pause * 60000).toLong())
                if (!rule.optBoolean("continue")) break
            }
        }

        // 5. AI
        if (!stop && !matched && aiOn && ai != null && msg.body.isNotBlank()) {
            try {
                val system = listOf(
                    aiCfg.optString("persona"),
                    aiCfg.optString("knowledge").let { if (it.isNotBlank()) "מידע על העסק (השתמש בו בלבד, אל תמציא):\n$it" else "" },
                    "שם הלקוח: ${msg.name.ifEmpty { "לא ידוע" }}. היום יום ${DAY_NAMES[p.day]}, ${p.date} ${p.time}.",
                ).filter { it.isNotBlank() }.joinToString("\n\n")
                val history = c.optJSONArray("history") ?: JSONArray()
                val messages = listOf("system" to system) + (0 until history.length()).map {
                    val h = history.getJSONObject(it)
                    h.optString("role") to h.optString("content")
                }
                val text = ai.invoke(aiCfg, messages).trim().take(aiCfg.optInt("maxReplyChars", 800))
                if (text.isNotEmpty()) {
                    out += text
                    inc(stats, "ai")
                    reason = if (reason == "welcome") "welcome+ai" else "ai"
                }
            } catch (e: Exception) {
                return finish(c, cfg, p, decision(if (reason == "welcome") "welcome" else "ai-error", out, ruleId, e.message ?: e.toString()))
            }
        }
        return finish(c, cfg, p, decision(reason, out, ruleId))
    }

    private fun finish(c: JSONObject, cfg: JSONObject, p: Parts, d: Decision): Decision {
        if (d.replies.isEmpty()) return d.also { it.delayMs = 0 }
        inc(c.getJSONObject("day"), "n")
        inc(stats, "replied")
        inc(stats.optJSONObject("byDay") ?: JSONObject().also { stats.put("byDay", it) }, p.dateKey)
        for (r in d.replies) remember(c, "assistant", r, cfg)
        val delay = cfg.optJSONObject("delay") ?: JSONObject()
        val lo = max(0.0, delay.optDouble("minSec", 0.0))
        val hi = max(lo, delay.optDouble("maxSec", lo))
        d.delayMs = ((lo + random() * (hi - lo)) * 1000).toLong()
        return d
    }
}
