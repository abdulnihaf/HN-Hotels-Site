package com.hnhotels.comms

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

class CommsApi(
    private val baseUrl: String,
    private val apiKey: String,
    private val client: OkHttpClient = OkHttpClient(),
) {
    private val jsonType = "application/json".toMediaType()

    suspend fun threads(source: String, brand: String, leadStatus: String, status: String, query: String): List<CommsThread> {
        val json = get(
            mapOf(
                "action" to "threads",
                "source" to source,
                "brand" to brand,
                "lead_status" to leadStatus,
                "status" to status,
                "q" to query,
            )
        )
        return json.getJSONArray("threads").mapObjects { it.toThread() }
    }

    suspend fun thread(threadId: String): Pair<CommsThread, List<CommsMessage>> {
        val json = get(mapOf("action" to "thread", "thread_id" to threadId))
        val thread = json.getJSONObject("thread").toThread()
        val messages = json.getJSONArray("messages").mapObjects { it.toMessage() }
        return thread to messages
    }

    suspend fun quickReplies(brand: String): List<QuickReply> {
        val json = get(mapOf("action" to "quick-replies", "brand" to brand))
        return json.getJSONArray("quick_replies").mapObjects { it.toQuickReply() }
    }

    suspend fun templates(brand: String): List<WabaTemplate> {
        val json = get(mapOf("action" to "templates", "brand" to brand))
        return json.getJSONArray("templates").mapObjects { it.toTemplate() }
            .filter { it.status == "APPROVED" }
    }

    suspend fun sendText(brand: String, phone: String, text: String): JSONObject {
        return post(
            mapOf("action" to "reply"),
            JSONObject()
                .put("brand", brand)
                .put("phone", phone)
                .put("text", text)
                .put("actor", "android")
        )
    }

    suspend fun sendTemplate(brand: String, phone: String, template: String, vars: List<String>): JSONObject {
        return post(
            mapOf("action" to "reply"),
            JSONObject()
                .put("brand", brand)
                .put("phone", phone)
                .put("template_name", template)
                .put("template_vars", JSONArray(vars))
                .put("actor", "android")
        )
    }

    suspend fun staff(): List<StaffMember> {
        val json = get(mapOf("action" to "staff"))
        return json.getJSONArray("staff").mapObjects { it.toStaffMember() }
    }

    suspend fun staffTemplates(): List<CampaignTemplate> {
        val json = get(mapOf("action" to "staff-templates"))
        return json.getJSONArray("templates").mapObjects { it.toCampaignTemplate() }
    }

    suspend fun sendStaffCampaign(template: CampaignTemplate, staff: StaffMember, vars: List<String>): JSONObject {
        return post(
            mapOf("action" to "staff-campaign"),
            JSONObject()
                .put("template", template.name)
                .put("recipients", JSONArray(listOf(staff.e164)))
                .put("vars", JSONArray(vars))
                .put("language", template.language.ifBlank { "en" })
                .put("actor", "android")
        )
    }

    suspend fun sendAttachment(
        context: Context,
        brand: String,
        phone: String,
        uri: Uri,
        caption: String,
    ): JSONObject = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val mimeType = resolver.getType(uri) ?: "application/octet-stream"
        val filename = displayName(context, uri)
        val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
            ?: throw IllegalStateException("Unable to read attachment")

        val multipart = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("brand", brand)
            .addFormDataPart("phone", phone)
            .addFormDataPart("caption", caption)
            .addFormDataPart("actor", "android")
            .addFormDataPart("file", filename, bytes.toRequestBody(mimeType.toMediaTypeOrNull()))
            .build()

        val request = Request.Builder()
            .url(url(mapOf("action" to "attachment")))
            .header("x-comms-key", apiKey)
            .header("accept", "application/json")
            .post(multipart)
            .build()
        execute(request)
    }

    suspend fun downloadMedia(context: Context, message: CommsMessage): DownloadedMedia = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(url(mapOf("action" to "media", "message_id" to message.id.toString())))
            .header("x-comms-key", apiKey)
            .build()
        client.newCall(request).execute().use { response ->
            val body = response.body ?: throw IllegalStateException("Empty media response")
            if (!response.isSuccessful) {
                throw IllegalStateException("HTTP ${response.code}: ${body.string().take(240)}")
            }
            val mediaType = body.contentType()?.toString() ?: response.header("content-type").orEmpty().ifBlank { "application/octet-stream" }
            val directory = File(context.cacheDir, "HNCommsMedia").also { it.mkdirs() }
            val filename = safeFilename("${message.id}-${message.mediaTitle}${extensionFor(mediaType, message.msgType)}")
            val target = File(directory, filename)
            target.writeBytes(body.bytes())
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", target)
            DownloadedMedia(uri, mediaType)
        }
    }

    suspend fun markRead(threadId: String) {
        post(
            mapOf("action" to "mark-read"),
            JSONObject().put("thread_id", threadId)
        )
    }

    private suspend fun get(query: Map<String, String>): JSONObject = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(url(query))
            .header("x-comms-key", apiKey)
            .header("accept", "application/json")
            .get()
            .build()
        execute(request)
    }

    private suspend fun post(query: Map<String, String>, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(url(query))
            .header("x-comms-key", apiKey)
            .header("accept", "application/json")
            .post(body.toString().toRequestBody(jsonType))
            .build()
        execute(request)
    }

    private fun execute(request: Request): JSONObject {
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw IllegalStateException("HTTP ${response.code}: ${body.take(240)}")
            }
            return JSONObject(body)
        }
    }

    private fun url(query: Map<String, String>): okhttp3.HttpUrl {
        val root = baseUrl.trim().trimEnd('/')
        val builder = "$root/api/comms-inbox".toHttpUrl().newBuilder()
        query.forEach { (key, value) ->
            if (value.isNotBlank()) builder.addQueryParameter(key, value)
        }
        return builder.build()
    }
}

