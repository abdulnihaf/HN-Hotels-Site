package com.hnhotels.comms

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.content.pm.PackageManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        NotificationHelper.ensureChannel(this)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2101)
        }
        setContent {
            val store = remember { CommsStore(applicationContext) }
            HNCommsTheme {
                HNCommsApp(store)
            }
        }
    }
}

object NotificationHelper {
    private const val CHANNEL_ID = "hn-comms-inbox"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(CHANNEL_ID, "HN Comms inbox", NotificationManager.IMPORTANCE_DEFAULT)
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    fun notifyUnread(context: Context, unreadCount: Int) {
        if (unreadCount <= 0) return
        if (Build.VERSION.SDK_INT >= 33 && ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("HN Comms")
            .setContentText("$unreadCount unread WhatsApp message${if (unreadCount == 1) "" else "s"}")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(2101, notification)
    }
}

class CommsStore(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = context.getSharedPreferences("hn-comms", Context.MODE_PRIVATE)
    var baseUrl by mutableStateOf(prefs.getString("baseUrl", "https://hnhotels.in") ?: "https://hnhotels.in")
    var apiKey by mutableStateOf(prefs.getString("apiKey", null) ?: BuildConfig.HN_COMMS_APP_KEY)
    var selectedTab by mutableStateOf("inbox")
    var selectedSource by mutableStateOf("all")
    var selectedBrand by mutableStateOf("all")
    var selectedStaffBrand by mutableStateOf("all")
    var selectedLeadStatus by mutableStateOf("all")
    var query by mutableStateOf("")
    var threads by mutableStateOf<List<CommsThread>>(emptyList())
    var currentThread by mutableStateOf<CommsThread?>(null)
    var messages by mutableStateOf<List<CommsMessage>>(emptyList())
    var quickReplies by mutableStateOf<List<QuickReply>>(emptyList())
    var templates by mutableStateOf<List<WabaTemplate>>(emptyList())
    var draft by mutableStateOf("")
    var templateVars by mutableStateOf<List<String>>(emptyList())
    var staff by mutableStateOf<List<StaffMember>>(emptyList())
    var staffTemplates by mutableStateOf<List<CampaignTemplate>>(emptyList())
    var selectedStaffTemplate by mutableStateOf<CampaignTemplate?>(null)
    var staffTemplateVars by mutableStateOf<List<String>>(emptyList())
    var loading by mutableStateOf(false)
    var sending by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var remoteUpdate by mutableStateOf<RemoteVersion?>(null)
    private var lastUnreadNotified = 0

    val configured: Boolean get() = apiKey.isNotBlank() && !apiKey.contains("${'$'}(")
    val sourceForApi: String get() = if (selectedSource == "unread") "all" else selectedSource
    val statusForApi: String get() = if (selectedSource == "unread") "unread" else "all"
    val pollKey: String get() = "$configured|$selectedTab|$selectedSource|$selectedBrand|$selectedStaffBrand|$selectedLeadStatus|$query|${currentThread?.threadId.orEmpty()}"
    private val api: CommsApi get() = CommsApi(baseUrl, apiKey)

    fun save() {
        prefs.edit().putString("baseUrl", baseUrl).putString("apiKey", apiKey).apply()
    }

    fun clear() {
        prefs.edit().remove("apiKey").apply()
        apiKey = ""
        threads = emptyList()
        currentThread = null
        messages = emptyList()
    }

    suspend fun refreshThreads(silent: Boolean = false) {
        if (!configured) return
        if (!silent) loading = true
        runCatching {
            api.threads(sourceForApi, selectedBrand, selectedLeadStatus, statusForApi, query)
        }.onSuccess {
            val unread = it.sumOf { thread -> thread.unreadCount }
            if (silent && unread > lastUnreadNotified) {
                NotificationHelper.notifyUnread(appContext, unread)
            }
            lastUnreadNotified = unread
            threads = it
            error = null
        }.onFailure {
            error = it.message
        }
        if (!silent) loading = false
    }

    suspend fun openThread(threadId: String, markRead: Boolean = true) {
        runCatching {
            val (thread, rows) = api.thread(threadId)
            currentThread = thread
            messages = rows
            quickReplies = api.quickReplies(thread.brand)
            templates = api.templates(thread.brand)
            if (markRead) api.markRead(threadId)
        }.onFailure {
            error = it.message
        }
    }

    suspend fun sendDraft() {
        val thread = currentThread ?: return
        val text = draft.trim()
        if (text.isEmpty() || !thread.serviceWindowOpen) return
        sending = true
        runCatching {
            api.sendText(thread.brand, thread.phone, text)
        }.onSuccess {
            if (it.optBoolean("ok", false)) {
                draft = ""
            } else {
                error = it.optString("error", "Send failed")
            }
            openThread(thread.threadId, markRead = false)
            refreshThreads(silent = true)
        }.onFailure {
            error = it.message
        }
        sending = false
    }

    suspend fun sendAttachment(uri: Uri) {
        val thread = currentThread ?: return
        if (!thread.serviceWindowOpen) {
            error = "Attachments can only be sent inside the 24-hour WhatsApp window. Use a template first."
            return
        }
        sending = true
        val caption = draft.trim()
        runCatching {
            api.sendAttachment(appContext, thread.brand, thread.phone, uri, caption)
        }.onSuccess {
            if (it.optBoolean("ok", false)) {
                draft = ""
            } else {
                error = it.optString("error", "Attachment send failed")
            }
            openThread(thread.threadId, markRead = false)
            refreshThreads(silent = true)
        }.onFailure {
            error = it.message
        }
        sending = false
    }

    suspend fun downloadMedia(context: Context, message: CommsMessage): DownloadedMedia? {
        return runCatching { api.downloadMedia(context, message) }
            .onFailure { error = it.message }
            .getOrNull()
    }

    suspend fun sendTemplate(template: WabaTemplate, vars: List<String>) {
        val thread = currentThread ?: return
        sending = true
        runCatching {
            api.sendTemplate(thread.brand, thread.phone, template.name, vars)
        }.onSuccess {
            if (!it.optBoolean("ok", false)) error = it.optString("error", "Template send failed")
            templateVars = emptyList()
            openThread(thread.threadId, markRead = false)
            refreshThreads(silent = true)
        }.onFailure {
            error = it.message
        }
        sending = false
    }

    suspend fun refreshStaffLayer() {
        if (!configured) return
        loading = true
        runCatching {
            val rows = api.staff()
            val templates = api.staffTemplates()
            rows to templates
        }.onSuccess { (rows, templates) ->
            staff = rows
            staffTemplates = templates
            if (selectedStaffTemplate == null) {
                selectedStaffTemplate = templates.firstOrNull()
                staffTemplateVars = List(selectedStaffTemplate?.varCount ?: 0) { "" }
            }
            error = null
        }.onFailure {
            error = it.message
        }
        loading = false
    }

    suspend fun sendStaffTemplate(member: StaffMember) {
        val template = selectedStaffTemplate ?: return
        sending = true
        runCatching {
            api.sendStaffCampaign(template, member, staffTemplateVars)
        }.onSuccess {
            if (!it.optBoolean("ok", false)) error = it.optString("error", "Staff template failed")
            refreshThreads(silent = true)
        }.onFailure {
            error = it.message
        }
        sending = false
    }

    suspend fun checkForUpdate() {
        runCatching {
            AppUpdater.check(appContext)
        }.onSuccess {
            remoteUpdate = it
        }
    }

    suspend fun installUpdate() {
        val update = remoteUpdate ?: return
        runCatching {
            AppUpdater.install(appContext, update)
        }.onFailure {
            error = it.message
        }
    }
}

@Composable
fun HNCommsTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Color(0xFF0F766E),
            secondary = Color(0xFF4F46E5),
            tertiary = Color(0xFFB45309),
            surface = Color(0xFFF8FAFC),
            background = Color(0xFFF8FAFC),
        ),
        content = content
    )
}

