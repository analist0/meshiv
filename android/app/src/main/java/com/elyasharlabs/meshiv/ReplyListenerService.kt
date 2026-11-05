package com.elyasharlabs.meshiv

import android.app.Notification
import android.app.RemoteInput
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Parcelable
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

// ============================================================
// ReplyListenerService — מקבל את ההתראות של WhatsApp ועונה מתוכן
// (כמו "תשובה" מההתראה). לא צריך WhatsApp Web ולא open-wa.
// ============================================================
class ReplyListenerService : NotificationListenerService() {

    companion object {
        private val PACKAGES = setOf("com.whatsapp", "com.whatsapp.w4b")
        private const val DEDUPE_MS = 60_000L
        private const val BOT_ECHO_MS = 120_000L
        // התראות סיכום של WhatsApp, לא הודעה אמיתית
        private val SUMMARY = Regex("^\\d+\\s+(new messages|messages|הודעות חדשות|הודעות)", RegexOption.IGNORE_CASE)
    }

    private val worker = Executors.newSingleThreadExecutor() // שומר על סדר ההודעות
    private val seen = ConcurrentHashMap<String, Long>()
    private val botSent = ConcurrentHashMap<String, Long>()

    override fun onCreate() {
        super.onCreate()
        Meshiv.init(this)
    }

    override fun onListenerConnected() {
        Meshiv.addLog(JSONObject().put("dir", "sys").put("text", "✅ הרשאת התראות פעילה — משיב מאזין להודעות WhatsApp"))
    }

    override fun onListenerDisconnected() {
        Meshiv.addLog(JSONObject().put("dir", "sys").put("text", "⚠️ השירות נותק ממערכת ההתראות"))
    }

    override fun onDestroy() {
        worker.shutdown()
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in PACKAGES) return
        val n = sbn.notification ?: return
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val reply = n.actions?.firstOrNull { a -> a.remoteInputs?.any { it.allowFreeFormInput } == true } ?: return
        val parsed = parse(n.extras) ?: return

        val now = System.currentTimeMillis()
        seen.entries.removeIf { now - it.value > DEDUPE_MS }
        botSent.entries.removeIf { now - it.value > BOT_ECHO_MS }
        val key = "${parsed.chatId}\u0000${parsed.fromMe}\u0000${parsed.body}"
        if (seen.putIfAbsent(key, now) != null) return // WhatsApp מעדכן את אותה התראה כמה פעמים

        val msg = if (parsed.fromMe) parsed.copy(isBot = botSent.containsKey("${parsed.chatId}\u0000${parsed.body.trim()}")) else parsed
        worker.execute { process(msg, reply) }
    }

    private fun process(msg: Msg, action: Notification.Action) {
        if (msg.fromMe && msg.isBot) return
        if (!msg.fromMe) {
            synchronized(Meshiv.engine) { Meshiv.engine.contact(msg.chatId).put("name", msg.name) }
            Meshiv.addLog(JSONObject().put("dir", "in").put("chat", msg.chatId).put("name", msg.name).put("text", msg.body).put("group", msg.isGroup))
        }
        val d = try {
            Meshiv.engine.handle(msg)
        } catch (e: Exception) {
            Meshiv.addLog(JSONObject().put("dir", "sys").put("text", "שגיאה: ${e.message}"))
            return
        } finally {
            Meshiv.saveState()
        }
        if (msg.fromMe) {
            if (d.reason.startsWith("owner-")) {
                Meshiv.addLog(JSONObject().put("dir", "sys").put("chat", msg.chatId).put("text", if (d.reason == "owner-stop") "הבוט הושתק בצ'אט הזה" else "הבוט הופעל מחדש בצ'אט הזה"))
            }
            return
        }
        d.error?.let { Meshiv.addLog(JSONObject().put("dir", "sys").put("chat", msg.chatId).put("text", "AI: $it")) }
        if (d.replies.isEmpty()) {
            if (d.reason != "no-match") Meshiv.addLog(JSONObject().put("dir", "sys").put("chat", msg.chatId).put("text", "לא נשלחה תשובה (${d.reason})"))
            return
        }
        d.replies.forEachIndexed { i, text ->
            Thread.sleep(if (i == 0) d.delayMs else minOf(4000L, 600L + text.length * 25L))
            botSent["${msg.chatId}\u0000${text.trim()}"] = System.currentTimeMillis()
            try {
                send(action, text)
                Meshiv.addLog(JSONObject().put("dir", "out").put("chat", msg.chatId).put("name", msg.name).put("text", text).put("reason", d.reason))
            } catch (e: Exception) {
                Meshiv.addLog(JSONObject().put("dir", "sys").put("chat", msg.chatId).put("text", "❌ השליחה נכשלה: ${e.message}"))
                return
            }
        }
    }

    private fun send(action: Notification.Action, text: String) {
        val inputs = action.remoteInputs ?: return
        val results = Bundle().apply { inputs.forEach { putCharSequence(it.resultKey, text) } }
        val intent = Intent().addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
        RemoteInput.addResultsToIntent(inputs, intent, results)
        action.actionIntent.send(this, 0, intent)
    }

    /** מוציא מההתראה: מי שלח, באיזה צ'אט, ומה הטקסט האחרון. */
    private fun parse(ex: Bundle): Msg? {
        val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        if (title.isEmpty() || title.equals("WhatsApp", ignoreCase = true) || title.equals("WhatsApp Business", ignoreCase = true)) return null
        val convTitle = ex.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString()?.trim()
        val isGroup = ex.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION, false) || !convTitle.isNullOrEmpty()

        val messages: Array<Parcelable>? = if (Build.VERSION.SDK_INT >= 33) {
            ex.getParcelableArray(Notification.EXTRA_MESSAGES, Parcelable::class.java)
        } else {
            @Suppress("DEPRECATION") ex.getParcelableArray(Notification.EXTRA_MESSAGES)
        }
        val last = messages?.lastOrNull() as? Bundle
        val body: String
        var sender: String? = null
        var fromMe = false
        if (last != null) {
            body = last.getCharSequence("text")?.toString() ?: return null
            sender = last.getCharSequence("sender")?.toString()
            if (sender.isNullOrEmpty() && Build.VERSION.SDK_INT >= 28) {
                @Suppress("DEPRECATION")
                val person = last.get("sender_person") as? android.app.Person
                sender = person?.name?.toString()
            }
            // ב-MessagingStyle, הודעה בלי שולח היא של המשתמש עצמו
            fromMe = sender.isNullOrEmpty()
        } else {
            body = ex.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: return null
            if (SUMMARY.containsMatchIn(body.trim())) return null
        }
        if (body.isBlank()) return null

        val chatName = when {
            isGroup && !convTitle.isNullOrEmpty() -> convTitle.substringBefore(" (")
            isGroup -> title.substringBefore(":").trim()
            else -> title
        }
        val name = when {
            !sender.isNullOrEmpty() -> sender
            isGroup && title.contains(": ") -> title.substringAfter(": ").trim()
            else -> title
        }
        return Msg(
            chatId = (if (isGroup) "group:" else "contact:") + chatName,
            from = name,
            name = name,
            body = body,
            isGroup = isGroup,
            fromMe = fromMe,
        )
    }
}
