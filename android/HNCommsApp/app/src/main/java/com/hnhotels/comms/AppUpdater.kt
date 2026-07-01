package com.hnhotels.comms

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

data class RemoteVersion(
    val versionCode: Long,
    val versionName: String,
    val apkUrl: String,
    val notes: String,
)

object AppUpdater {
    private const val VERSION_URL = "https://hn-comms-app.pages.dev/version.json"

    suspend fun check(context: Context): RemoteVersion? = withContext(Dispatchers.IO) {
        val connection = (URL(VERSION_URL).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8_000
            readTimeout = 8_000
            requestMethod = "GET"
        }
        val body = connection.inputStream.bufferedReader().use { it.readText() }
        val json = JSONObject(body)
        val remote = RemoteVersion(
            versionCode = json.optLong("versionCode", 0),
            versionName = json.optString("versionName", ""),
            apkUrl = json.optString("apkUrl", ""),
            notes = json.optString("notes", ""),
        )
        if (remote.versionCode > localVersionCode(context) && remote.apkUrl.isNotBlank()) remote else null
    }

    suspend fun install(context: Context, remote: RemoteVersion) = withContext(Dispatchers.IO) {
        val target = File(context.externalCacheDir ?: context.cacheDir, "HN-Comms-update.apk")
        val connection = (URL(remote.apkUrl).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 60_000
            requestMethod = "GET"
        }
        connection.inputStream.use { input ->
            target.outputStream().use { output -> input.copyTo(output) }
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", target)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    private fun localVersionCode(context: Context): Long {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()
    }
}