@Composable
fun HNCommsApp(store: CommsStore) {
    val scope = rememberCoroutineScope()
    if (!store.configured) {
        SettingsScreen(store)
    } else if (store.currentThread != null) {
        ThreadScreen(store)
    } else if (store.selectedTab == "darbar") {
        DarbarScreen(store)
    } else {
        InboxScreen(store)
    }

    LaunchedEffect(Unit) {
        store.checkForUpdate()
    }

    LaunchedEffect(store.pollKey) {
        if (!store.configured) return@LaunchedEffect
        if (store.selectedTab == "darbar") {
            store.selectedSource = "darbar_staff"
            store.refreshStaffLayer()
        }
        store.refreshThreads()
        while (true) {
            delay(15_000)
            store.refreshThreads(silent = true)
            if (store.selectedTab == "darbar") store.refreshStaffLayer()
            store.currentThread?.let { store.openThread(it.threadId, markRead = false) }
        }
    }

    store.error?.let { message ->
        AlertDialog(
            onDismissRequest = { store.error = null },
            confirmButton = { TextButton(onClick = { store.error = null }) { Text("OK") } },
            title = { Text("HN Comms") },
            text = { Text(message) }
        )
    }

    store.remoteUpdate?.let { update ->
        AlertDialog(
            onDismissRequest = { store.remoteUpdate = null },
            confirmButton = {
                TextButton(onClick = { scope.launch { store.installUpdate() } }) {
                    Text("Install")
                }
            },
            dismissButton = {
                TextButton(onClick = { store.remoteUpdate = null }) {
                    Text("Later")
                }
            },
            title = { Text("Update available") },
            text = { Text("HN Comms ${update.versionName} is available. ${update.notes}") }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(store: CommsStore) {
    val scope = rememberCoroutineScope()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("HN Comms") },
                actions = {
                    IconButton(onClick = { store.clear() }) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            TabRow(selectedTabIndex = 0) {
                Tab(selected = true, onClick = { store.selectedTab = "inbox" }, text = { Text("Inbox") })
                Tab(selected = false, onClick = { store.selectedTab = "darbar" }, text = { Text("From Darbar") })
            }
            OutlinedTextField(
                value = store.query,
                onValueChange = { store.query = it },
                label = { Text("Search") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
            FilterRow(
                selected = store.selectedSource,
                values = listOf("all" to "All", "unread" to "Unread", "hiring" to "Hiring", "darbar_staff" to "Darbar", "customer" to "Customers"),
                onSelect = { store.selectedSource = it }
            )
            FilterRow(
                selected = store.selectedBrand,
                values = listOf("all" to "All", "he" to "HE", "nch" to "NCH", "sparksol" to "Spark"),
                onSelect = { store.selectedBrand = it }
            )
            FilterRow(
                selected = store.selectedLeadStatus,
                values = listOf("all" to "All", "unknown" to "Unknown", "new" to "New", "warm" to "Warm", "active" to "Active"),
                onSelect = { store.selectedLeadStatus = it }
            )

            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(store.threads, key = { it.threadId }) { thread ->
                    ThreadCard(thread) {
                        scope.launch { store.openThread(thread.threadId) }
                    }
                }
            }
        }
    }
}

@Composable
fun FilterRow(selected: String, values: List<Pair<String, String>>, onSelect: (String) -> Unit) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(values) { (value, label) ->
            FilterChip(
                selected = selected == value,
                onClick = { onSelect(value) },
                label = { Text(label) }
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DarbarScreen(store: CommsStore) {
    val scope = rememberCoroutineScope()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("HN Comms") },
                actions = {
                    IconButton(onClick = { store.clear() }) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            TabRow(selectedTabIndex = 1) {
                Tab(selected = false, onClick = { store.selectedTab = "inbox" }, text = { Text("Inbox") })
                Tab(selected = true, onClick = { store.selectedTab = "darbar" }, text = { Text("From Darbar") })
            }
            FilterRow(
                selected = store.selectedStaffBrand,
                values = listOf("all" to "All staff", "HE" to "HE", "NCH" to "NCH", "HQ" to "HQ"),
                onSelect = { store.selectedStaffBrand = it }
            )
            TemplateSelector(
                templates = store.staffTemplates,
                selected = store.selectedStaffTemplate,
                vars = store.staffTemplateVars,
                onTemplate = {
                    store.selectedStaffTemplate = it
                    store.staffTemplateVars = List(it.varCount) { "" }
                },
                onVar = { index, value ->
                    store.staffTemplateVars = store.staffTemplateVars.toMutableList().also { if (index in it.indices) it[index] = value }
                }
            )
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val rows = store.staff.filter { member ->
                    store.selectedStaffBrand == "all" || member.brand.equals(store.selectedStaffBrand, ignoreCase = true)
                }
                items(rows, key = { it.id }) { member ->
                    StaffCard(member, store.selectedStaffTemplate, store.sending) {
                        scope.launch { store.sendStaffTemplate(member) }
                    }
                }
            }
        }
    }
}

@Composable
fun TemplateSelector(
    templates: List<CampaignTemplate>,
    selected: CampaignTemplate?,
    vars: List<String>,
    onTemplate: (CampaignTemplate) -> Unit,
    onVar: (Int, String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(templates, key = { it.id }) { template ->
                FilterChip(
                    selected = selected?.id == template.id,
                    onClick = { onTemplate(template) },
                    label = { Text(template.name, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                )
            }
        }
        selected?.let { template ->
            Text(template.bodyText.ifBlank { template.name }, style = MaterialTheme.typography.bodySmall, color = Color(0xFF475569), maxLines = 3, overflow = TextOverflow.Ellipsis)
            repeat(template.varCount) { index ->
                OutlinedTextField(
                    value = vars.getOrNull(index).orEmpty(),
                    onValueChange = { onVar(index, it) },
                    label = { Text("Template variable ${index + 1}") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }
}

@Composable
fun StaffCard(member: StaffMember, template: CampaignTemplate?, sending: Boolean, onSend: () -> Unit) {
    ElevatedCard(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.elevatedCardColors(containerColor = Color.White)
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            BrandBadge("sparksol")
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(member.name.ifBlank { member.e164 }, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(listOf(member.brand, member.role, member.e164).filter { it.isNotBlank() }.joinToString(" · "), color = Color(0xFF64748B), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("Template-only via SparkSol", color = Color(0xFFB45309), style = MaterialTheme.typography.labelSmall)
            }
            Button(enabled = template != null && !sending, onClick = onSend) {
                Text("Send")
            }
        }
    }
}

@Composable
fun ThreadCard(thread: CommsThread, onClick: () -> Unit) {
    ElevatedCard(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.elevatedCardColors(containerColor = Color.White)
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.Top
        ) {
            BrandBadge(thread.brand)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(thread.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.weight(1f))
                    if (thread.unreadCount > 0) {
                        Text(
                            "${thread.unreadCount}",
                            color = Color.White,
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier
                                .clip(CircleShape)
                                .background(Color(0xFF0F766E))
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                        )
                    }
                }
                Text(
                    thread.lastBody.ifBlank { thread.phone },
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color(0xFF475569),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (thread.serviceWindowOpen) "Open ${thread.serviceWindowMinutesRemaining}m" else "Template only", color = if (thread.serviceWindowOpen) Color(0xFF0F766E) else Color(0xFFB45309))
                    Text(thread.laneLabel, color = Color(0xFF334155))
                    Text(thread.leadStatus, color = Color(0xFF64748B))
                }
                if (thread.leadContext.primary.isNotBlank() || thread.leadContext.secondary.isNotBlank()) {
                    Text(
                        listOf(thread.leadContext.primary, thread.leadContext.secondary).filter { it.isNotBlank() }.joinToString(" · "),
                        color = Color(0xFF64748B),
                        style = MaterialTheme.typography.labelSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}

@Composable
fun BrandBadge(brand: String) {
    val color = when (brand) {
        "he" -> Color(0xFF4F46E5)
        "nch" -> Color(0xFF16A34A)
        "sparksol" -> Color(0xFFB45309)
        else -> Color(0xFF64748B)
    }
    val label = when (brand) {
        "he" -> "HE"
        "nch" -> "NCH"
        "sparksol" -> "SP"
        else -> brand.take(2).uppercase()
    }
    Box(
        modifier = Modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(color.copy(alpha = 0.14f)),
        contentAlignment = Alignment.Center
    ) {
        Text(label, color = color, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelSmall)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThreadScreen(store: CommsStore) {
    val thread = store.currentThread ?: return
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var templatesOpen by remember { mutableStateOf(false) }
    var selectedTemplate by remember { mutableStateOf<WabaTemplate?>(null) }
    val attachmentPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { scope.launch { store.sendAttachment(it) } }
    }

    LaunchedEffect(store.messages.size) {
        if (store.messages.isNotEmpty()) listState.animateScrollToItem(store.messages.lastIndex)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = { store.currentThread = null; store.messages = emptyList() }) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                title = { Text(thread.title, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            )
        },
        bottomBar = {
            Surface(shadowElevation = 8.dp) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(store.quickReplies, key = { it.id }) { reply ->
                            AssistChip(onClick = { store.draft = reply.body }, label = { Text(reply.title) })
                        }
                    }
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = store.draft,
                            onValueChange = { store.draft = it },
                            enabled = thread.serviceWindowOpen,
                            label = { Text(if (thread.serviceWindowOpen) "Reply" else "Template required") },
                            modifier = Modifier.weight(1f),
                            minLines = 1,
                            maxLines = 4
                        )
                        Box {
                            IconButton(onClick = { templatesOpen = true }) {
                                Icon(Icons.Default.Description, contentDescription = "Templates")
                            }
                            DropdownMenu(expanded = templatesOpen, onDismissRequest = { templatesOpen = false }) {
                                if (store.templates.isEmpty()) {
                                    DropdownMenuItem(text = { Text("No approved templates") }, onClick = { templatesOpen = false })
                                } else {
                                    store.templates.forEach { template ->
                                        DropdownMenuItem(
                                            text = { Text(template.name) },
                                            onClick = {
                                                templatesOpen = false
                                                selectedTemplate = template
                                                store.templateVars = List(template.variableCount) { "" }
                                            }
                                        )
                                    }
                                }
                            }
                        }
                        IconButton(
                            enabled = thread.serviceWindowOpen && !store.sending,
                            onClick = {
                                attachmentPicker.launch(
                                    arrayOf(
                                        "image/*",
                                        "video/*",
                                        "audio/*",
                                        "application/pdf",
                                        "text/plain",
                                        "application/msword",
                                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                        "application/octet-stream"
                                    )
                                )
                            }
                        ) {
                            Icon(Icons.Default.AttachFile, contentDescription = "Attach", tint = Color(0xFF475569))
                        }
                        IconButton(
                            enabled = thread.serviceWindowOpen && store.draft.isNotBlank() && !store.sending,
                            onClick = { scope.launch { store.sendDraft() } }
                        ) {
                            Icon(Icons.Default.Send, contentDescription = "Send", tint = Color(0xFF0F766E))
                        }
                    }
                    selectedTemplate?.let { template ->
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(template.bodyText.ifBlank { template.name }, color = Color(0xFF475569), style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            repeat(template.variableCount) { index ->
                                OutlinedTextField(
                                    value = store.templateVars.getOrNull(index).orEmpty(),
                                    onValueChange = { value ->
                                        store.templateVars = store.templateVars.toMutableList().also { if (index in it.indices) it[index] = value }
                                    },
                                    label = { Text("Template variable ${index + 1}") },
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(enabled = !store.sending, onClick = {
                                    scope.launch {
                                        store.sendTemplate(template, store.templateVars)
                                        selectedTemplate = null
                                    }
                                }) {
                                    Text("Send template")
                                }
                                TextButton(onClick = { selectedTemplate = null; store.templateVars = emptyList() }) {
                                    Text("Cancel")
                                }
                            }
                        }
                    }
                }
            }
        }
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            ContactPanel(thread)
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(store.messages, key = { it.id }) { message ->
                    MessageBubble(
                        message = message,
                        onOpenMedia = {
                            scope.launch {
                                val media = store.downloadMedia(context, message) ?: return@launch
                                val intent = Intent(Intent.ACTION_VIEW)
                                    .setDataAndType(media.uri, media.mimeType)
                                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                runCatching { context.startActivity(intent) }
                                    .onFailure { store.error = "No app available to open this file." }
                            }
                        }
                    )
                }
            }
        }
    }
}

@Composable
fun ContactPanel(thread: CommsThread) {
    Column(Modifier.fillMaxWidth().background(Color.White).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            BrandBadge(thread.brand)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(thread.brandLabel, style = MaterialTheme.typography.labelLarge)
                Text(thread.phone.replaceFirst("91", "+91 "), color = Color(0xFF64748B))
            }
            Text(if (thread.serviceWindowOpen) "${thread.serviceWindowMinutesRemaining}m" else "Template", color = if (thread.serviceWindowOpen) Color(0xFF0F766E) else Color(0xFFB45309))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AssistChip(onClick = {}, label = { Text("Lead: ${thread.leadStatus}") })
            AssistChip(onClick = {}, label = { Text(thread.laneLabel) })
            if (thread.leadSource.isNotBlank()) AssistChip(onClick = {}, label = { Text(thread.leadSource) })
        }
        if (thread.leadContext.primary.isNotBlank() || thread.leadContext.secondary.isNotBlank()) {
            Text(
                listOf(thread.leadContext.primary, thread.leadContext.secondary).filter { it.isNotBlank() }.joinToString(" · "),
                color = Color(0xFF475569),
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
fun MessageBubble(message: CommsMessage, onOpenMedia: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (message.outbound) Arrangement.End else Arrangement.Start) {
        Column(
            modifier = Modifier
                .fillMaxWidth(0.84f)
                .clip(RoundedCornerShape(14.dp))
                .background(if (message.outbound) Color(0xFFE0F2F1) else Color.White)
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp)
        ) {
            if (message.templateName.isNotBlank()) {
                Text(message.templateName, color = Color(0xFF64748B), style = MaterialTheme.typography.labelSmall)
            }
            if (message.hasMedia) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color(0xFFF1F5F9))
                        .clickable(onClick = onOpenMedia)
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(Icons.Default.AttachFile, contentDescription = null, tint = Color(0xFF0F766E))
                    Column(Modifier.weight(1f)) {
                        Text(message.mediaTitle, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(message.msgType.uppercase(), color = Color(0xFF64748B), style = MaterialTheme.typography.labelSmall)
                    }
                }
            } else {
                Text(message.body)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(message.createdAt.take(16).replace("T", " "), color = Color(0xFF64748B), style = MaterialTheme.typography.labelSmall)
                if (message.outbound) {
                    Text(message.status, color = if (message.status == "failed") Color(0xFFDC2626) else Color(0xFF64748B), style = MaterialTheme.typography.labelSmall)
                }
            }
            if (message.errorText.isNotBlank()) {
                Text(message.errorText, color = Color(0xFFDC2626), style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(store: CommsStore) {
    val scope = rememberCoroutineScope()
    Scaffold(
        topBar = { TopAppBar(title = { Text("HN Comms") }) }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            OutlinedTextField(
                value = store.baseUrl,
                onValueChange = { store.baseUrl = it },
                label = { Text("Server") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = store.apiKey,
                onValueChange = { store.apiKey = it },
                label = { Text("API key") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Button(
                onClick = {
                    store.save()
                    scope.launch { store.refreshThreads() }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Save")
            }
        }
    }
}
