package moe.wuwaviewer

import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.zip.ZipFile
import kotlin.concurrent.thread

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private val modelsDir by lazy { File(filesDir, "models").apply { mkdirs() } }
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val pickZip = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) importZip(uri) else js("__wuwa.importDone", JSONObject().put("error", "cancelled").toString())
    }
    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val data = res.data
        val uris = when {
            res.resultCode != RESULT_OK || data == null -> null
            data.clipData != null -> Array(data.clipData!!.itemCount) { data.clipData!!.getItemAt(it).uri }
            data.data != null -> arrayOf(data.data!!)
            else -> null
        }
        fileCallback?.onReceiveValue(uris)
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web = WebView(this)
        web.setBackgroundColor(0xFF0E1016.toInt())
        setContentView(web)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/models/", ModelsHandler())
            .build()

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            setSupportZoom(false)
            builtInZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
        }
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != "appassets.androidplatform.net"
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val types = params.acceptTypes.flatMap { it.split(",") }.map { it.trim() }.filter { it.contains("/") }
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = if (types.size == 1) types[0] else "*/*"
                    if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
                }
                return try { pickFile.launch(intent); true } catch (e: Exception) { fileCallback = null; false }
            }
        }
        web.addJavascriptInterface(Bridge(), "WuwaNative")
        WebView.setWebContentsDebuggingEnabled(true)
        web.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.__wuwaBack ? window.__wuwaBack() : false") { r ->
                    if (r != "true") finish()
                }
            }
        })
        handleIntent(intent)
    }

    // Music: tell the page directly when the app leaves / returns to the screen (the WebView's own
    // visibility events are not reliable when the activity is paused).
    override fun onPause() {
        super.onPause()
        if (::web.isInitialized) web.evaluateJavascript("window.__wuwaAudio && window.__wuwaAudio(false)", null)
    }

    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) web.evaluateJavascript("window.__wuwaAudio && window.__wuwaAudio(true)", null)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val uri: Uri? = when (intent?.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
            else -> null
        }
        if (uri != null) web.postDelayed({ importZip(uri) }, 800)
    }

    private fun js(fn: String, vararg args: String) {
        val a = args.joinToString(",") { JSONObject.quote(it) }
        runOnUiThread { web.evaluateJavascript("window.$fn && window.$fn($a)", null) }
    }
    private fun progress(pct: Int, msg: String) = runOnUiThread {
        web.evaluateJavascript("window.__wuwa && __wuwa.importProgress($pct, ${JSONObject.quote(msg)})", null)
    }

    /** Serves imported model files: /models/<id>/<path inside the zip> */
    inner class ModelsHandler : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse? {
            val f = File(modelsDir, path).canonicalFile
            if (!f.path.startsWith(modelsDir.canonicalPath) || !f.isFile) {
                return WebResourceResponse("text/plain", "utf-8", 404, "Not found", mapOf("Access-Control-Allow-Origin" to "*"), null)
            }
            val mime = when (f.extension.lowercase()) {
                "png" -> "image/png"; "jpg", "jpeg" -> "image/jpeg"; "json" -> "application/json"
                else -> "application/octet-stream"
            }
            return WebResourceResponse(mime, null, 200, "OK", mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "no-cache"), FileInputStream(f))
        }
    }

    private fun displayName(uri: Uri): String {
        var name = "Model"
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0)?.let { name = it }
        }
        return name.removeSuffix(".zip").removeSuffix(".ZIP")
    }

    private fun importZip(uri: Uri) {
        thread(name = "import") {
            val tmp = File(cacheDir, "import.zip")
            var target: File? = null
            try {
                val name = displayName(uri)
                progress(0, "Copying $name…")
                val total = contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: -1L
                contentResolver.openInputStream(uri)!!.use { input ->
                    tmp.outputStream().use { out ->
                        val buf = ByteArray(1 shl 16)
                        var done = 0L
                        var last = -1
                        while (true) {
                            val n = input.read(buf); if (n < 0) break
                            out.write(buf, 0, n); done += n
                            if (total > 0) { val p = (done * 40 / total).toInt(); if (p != last) { last = p; progress(p, "Copying $name…") } }
                        }
                    }
                }
                var id = name.replace(Regex("[^A-Za-z0-9._ -]"), "_").trim().ifEmpty { "model" }
                if (File(modelsDir, id).exists()) id = "$id-${System.currentTimeMillis() / 1000}"
                val dir = File(modelsDir, id).apply { mkdirs() }
                target = dir
                val files = JSONArray()
                var size = 0L
                ZipFile(tmp).use { zip ->
                    val entries = zip.entries().toList().filter { !it.isDirectory }
                    if (entries.none { it.name.endsWith(".uemodel", true) }) throw IOException("the .zip contains no .uemodel models")
                    entries.forEachIndexed { i, e ->
                        val rel = e.name.replace('\\', '/').trimStart('/')
                        val out = File(dir, rel).canonicalFile
                        if (!out.path.startsWith(dir.canonicalPath + File.separator)) return@forEachIndexed // zip slip guard
                        out.parentFile?.mkdirs()
                        zip.getInputStream(e).use { inp -> out.outputStream().use { inp.copyTo(it, 1 shl 16) } }
                        files.put(rel)
                        size += out.length()
                        if (i % 10 == 0) progress(40 + i * 60 / entries.size, "Unpacking ${i + 1}/${entries.size}")
                    }
                }
                File(dir, "index.json").writeText(JSONObject().put("files", files).toString())
                File(dir, "meta.json").writeText(JSONObject().put("name", name).put("size", size).put("files", files.length()).put("date", System.currentTimeMillis()).toString())
                progress(100, "Done")
                js("__wuwa.importDone", JSONObject().put("id", id).put("name", name).toString())
            } catch (e: Throwable) {
                target?.deleteRecursively()
                js("__wuwa.importDone", JSONObject().put("error", e.message ?: e.toString()).toString())
            } finally {
                tmp.delete()
            }
        }
    }

    inner class Bridge {
        @JavascriptInterface
        fun listModels(): String {
            val arr = JSONArray()
            modelsDir.listFiles()?.filter { it.isDirectory }?.sortedByDescending { it.lastModified() }?.forEach { d ->
                val meta = try { JSONObject(File(d, "meta.json").readText()) } catch (e: Exception) { JSONObject().put("name", d.name) }
                arr.put(meta.put("id", d.name))
            }
            return arr.toString()
        }

        @JavascriptInterface
        fun importZip() = runOnUiThread { pickZip.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream", "*/*")) }

        @JavascriptInterface
        fun deleteModel(id: String) {
            val d = File(modelsDir, id).canonicalFile
            if (d.parentFile == modelsDir.canonicalFile) d.deleteRecursively()
        }

        @JavascriptInterface
        fun renameModel(id: String, name: String) {
            val f = File(File(modelsDir, id), "meta.json")
            val meta = try { JSONObject(f.readText()) } catch (e: Exception) { JSONObject() }
            f.writeText(meta.put("name", name).toString())
        }

        /** Size of every file of a model: {"path": bytes}. */
        @JavascriptInterface
        fun fileSizes(id: String): String {
            val dir = File(modelsDir, id).canonicalFile
            val out = JSONObject()
            if (dir.parentFile != modelsDir.canonicalFile) return out.toString()
            dir.walkTopDown().filter { it.isFile && it.name != "index.json" && it.name != "meta.json" }.forEach {
                out.put(it.relativeTo(dir).path.replace(File.separatorChar, '/'), it.length())
            }
            return out.toString()
        }

        /** Delete some files of a model (e.g. combat animations) and rewrite its index and size. */
        @JavascriptInterface
        fun deleteFiles(id: String, pathsJson: String) {
            val dir = File(modelsDir, id).canonicalFile
            if (dir.parentFile != modelsDir.canonicalFile) return
            val arr = JSONArray(pathsJson)
            for (i in 0 until arr.length()) {
                val f = File(dir, arr.getString(i)).canonicalFile
                if (f.path.startsWith(dir.path + File.separator) && f.isFile) f.delete()
            }
            val files = JSONArray()
            var size = 0L
            dir.walkTopDown().filter { it.isFile && !it.name.endsWith(".part") && it.name != "index.json" && it.name != "meta.json" }.forEach {
                files.put(it.relativeTo(dir).path.replace(File.separatorChar, '/')); size += it.length()
            }
            File(dir, "index.json").writeText(JSONObject().put("files", files).toString())
            val mf = File(dir, "meta.json")
            val meta = try { JSONObject(mf.readText()) } catch (e: Exception) { JSONObject().put("name", id) }
            mf.writeText(meta.put("size", size).put("files", files.length()).toString())
        }

        /** {"used": bytes used by models, "free": free bytes on the app's storage} */
        @JavascriptInterface
        fun storageInfo(): String {
            var used = 0L
            modelsDir.walkTopDown().filter { it.isFile }.forEach { used += it.length() }
            return JSONObject().put("used", used).put("free", filesDir.usableSpace).toString()
        }

        /** Reserve a folder for a model downloaded from encore.moe. */
        @JavascriptInterface
        fun newModelId(name: String): String {
            var id = name.replace(Regex("[^A-Za-z0-9._ -]"), "_").trim().ifEmpty { "model" }
            if (File(modelsDir, id).exists()) id = "$id-${System.currentTimeMillis() / 1000}"
            File(modelsDir, id).mkdirs()
            return id
        }

        /** Download `paths` (relative to /Game/) from the encore.moe storage into models/<id>/. */
        @JavascriptInterface
        fun downloadBatch(id: String, base: String, pathsJson: String, token: String) {
            val dir = File(modelsDir, id).canonicalFile
            val arr = JSONArray(pathsJson)
            val paths = List(arr.length()) { arr.getString(it) }
            thread(name = "dl") {
                val pool = Executors.newFixedThreadPool(5)
                val done = AtomicInteger(0)
                val bytes = AtomicLong(0)
                val failed = java.util.Collections.synchronizedList(mutableListOf<String>())
                for (p in paths) pool.execute {
                    try {
                        val out = File(dir, p).canonicalFile
                        if (!out.path.startsWith(dir.path + File.separator)) throw IOException("invalid path")
                        if (!out.exists()) {
                            val url = URL(base + p.split('/').joinToString("/") { Uri.encode(it) })
                            var ok = false
                            var lastErr: Exception? = null
                            for (attempt in 0 until 3) {
                                try {
                                    val c = url.openConnection() as HttpURLConnection
                                    c.connectTimeout = 20000; c.readTimeout = 60000
                                    c.setRequestProperty("User-Agent", "WuwaViewer/1.1")
                                    if (c.responseCode != 200) { c.disconnect(); throw IOException("HTTP ${c.responseCode}") }
                                    out.parentFile?.mkdirs()
                                    val tmp = File(out.path + ".part")
                                    c.inputStream.use { i -> tmp.outputStream().use { o -> bytes.addAndGet(i.copyTo(o, 1 shl 16)) } }
                                    c.disconnect()
                                    tmp.renameTo(out)
                                    ok = true; break
                                } catch (e: IOException) {
                                    lastErr = e
                                    if (e.message?.startsWith("HTTP 4") == true) break
                                    Thread.sleep(800L * (attempt + 1))
                                }
                            }
                            if (!ok) throw lastErr ?: IOException("error")
                        }
                    } catch (e: Exception) {
                        failed.add(p)
                    }
                    val n = done.incrementAndGet()
                    if (n % 3 == 0 || n == paths.size) runOnUiThread {
                        web.evaluateJavascript("window.__wuwa && __wuwa.dlProgress(${JSONObject.quote(token)}, $n, ${paths.size}, ${bytes.get()})", null)
                    }
                }
                pool.shutdown()
                pool.awaitTermination(2, java.util.concurrent.TimeUnit.HOURS)
                js("__wuwa.dlDone", token, JSONArray(failed.toList()).toString())
            }
        }

        /** Write index.json / meta.json for a downloaded model. */
        @JavascriptInterface
        fun finalizeModel(id: String, name: String): String {
            val dir = File(modelsDir, id)
            val files = JSONArray()
            var size = 0L
            dir.walkTopDown().filter { it.isFile && !it.name.endsWith(".part") && it.name != "index.json" && it.name != "meta.json" }.forEach {
                files.put(it.relativeTo(dir).path.replace(File.separatorChar, '/')); size += it.length()
            }
            File(dir, "index.json").writeText(JSONObject().put("files", files).toString())
            File(dir, "meta.json").writeText(JSONObject().put("name", name).put("size", size).put("files", files.length()).put("date", System.currentTimeMillis()).put("source", "encore.moe").toString())
            return id
        }

        @JavascriptInterface
        fun saveBase64(name: String, b64: String, mime: String) = save(name, Base64.decode(b64, Base64.DEFAULT), mime)

        @JavascriptInterface
        fun saveText(name: String, text: String, mime: String) = save(name, text.toByteArray(), mime)
    }

    private fun save(name: String, bytes: ByteArray, mime: String) {
        thread {
            val isImage = mime.startsWith("image/")
            val folder = if (isImage) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_DOWNLOADS
            val where = "$folder/WuwaViewer"
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    val values = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                        put(MediaStore.MediaColumns.MIME_TYPE, mime)
                        put(MediaStore.MediaColumns.RELATIVE_PATH, where)
                    }
                    val col = if (isImage) MediaStore.Images.Media.EXTERNAL_CONTENT_URI else MediaStore.Downloads.EXTERNAL_CONTENT_URI
                    val uri = contentResolver.insert(col, values) ?: throw IOException("could not create the file")
                    contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
                    js("__wuwa.fileSaved", "Saved to $where/$name")
                } else {
                    val dir = File(getExternalFilesDir(folder), "WuwaViewer").apply { mkdirs() }
                    File(dir, name).writeBytes(bytes)
                    js("__wuwa.fileSaved", "Saved to ${dir.path}/$name")
                }
            } catch (e: Exception) {
                js("__wuwa.fileSaved", "Could not save: ${e.message}")
            }
        }
    }
}
