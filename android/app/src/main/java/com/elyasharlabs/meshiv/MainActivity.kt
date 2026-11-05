package com.elyasharlabs.meshiv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject
import java.util.concurrent.Executors

// ============================================================
// MainActivity — לוח הבקרה של משיב (אותו HTML כמו בשרת) בתוך WebView.
// הקריאות ל-/api עוברות דרך גשר JS לקוד Kotlin (Api.kt).
// ============================================================
class MainActivity : Activity(), Api.Actions {
    private lateinit var web: WebView
    private lateinit var api: Api
    private val io = Executors.newFixedThreadPool(2)
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    companion object {
        private const val PICK_FILE = 41
        private const val ORIGIN = "https://appassets.androidplatform.net"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Meshiv.init(this)
        api = Api(this, this)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        setContentView(web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.toString().startsWith(ORIGIN)) return false
                openUrl(request.url) // קישורים חיצוניים — בדפדפן
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    startActivityForResult(params.createIntent(), PICK_FILE)
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }
        }
        web.addJavascriptInterface(Bridge(), "MeshivAndroid")
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl("$ORIGIN/assets/www/index.html")
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        // חזרה מההגדרות — לרענן את מצב ההרשאה
        if (::web.isInitialized) web.evaluateJavascript("window.__meshivRefresh && window.__meshivRefresh()", null)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == PICK_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
            return
        }
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    override fun onDestroy() {
        io.shutdown()
        web.destroy()
        super.onDestroy()
    }

    inner class Bridge {
        /** בקשה אסינכרונית: התשובה חוזרת ל-window.__meshivResolve(id, status, json). */
        @JavascriptInterface
        fun request(id: String, path: String, method: String, body: String?) {
            io.execute {
                val (status, json) = api.handle(path, method, body)
                runOnUiThread {
                    if (!isFinishing) web.evaluateJavascript("window.__meshivResolve(${JSONObject.quote(id)}, $status, ${JSONObject.quote(json)})", null)
                }
            }
        }
    }

    // ---------- Api.Actions ----------
    override fun openNotificationAccess() = runOnUiThread {
        try {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            Toast.makeText(this, "הפעל את \"משיב\" ברשימה", Toast.LENGTH_LONG).show()
        } catch (e: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }

    override fun openBatterySettings() = runOnUiThread {
        try {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            Toast.makeText(this, "בחר \"משיב\" ← לא לבצע אופטימיזציה", Toast.LENGTH_LONG).show()
        } catch (e: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }

    override fun shareText(fileName: String, text: String) = runOnUiThread {
        val send = Intent(Intent.ACTION_SEND).setType("application/json")
            .putExtra(Intent.EXTRA_SUBJECT, fileName)
            .putExtra(Intent.EXTRA_TEXT, text)
        startActivity(Intent.createChooser(send, fileName))
    }

    private fun openUrl(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
        }
    }
}
