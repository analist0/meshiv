package com.elyasharlabs.meshiv

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

// אותם תרחישים כמו meshiv/test/engine.test.js — המנוע ב-Kotlin חייב להתנהג זהה
class EngineTest {
    private val defaults = JSONObject(File("../../meshiv/src/default-config.json").readText())
    private val tue14 = java.time.Instant.parse("2026-11-03T12:00:00Z").toEpochMilli() // שלישי 14:00 בישראל

    private inner class Setup(patch: (JSONObject) -> Unit = {}, ai: AiCall? = null) {
        val config: JSONObject = JSONObject(defaults.toString()).apply {
            put("delay", JSONObject().put("minSec", 0).put("maxSec", 0))
            patch(this)
        }
        var now = tue14
        val engine = Engine({ config }, JSONObject(), ai, { now }, { 0.0 })
        fun send(body: String, fromMe: Boolean = false, isGroup: Boolean = false, chat: String = "contact:דנה", name: String = "דנה") =
            engine.handle(Msg(chatId = chat, from = name, name = name, body = body, isGroup = isGroup, fromMe = fromMe))
    }

    private fun noWelcome(c: JSONObject) { c.getJSONObject("welcome").put("enabled", false) }

    @Test fun normalize() {
        assertEquals("שלומ", Text.normalize("שָׁלוֹם!!"))
        assertEquals("כמה עולה", Text.normalize("  כמה   עולה?"))
    }

    @Test fun matchTypes() {
        fun rule(match: String, vararg k: String) = JSONObject().put("match", match).put("keywords", JSONArray(k.toList())).put("fuzzyThreshold", 0.75)
        assertTrue(Text.matchRule(rule("exact", "שלום"), "שלום!"))
        assertFalse(Text.matchRule(rule("exact", "שלום"), "שלום לך"))
        assertTrue(Text.matchRule(rule("contains", "מחיר"), "מה המחיר בבקשה"))
        assertFalse(Text.matchRule(rule("contains", "הי"), "שאלה כלשהי"))
        assertTrue(Text.matchRule(rule("startsWith", "הזמנה"), "הזמנה מספר 5"))
        assertTrue(Text.matchRule(rule("regex", "^\\d{4}$"), "1234"))
        assertFalse(Text.matchRule(rule("regex", "(("), "x"))
        assertTrue(Text.matchRule(rule("fuzzy", "שלום"), "שלוםם מה קורה"))
        assertTrue(Text.matchRule(rule("any"), "כל דבר"))
    }

    @Test fun windows() {
        val p = Clock.parts(tue14, "Asia/Jerusalem")
        assertEquals(2, p.day)
        assertEquals(14, p.hour)
        assertTrue(Clock.inWindow(JSONObject("""{"days":[2],"from":"09:00","to":"18:00"}"""), p))
        assertFalse(Clock.inWindow(JSONObject("""{"days":[3],"from":"09:00","to":"18:00"}"""), p))
        val night = Clock.parts(java.time.Instant.parse("2026-11-03T23:30:00Z").toEpochMilli(), "Asia/Jerusalem")
        assertTrue(Clock.inWindow(JSONObject("""{"days":[2],"from":"22:00","to":"02:00"}"""), night))
    }

    @Test fun welcomeThenRule() {
        val s = Setup()
        val d1 = s.send("מה המחיר?")
        assertEquals(2, d1.replies.size)
        assertTrue(d1.replies[0].contains("צהריים טובים דנה"))
        assertTrue(d1.replies[1].contains("מחירון"))
        val d2 = s.send("והמחיר למשלוח?")
        assertEquals(1, d2.replies.size)
        assertEquals("rule", d2.reason)
    }

    @Test fun cooldown() {
        val s = Setup(::noWelcome)
        assertEquals(1, s.send("היי").replies.size)
        assertEquals(0, s.send("היי").replies.size)
        s.now += 61 * 60000
        assertEquals(1, s.send("היי").replies.size)
    }

    @Test fun menu() {
        val s = Setup(::noWelcome)
        assertTrue(s.send("תפריט").replies[0].contains("1. שעות פעילות"))
        assertTrue(s.send("3").replies[0].contains("בחר שירות"))
        assertTrue(s.send("2").replies[0].contains("תאר את התקלה"))
        assertNotEquals("menu", s.send("2").reason)
    }

    @Test fun humanAgentFromMenuPausesBot() {
        val s = Setup(::noWelcome)
        s.send("תפריט")
        s.send("4")
        assertEquals("paused", s.send("היי").reason)
        s.now += 121 * 60000
        assertEquals("rule", s.send("היי").reason)
    }

    @Test fun awayOnce() {
        val s = Setup({ c -> noWelcome(c); c.getJSONObject("businessHours").put("enabled", true).put("days", JSONArray(listOf(0))) })
        val d = s.send("היי")
        assertEquals("away", d.reason)
        assertEquals(1, d.replies.size)
        assertEquals(0, s.send("היי").replies.size)
    }

    @Test fun ownerCommandsAndTakeover() {
        val s = Setup(::noWelcome)
        s.send("אני כאן", fromMe = true)
        assertEquals("paused", s.send("היי").reason)
        s.send("!המשך", fromMe = true)
        assertEquals("rule", s.send("היי").reason)
    }

    @Test fun groupsBlacklistByNameAndDailyLimit() {
        val s = Setup({ c -> noWelcome(c); c.put("dailyLimitPerContact", 1) })
        assertEquals("group-off", s.send("היי", isGroup = true, chat = "group:משפחה").reason)
        assertEquals("rule", s.send("מחיר").reason)
        assertEquals("daily-limit", s.send("מחיר").reason)
        s.config.put("ignoreContacts", JSONArray(listOf("דנה")))
        assertEquals("ignored-contact", s.send("מחיר").reason)
    }

    @Test fun aiFallbackWithMemory() {
        val calls = mutableListOf<List<Pair<String, String>>>()
        val s = Setup({ c -> noWelcome(c); c.getJSONObject("ai").put("enabled", true).put("knowledge", "פתוחים עד 20:00") }) { _, m ->
            calls += m
            "תשובה מה-AI {name}"
        }
        val d = s.send("עד מתי אתם פתוחים?")
        assertEquals("ai", d.reason)
        assertEquals("תשובה מה-AI {name}", d.replies[0])
        assertTrue(calls[0][0].second.contains("פתוחים עד 20:00"))
        s.send("ומחר?")
        assertEquals(listOf("user", "assistant", "user"), calls[1].drop(1).map { it.first })
        assertEquals("rule", s.send("מחיר").reason)
    }

    @Test fun aiErrorDoesNotCrash() {
        val s = Setup({ c -> noWelcome(c); c.getJSONObject("ai").put("enabled", true) }) { _, _ -> throw RuntimeException("boom") }
        val d = s.send("שאלה כלשהי")
        assertEquals("ai-error", d.reason)
        assertEquals("boom", d.error)
        assertEquals(0, d.replies.size)
    }

    @Test fun configValidation() {
        assertEquals(null, Config.error(defaults))
        assertTrue(Config.error(JSONObject("""{"rules":[{"id":"x","match":"regex","keywords":["(("]}]}""")).orEmpty().contains("ביטוי רגולרי"))
        val merged = Config.withDefaults(JSONObject("""{"rules":[],"menu":{"enabled":false}}"""), defaults)
        assertEquals(4, merged.getJSONObject("menu").getJSONArray("items").length())
        assertFalse(merged.getJSONObject("menu").getBoolean("enabled"))
    }
}
