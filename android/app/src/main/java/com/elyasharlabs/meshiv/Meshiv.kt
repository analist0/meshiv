package com.elyasharlabs.meshiv

import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// ============================================================
// Meshiv.kt — המצב המשותף של האפליקציה: הגדרות, מנוע, יומן.
// שירות ההתראות ולוח הבקרה רצים באותו תהליך ומשתמשים בו.
// ============================================================
object Meshiv {
    private const val LOG_MAX = 500
    private lateinit var dir: File
    lateinit var defaults: JSONObject
        private set
    @Volatile
    var config: JSONObject = JSONObject()
        private set
    lateinit var engine: Engine
        private set
    private lateinit var state: JSONObject
    private val log = ArrayDeque<JSONObject>()
    private var initialized = false

    @Synchronized
    fun init(context: Context) {
        if (initialized) return
        val app = context.applicationContext
        dir = app.filesDir
        defaults = JSONObject(app.assets.open("default-config.json").bufferedReader().use { it.readText() })
        config = Config.withDefaults(readJson("config.json"), defaults)
        state = readJson("state.json") ?: JSONObject()
        engine = Engine({ config }, state, Ai::complete)
        readJson("log.json")?.optJSONArray("entries")?.let { a -> for (i in 0 until a.length()) log.addLast(a.getJSONObject(i)) }
        initialized = true
    }

    private fun readJson(name: String): JSONObject? = try {
        val f = File(dir, name)
        if (f.exists()) JSONObject(f.readText()) else null
    } catch (e: Exception) {
        null
    }

    // כתיבה אטומית: קובץ זמני ואז שינוי שם
    private fun writeJson(name: String, data: JSONObject) {
        val tmp = File(dir, "$name.tmp")
        tmp.writeText(data.toString())
        tmp.renameTo(File(dir, name))
    }

    @Synchronized
    fun saveConfig(c: JSONObject) {
        config = Config.withDefaults(c, defaults)
        writeJson("config.json", config)
    }

    @Synchronized
    fun saveState() = synchronized(engine) { writeJson("state.json", state) }

    fun stateSnapshot(): JSONObject = synchronized(engine) { JSONObject(state.toString()) }

    @Synchronized
    fun addLog(entry: JSONObject) {
        entry.put("ts", System.currentTimeMillis())
        log.addLast(entry)
        while (log.size > LOG_MAX) log.removeFirst()
        writeJson("log.json", JSONObject().put("entries", JSONArray(log.toList().takeLast(100))))
    }

    @Synchronized
    fun logJson(since: Long = 0): JSONArray = JSONArray(log.filter { it.optLong("ts") > since })

    fun notificationAccess(context: Context): Boolean {
        val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return false
        val me = ComponentName(context, ReplyListenerService::class.java)
        return enabled.split(":").any { ComponentName.unflattenFromString(it) == me }
    }
}