data class DownloadedMedia(val uri: Uri, val mimeType: String)

private fun displayName(context: Context, uri: Uri): String {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0) return cursor.getString(index).orEmpty().ifBlank { "attachment" }
        }
    }
    return uri.lastPathSegment?.substringAfterLast('/')?.ifBlank { "attachment" } ?: "attachment"
}

private fun extensionFor(contentType: String, msgType: String): String {
    val lowered = contentType.lowercase()
    return when {
        lowered.contains("pdf") -> ".pdf"
        lowered.contains("png") -> ".png"
        lowered.contains("jpeg") || lowered.contains("jpg") -> ".jpg"
        lowered.contains("mp4") -> ".mp4"
        lowered.contains("mpeg") || lowered.contains("mp3") -> ".mp3"
        msgType == "image" -> ".jpg"
        msgType == "video" -> ".mp4"
        msgType == "audio" -> ".mp3"
        msgType == "document" -> ".bin"
        else -> ""
    }
}

private fun safeFilename(raw: String): String =
    raw.replace(Regex("[^A-Za-z0-9._() -]+"), "_").take(180).ifBlank { "media" }

private fun <T> JSONArray.mapObjects(block: (JSONObject) -> T): List<T> =
    List(length()) { index -> block(getJSONObject(index)) }

private fun JSONObject.s(name: String): String = optString(name, "")

private fun JSONObject.toThread() = CommsThread(
    threadId = s("thread_id"),
    brand = s("brand"),
    brandLabel = s("brand_label"),
    phone = s("phone"),
    displayName = s("display_name"),
    leadStatus = s("lead_status").ifBlank { "unknown" },
    leadSource = s("lead_source"),
    assignedTo = s("assigned_to"),
    status = s("status"),
    lastMessageAt = s("last_message_at"),
    lastBody = s("last_body"),
    lastDirection = s("last_direction"),
    lastMsgType = s("last_msg_type"),
    unreadCount = optInt("unread_count", 0),
    serviceWindowExpiresAt = s("service_window_expires_at"),
    serviceWindowOpen = optBoolean("service_window_open", false),
    serviceWindowMinutesRemaining = optInt("service_window_minutes_remaining", 0),
    leadContext = optJSONObject("lead_context")?.toLeadContext() ?: LeadContext(),
)

private fun JSONObject.toMessage() = CommsMessage(
    id = optInt("id", 0),
    threadId = s("thread_id"),
    brand = s("brand"),
    phone = s("phone"),
    direction = s("direction"),
    msgType = s("msg_type"),
    body = s("body"),
    templateName = s("template_name"),
    wamid = s("wamid"),
    status = s("status"),
    errorText = s("error_text"),
    mediaId = s("media_id"),
    actor = s("actor"),
    createdAt = s("created_at"),
)

private fun JSONObject.toQuickReply() = QuickReply(
    id = optInt("id", 0),
    brand = s("brand"),
    title = s("title"),
    body = s("body"),
)

private fun JSONObject.toTemplate() = WabaTemplate(
    id = s("id").ifBlank { s("name") },
    name = s("name"),
    status = s("status"),
    category = s("category"),
    language = s("language"),
    components = optJSONArray("components")?.mapObjects { it.toTemplateComponent() } ?: emptyList(),
)

private fun JSONObject.toTemplateComponent() = TemplateComponent(
    type = s("type"),
    text = s("text"),
    format = s("format"),
)

private fun JSONObject.toLeadContext() = LeadContext(
    source = s("source"),
    campaignName = s("campaign_name"),
    campaignRole = s("campaign_role"),
    candidateName = s("candidate_name"),
    staffName = s("staff_name"),
    staffBrand = s("staff_brand"),
    staffRole = s("staff_role"),
)

private fun JSONObject.toStaffMember() = StaffMember(
    id = optInt("id", 0),
    name = s("name").ifBlank { s("known_as") },
    phone = s("phone"),
    e164 = s("e164"),
    brand = s("brand"),
    role = s("role"),
    wabaStatus = s("waba_status"),
)

private fun JSONObject.toCampaignTemplate() = CampaignTemplate(
    id = s("id").ifBlank { s("name") },
    name = s("name"),
    status = s("status"),
    category = s("category"),
    language = s("language"),
    bodyText = s("body_text"),
    varCount = optInt("var_count", 0),
)
