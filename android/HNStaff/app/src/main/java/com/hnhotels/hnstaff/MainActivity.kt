package com.hnhotels.hnstaff

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.compose.ui.platform.LocalContext
import java.io.File
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.*

// ---- config / theme -------------------------------------------------------
private const val BASE = "https://hn-ops-api.pages.dev/api/ops"
private val Maroon = Color(0xFF581810)
private val Sand = Color(0xFFF5F0EF)
private val Ink = Color(0xFF2A1A14)
private val Muted = Color(0xFF8A7A72)
private val GoodG = Color(0xFF2E7D32)
private val WarnA = Color(0xFFB26A00)

private var PIN: String = ""

fun rupee(paise: Int): String {
    if (paise == 0) return "—"
    val r = paise / 100
    val s = StringBuilder(r.toString()).reverse()
    val out = StringBuilder()
    for (i in s.indices) { if (i != 0 && i % 3 == 0) out.append(','); out.append(s[i]) }
    return "₹" + out.reverse().toString()
}
fun todayIst(): String {
    val f = SimpleDateFormat("yyyy-MM-dd", Locale.US); f.timeZone = TimeZone.getTimeZone("Asia/Kolkata")
    return f.format(Date())
}
fun defaultPurchaseDateIst(): String {
    return todayIst()
}
fun stepDate(d: String, days: Int): String {
    val f = SimpleDateFormat("yyyy-MM-dd", Locale.US); f.timeZone = TimeZone.getTimeZone("Asia/Kolkata")
    val c = Calendar.getInstance(TimeZone.getTimeZone("Asia/Kolkata")); c.time = f.parse(d)!!; c.add(Calendar.DAY_OF_MONTH, days)
    return f.format(c.time)
}
fun prettyDate(d: String): String = try {
    val inF = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    val outF = SimpleDateFormat("EEE d MMM", Locale.US); outF.format(inF.parse(d)!!)
} catch (e: Exception) { d }

// ---- API ------------------------------------------------------------------
object Api {
    private fun conn(u: String): HttpURLConnection {
        val c = URL(u).openConnection() as HttpURLConnection
        c.connectTimeout = 12000; c.readTimeout = 15000
        c.setRequestProperty("x-ops-pin", PIN)
        c.setRequestProperty("User-Agent", "HNStaff-Android")
        return c
    }
    suspend fun get(qs: String): JSONObject = withContext(Dispatchers.IO) {
        val c = conn("$BASE?$qs&pin=$PIN")
        try { JSONObject(readAll(c)) } catch (e: Exception) { err(e) } finally { c.disconnect() }
    }
    suspend fun post(action: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val c = conn("$BASE?action=$action&pin=$PIN")
        c.requestMethod = "POST"; c.doOutput = true; c.setRequestProperty("content-type", "application/json")
        try { c.outputStream.use { it.write(body.toString().toByteArray()) }; JSONObject(readAll(c)) }
        catch (e: Exception) { err(e) } finally { c.disconnect() }
    }
    private fun readAll(c: HttpURLConnection): String {
        val code = c.responseCode
        return (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: "{}"
    }
    private fun err(e: Exception) = JSONObject().put("ok", false).put("error", e.message ?: "network error")
}

// ---- self-update (sideload-friendly): check version.json, download + install ----
private const val VERSION_URL = "https://hn-ops-api.pages.dev/version.json"
object Updater {
    fun installedCode(ctx: Context): Long = try {
        val p = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) p.longVersionCode else @Suppress("DEPRECATION") p.versionCode.toLong()
    } catch (e: Exception) { 0L }

    // returns the update JSON {versionCode,url,versionName,notes} if a newer one exists, else null
    suspend fun check(ctx: Context): JSONObject? = withContext(Dispatchers.IO) {
        try {
            val c = URL(VERSION_URL).openConnection() as HttpURLConnection
            c.connectTimeout = 8000; c.readTimeout = 8000
            val txt = c.inputStream.bufferedReader().readText(); c.disconnect()
            val j = JSONObject(txt)
            if (j.optLong("versionCode") > installedCode(ctx)) j else null
        } catch (e: Exception) { null }
    }

    // download the apk to cache and launch the system installer; returns error string or null
    suspend fun downloadAndInstall(ctx: Context, url: String): String? = withContext(Dispatchers.IO) {
        try {
            val out = File(ctx.externalCacheDir, "HN-Staff-update.apk")
            val c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = 12000; c.readTimeout = 30000
            c.inputStream.use { i -> out.outputStream().use { o -> i.copyTo(o) } }
            c.disconnect()
            val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", out)
            val i = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(i)
            null
        } catch (e: Exception) { e.message ?: "update failed" }
    }
}

// ---- nav model ------------------------------------------------------------
sealed class Screen {
    object Home : Screen()
    data class PurchaseDay(val date: String) : Screen()
    data class Day(val outlet: String, val date: String) : Screen()
    data class Card(val id: Int, val outlet: String, val date: String) : Screen()
    data class Place(val outlet: String, val date: String) : Screen()
    data class Directory(val outlet: String, val date: String) : Screen()
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Maroon, onPrimary = Color.White)) { App() }
        }
    }
}

@Composable
fun App() {
    var me by remember { mutableStateOf<JSONObject?>(null) }
    val m = me
    if (m == null) PinGate { authed, pin -> PIN = pin; me = authed }
    else StaffShell(m)
}

// ---- PIN gate -------------------------------------------------------------
@Composable
fun PinGate(onAuthed: (JSONObject, String) -> Unit) {
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(
        Modifier.fillMaxSize().background(Maroon).padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center
    ) {
        Text("HN Hotels", color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Text("Staff Console", color = Color.White.copy(alpha = 0.7f), fontSize = 15.sp)
        Spacer(Modifier.height(44.dp))
        OutlinedTextField(
            value = pin, onValueChange = { if (it.length <= 4) { pin = it; error = "" } },
            label = { Text("PIN", color = Color.White.copy(alpha = 0.7f)) },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Color.White, unfocusedBorderColor = Color.White.copy(alpha = 0.5f),
                focusedTextColor = Color.White, unfocusedTextColor = Color.White, cursorColor = Color.White),
            modifier = Modifier.width(190.dp)
        )
        if (error.isNotEmpty()) { Spacer(Modifier.height(8.dp)); Text(error, color = Color(0xFFFF9A9A), fontSize = 13.sp) }
        Spacer(Modifier.height(22.dp))
        Button(
            onClick = {
                if (pin.length < 4 || busy) return@Button
                busy = true; error = ""
                scope.launch {
                    PIN = pin
                    val r = Api.get("action=me")
                    busy = false
                    if (r.optBoolean("ok")) onAuthed(r, pin) else { error = r.optString("error", "Incorrect PIN"); pin = "" }
                }
            },
            shape = RoundedCornerShape(8.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color.White),
            modifier = Modifier.width(190.dp).height(50.dp)
        ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Maroon, strokeWidth = 2.dp)
            else Text("Enter", color = Maroon, fontWeight = FontWeight.SemiBold) }
    }
}

// ---- shell + router -------------------------------------------------------
@Composable
fun StaffShell(me: JSONObject) {
    val chambers = me.optJSONArray("chambers")?.toStrList() ?: emptyList()
    val caps = me.optJSONArray("capabilities")?.toStrList() ?: emptyList()
    val demandOnly = caps.contains("sauda.demand") && !caps.contains("sauda.place") && !caps.contains("sauda.receive") && !caps.contains("sauda.raise")
    val nav = remember { mutableStateListOf<Screen>(Screen.Home) }
    val cur = nav.last()
    BackHandler(enabled = nav.size > 1) { nav.removeAt(nav.lastIndex) }
    when (cur) {
        is Screen.Home -> HomeScreen(me, chambers) { d ->
            val outlets = me.optJSONArray("outlets") ?: JSONArray()
            val outlet = if (outlets.length() > 0) outlets.getJSONObject(0).optString("outlet_id") else ""
            if (demandOnly && outlet.isNotEmpty()) nav.add(Screen.Place(outlet, d)) else nav.add(Screen.PurchaseDay(d))
        }
        is Screen.PurchaseDay -> PurchaseDayScreen(me, cur,
            back = { nav.removeAt(nav.lastIndex) },
            openCard = { id, outlet -> nav.add(Screen.Card(id, outlet, cur.date)) },
            openPlace = { outlet -> nav.add(Screen.Place(outlet, cur.date)) },
            openDirectory = { outlet -> nav.add(Screen.Directory(outlet, cur.date)) },
            setDate = { d -> nav[nav.lastIndex] = Screen.PurchaseDay(d) })
        is Screen.Day -> DayScreen(me, cur,
            back = { nav.removeAt(nav.lastIndex) },
            openCard = { id -> nav.add(Screen.Card(id, cur.outlet, cur.date)) },
            openPlace = { nav.add(Screen.Place(cur.outlet, cur.date)) },
            setOutletDate = { o, d -> nav[nav.lastIndex] = Screen.Day(o, d) })
        is Screen.Card -> CardScreen(me, cur) { nav.removeAt(nav.lastIndex) }
        is Screen.Place -> PlaceScreen(me, cur, back = { nav.removeAt(nav.lastIndex) }) { nav.removeAt(nav.lastIndex) }
        is Screen.Directory -> CatalogDirectoryScreen(me, cur,
            back = { nav.removeAt(nav.lastIndex) },
            openPlace = { nav.add(Screen.Place(cur.outlet, cur.date)) })
    }
}

// ---- Home: chamber tiles derived from role --------------------------------
@Composable
fun HomeScreen(me: JSONObject, chambers: List<String>, openSauda: (String) -> Unit) {
    val ctx = LocalContext.current
    var upd by remember { mutableStateOf<JSONObject?>(null) }
    var updating by remember { mutableStateOf(false) }
    var updErr by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { upd = Updater.check(ctx) }
    Scaffold(topBar = { HnBar("HN Hotels", subtitle = me.optString("name") + " · " + me.optString("role_label")) }) { p ->
        Column(Modifier.padding(p).padding(20.dp).fillMaxSize()) {
            val u = upd
            if (u != null) {
                Surface(color = Maroon, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Update available", color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text(u.optString("notes").ifEmpty { "A new version is ready" },
                                color = Color.White.copy(alpha = 0.8f), fontSize = 12.sp)
                        }
                        Button(onClick = {
                            if (updating) return@Button; updating = true; updErr = ""
                            scope.launch { val e = Updater.downloadAndInstall(ctx, u.optString("url")); updating = false; if (e != null) updErr = e }
                        }, colors = ButtonDefaults.buttonColors(containerColor = Color.White)) {
                            if (updating) CircularProgressIndicator(Modifier.size(20.dp), color = Maroon, strokeWidth = 2.dp)
                            else Text("Update", color = Maroon, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
                if (updErr.isNotEmpty()) Text("⚠ $updErr", color = WarnA, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
                Spacer(Modifier.height(16.dp))
            }
            Text("Your work", color = Muted, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(12.dp))
            if (chambers.contains("sauda"))
                ChamberTile("Sauda", "Purchase demand and proof", Icons.Filled.ShoppingCart, true) { openSauda(defaultPurchaseDateIst()) }
            if (chambers.contains("anbar")) { Spacer(Modifier.height(12.dp)); ChamberTile("Anbar", "Stock & inventory", Icons.Filled.Inventory2, false) {} }
            if (chambers.contains("takht")) { Spacer(Modifier.height(12.dp)); ChamberTile("Takht", "Settlement board", Icons.Filled.AccountBalanceWallet, false) {} }
            if (chambers.contains("admin")) { Spacer(Modifier.height(12.dp)); ChamberTile("Roles", "Assign staff roles", Icons.Filled.AdminPanelSettings, false) {} }
            if (chambers.isEmpty()) Text("No chambers enabled for your role.", color = Muted)
        }
    }
}

@Composable
fun ChamberTile(name: String, sub: String, icon: androidx.compose.ui.graphics.vector.ImageVector, enabled: Boolean, onClick: () -> Unit) {
    Surface(shape = RoundedCornerShape(12.dp), color = if (enabled) Sand else Sand.copy(alpha = 0.5f),
        modifier = Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick)) {
        Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = if (enabled) Maroon else Muted)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(name, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = if (enabled) Ink else Muted)
                Text(if (enabled) sub else "$sub · soon", fontSize = 13.sp, color = Muted)
            }
            if (enabled) Icon(Icons.Filled.ChevronRight, null, tint = Maroon)
        }
    }
}

// ---- Purchase day: owner Sauda map, scoped to staff role -------------------
@Composable
fun PurchaseDayScreen(me: JSONObject, s: Screen.PurchaseDay, back: () -> Unit,
                      openCard: (Int, String) -> Unit, openPlace: (String) -> Unit,
                      openDirectory: (String) -> Unit, setDate: (String) -> Unit) {
    var brand by remember { mutableStateOf("all") }
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    fun load() {
        data = null; error = ""
        scope.launch {
            val r = Api.get("action=purchase_day&date=${s.date}&brand=$brand")
            if (r.optBoolean("ok")) data = r else error = r.optString("error")
        }
    }
    LaunchedEffect(s.date, brand) { load() }
    val outlets = data?.optJSONArray("outlets")?.toObjList() ?: emptyList()
    val cards = data?.optJSONArray("cards")?.toObjList() ?: emptyList()
    val summary = data?.optJSONObject("summary")
    val caps = me.optJSONArray("capabilities")?.toStrList() ?: emptyList()
    val canPlace = caps.contains("sauda.place")
    val canDemand = caps.contains("sauda.demand")
    val placeOutlet = when (brand) {
        "HE" -> outlets.firstOrNull { it.optString("brand") == "HE" }?.optString("outlet_id")
        "NCH" -> outlets.firstOrNull { it.optString("brand") == "NCH" }?.optString("outlet_id")
        else -> outlets.firstOrNull()?.optString("outlet_id")
    } ?: ""
    Scaffold(
        topBar = { HnBar("Sauda", subtitle = "Purchase Day · HE + NCH", onBack = back) },
        floatingActionButton = { if ((canPlace || canDemand) && placeOutlet.isNotEmpty()) ExtendedFloatingActionButton(
            onClick = { openPlace(placeOutlet) }, containerColor = Maroon, contentColor = Color.White,
            icon = { Icon(Icons.Filled.Add, null) }, text = { Text(if (canDemand && !canPlace) "Create demand" else "Place order") }) }
    ) { p ->
        Column(Modifier.padding(p).fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                IconButton(onClick = { setDate(stepDate(s.date, -1)) }) { Icon(Icons.Filled.ChevronLeft, "prev", tint = Maroon) }
                Text(prettyDate(s.date), fontWeight = FontWeight.SemiBold, color = Ink, fontSize = 16.sp,
                    modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
                IconButton(onClick = { setDate(stepDate(s.date, 1)) }) { Icon(Icons.Filled.ChevronRight, "next", tint = Maroon) }
            }
            Row(Modifier.padding(horizontal = 16.dp, vertical = 2.dp).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                FilterChip(selected = brand == "all", onClick = { brand = "all" }, label = { Text("All HN") }, modifier = Modifier.padding(end = 8.dp))
                FilterChip(selected = brand == "HE", onClick = { brand = "HE" }, label = { Text("HE") }, modifier = Modifier.padding(end = 8.dp))
                FilterChip(selected = brand == "NCH", onClick = { brand = "NCH" }, label = { Text("NCH") })
                Spacer(Modifier.width(8.dp))
                if (placeOutlet.isNotEmpty()) {
                    OutlinedButton(onClick = { openDirectory(placeOutlet) }, shape = RoundedCornerShape(8.dp), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp), modifier = Modifier.padding(end = 8.dp)) {
                        Icon(Icons.Filled.Inventory2, null, tint = Maroon, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(5.dp))
                        Text("Items", color = Maroon, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                OutlinedButton(onClick = {
                    val u = "$BASE?action=purchase_day_pdf&date=${s.date}&brand=$brand&pin=$PIN"
                    ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u)))
                }, shape = RoundedCornerShape(8.dp), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)) {
                    Icon(Icons.Filled.PictureAsPdf, null, tint = Maroon, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(5.dp))
                    Text("A4", color = Maroon, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            HorizontalDivider(color = Sand, modifier = Modifier.padding(top = 6.dp))
            when {
                error.isNotEmpty() -> CenterMsg("⚠ $error") { load() }
                data == null -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = Maroon) }
                cards.isEmpty() -> CenterMsg("No purchase orders for ${prettyDate(s.date)}.\nUse Place order or move to the correct date.", null)
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 10.dp, 16.dp, 96.dp)) {
                    item {
                        PurchaseDaySummary(summary)
                        Spacer(Modifier.height(10.dp))
                    }
                    items(cards) { c ->
                        PurchaseDayCard(c) { openCard(c.optInt("id"), c.optString("outlet_id")) }
                        Spacer(Modifier.height(10.dp))
                    }
                }
            }
        }
    }
}

@Composable
fun PurchaseDaySummary(s: JSONObject?) {
    val vendors = s?.optInt("vendor_cards") ?: 0
    val lines = s?.optInt("order_lines") ?: 0
    val recv = s?.optInt("received_lines") ?: 0
    val amt = s?.optInt("expected_amount_paise") ?: 0
    Surface(shape = RoundedCornerShape(10.dp), color = Sand, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            SummaryBit(vendors.toString(), "vendors", Modifier.weight(1f))
            SummaryBit(lines.toString(), "items", Modifier.weight(1f))
            SummaryBit(recv.toString(), "received", Modifier.weight(1f))
            SummaryBit(rupee(amt), "bill basis", Modifier.weight(1.25f))
        }
    }
}

@Composable
fun SummaryBit(value: String, label: String, modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = Ink, fontWeight = FontWeight.Bold, fontSize = 15.sp, maxLines = 1)
        Text(label, color = Muted, fontSize = 10.sp, maxLines = 1)
    }
}

@Composable
fun PurchaseDayCard(c: JSONObject, onClick: () -> Unit) {
    val brand = c.optString("outlet_brand")
    Surface(shape = RoundedCornerShape(12.dp), color = Color.White, tonalElevation = 1.dp,
        border = androidx.compose.foundation.BorderStroke(1.dp, Sand),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    BrandPill(brand)
                    Spacer(Modifier.width(8.dp))
                    Text(c.optString("vendor_name"), fontWeight = FontWeight.SemiBold, fontSize = 16.sp,
                        color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.height(4.dp))
                val line = c.optInt("line_count"); val recv = c.optInt("recv_count")
                Text("$line items" + (if (recv > 0) " · $recv received" else "") +
                    " · " + vendorTerms(c), color = Muted, fontSize = 12.sp, maxLines = 2)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(rupee(c.optInt("expected_amount_paise")), fontWeight = FontWeight.Bold, color = Ink, fontSize = 15.sp)
                Spacer(Modifier.height(4.dp))
                StatusPill(c.optString("status"))
            }
        }
    }
}

@Composable
fun BrandPill(brand: String) {
    val bg = if (brand == "HE") Color(0xFFE9EEF8) else Color(0xFFF5EBDD)
    val fg = if (brand == "HE") Color(0xFF254F88) else Color(0xFF8A4B08)
    Surface(color = bg, shape = RoundedCornerShape(5.dp)) {
        Text(if (brand == "HE") "HE" else if (brand == "NCH") "NCH" else "HN",
            color = fg, fontSize = 10.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp))
    }
}

// ---- Catalog directory: item -> vendor -> price intelligence ---------------
@Composable
fun CatalogDirectoryScreen(me: JSONObject, s: Screen.Directory, back: () -> Unit, openPlace: () -> Unit) {
    var cat by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var selectedCat by remember { mutableStateOf("All") }
    val scope = rememberCoroutineScope()
    fun load() {
        cat = null; error = ""
        scope.launch {
            val r = Api.get("action=catalog&outlet=${s.outlet}")
            if (r.optBoolean("ok")) cat = r else error = r.optString("error")
        }
    }
    LaunchedEffect(s.outlet) { load() }
    val vendors = cat?.optJSONArray("vendors")?.toObjList() ?: emptyList()
    val vendorByKey = vendors.associateBy { it.optString("vendor_key") }
    val historyByItem = cat?.optJSONObject("history_by_item")
    val allItems = remember(cat) { cat?.optJSONObject("items_by_vendor").catalogItems().sortedBy { it.optString("label") } }
    val categories = remember(allItems) {
        listOf("All") + allItems.map { categoryShort(it.optString("category")) }.filter { it.isNotEmpty() }.distinct().take(10)
    }
    val q = query.trim()
    val displayItems = allItems.filter {
        (selectedCat == "All" || categoryShort(it.optString("category")) == selectedCat) && (q.isEmpty() || itemMatches(it, q))
    }
    Scaffold(
        topBar = { HnBar("Item directory", subtitle = "${cat?.optString("brand").orEmpty().ifEmpty { "HN" }} · vendor + rate map", onBack = back) },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = openPlace, containerColor = Maroon, contentColor = Color.White,
                icon = { Icon(Icons.Filled.Add, null) }, text = { Text("Place order") })
        }
    ) { p ->
        Column(Modifier.padding(p).fillMaxSize().padding(16.dp)) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                leadingIcon = { Icon(Icons.Filled.Search, null, tint = Maroon) },
                label = { Text("Search 175-item purchase directory") },
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                categories.forEach { c ->
                    FilterChip(selected = selectedCat == c, onClick = { selectedCat = c }, label = { Text(c, maxLines = 1) },
                        modifier = Modifier.padding(end = 8.dp))
                }
            }
            Spacer(Modifier.height(8.dp))
            when {
                error.isNotEmpty() -> CenterMsg("⚠ $error") { load() }
                cat == null -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = Maroon) }
                displayItems.isEmpty() -> CenterMsg("No matching purchase item.", null)
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 88.dp)) {
                    item {
                        Text("${displayItems.size} shown · ${cat?.optInt("item_count") ?: allItems.size} catalog items",
                            color = Muted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 6.dp))
                    }
                    items(displayItems) { item ->
                        CatalogItemRow(item, vendorByKey, historyByItem?.optJSONObject(item.optString("item_code")))
                        HorizontalDivider(color = Sand)
                    }
                }
            }
        }
    }
}

@Composable
fun CatalogItemRow(item: JSONObject, vendorByKey: Map<String, JSONObject>, history: JSONObject?) {
    val unit = item.optString("unit").ifEmpty { "unit" }
    val vendorKey = item.optString("default_vendor").ifEmpty { item.optString("_vendor_key") }
    val vendorName = vendorByKey[vendorKey]?.optString("name") ?: vendorKey.ifEmpty { "vendor not mapped" }
    val price = item.optInt("price_paise")
    val priceText = when {
        item.optString("price_mode") == "live" -> "live rate"
        price > 0 -> "expected ${rupee(price)}/$unit"
        else -> "rate at bill"
    }
    val hRate = history?.optInt("unit_cost_paise") ?: 0
    val hDate = history?.optString("last_date") ?: ""
    val hQty = history?.optDouble("last_qty", 0.0) ?: 0.0
    Row(Modifier.fillMaxWidth().padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(color = categoryColor(categoryShort(item.optString("category"))), shape = RoundedCornerShape(9.dp),
            modifier = Modifier.size(44.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Text(item.optString("label").take(1).uppercase(Locale.US), color = Ink, fontWeight = FontWeight.Bold)
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(item.optString("label"), color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(vendorName, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (hDate.isNotEmpty()) {
                Text("last ${numStr(hQty)} ${history?.optString("uom").orEmpty().ifEmpty { unit }}" +
                    (if (hRate > 0) " · ${rupee(hRate)}/$unit" else "") + " · $hDate",
                    color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(priceText, color = Ink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            Text(categoryShort(item.optString("category")), color = Muted, fontSize = 10.sp, maxLines = 1)
        }
    }
}

// ---- Day board: one vendor = one card -------------------------------------
@Composable
fun DayScreen(me: JSONObject, s: Screen.Day, back: () -> Unit, openCard: (Int) -> Unit,
              openPlace: () -> Unit, setOutletDate: (String, String) -> Unit) {
    val outlets = me.optJSONArray("outlets") ?: JSONArray()
    var cards by remember { mutableStateOf<List<JSONObject>?>(null) }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    fun load() {
        cards = null; error = ""
        scope.launch {
            val r = Api.get("action=day&outlet=${s.outlet}&date=${s.date}")
            if (r.optBoolean("ok")) cards = (r.optJSONArray("cards") ?: JSONArray()).toObjList() else error = r.optString("error")
        }
    }
    LaunchedEffect(s.outlet, s.date) { load() }
    val canPlace = (me.optJSONArray("capabilities")?.toStrList() ?: emptyList()).contains("sauda.place")
    Scaffold(
        topBar = { HnBar("Sauda", subtitle = "Vendor orders", onBack = back) },
        floatingActionButton = { if (canPlace) ExtendedFloatingActionButton(
            onClick = openPlace, containerColor = Maroon, contentColor = Color.White,
            icon = { Icon(Icons.Filled.Add, null) }, text = { Text("Place order") }) }
    ) { p ->
        Column(Modifier.padding(p).fillMaxSize()) {
            if (outlets.length() > 1) Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                for (i in 0 until outlets.length()) {
                    val o = outlets.getJSONObject(i); val id = o.optString("outlet_id")
                    FilterChip(selected = id == s.outlet, onClick = { setOutletDate(id, s.date) },
                        label = { Text(o.optString("brand")) }, modifier = Modifier.padding(end = 8.dp))
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                IconButton(onClick = { setOutletDate(s.outlet, stepDate(s.date, -1)) }) { Icon(Icons.Filled.ChevronLeft, "prev", tint = Maroon) }
                Text(prettyDate(s.date), fontWeight = FontWeight.SemiBold, color = Ink, fontSize = 16.sp,
                    modifier = Modifier.width(150.dp), textAlign = TextAlign.Center)
                IconButton(onClick = { setOutletDate(s.outlet, stepDate(s.date, 1)) }) { Icon(Icons.Filled.ChevronRight, "next", tint = Maroon) }
            }
            HorizontalDivider(color = Sand)
            val cs = cards
            when {
                error.isNotEmpty() -> CenterMsg("⚠ $error") { load() }
                cs == null -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = Maroon) }
                cs.isEmpty() -> CenterMsg("No orders for ${prettyDate(s.date)}.\nTap Place order to start.", null)
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp)) {
                    item {
                        val total = cs.sumOf { it.optInt("expected_amount_paise") }
                        Text("${cs.size} vendors · ${rupee(total)} expected", color = Muted, fontSize = 13.sp,
                            modifier = Modifier.padding(bottom = 8.dp))
                    }
                    items(cs) { c -> VendorCard(c) { openCard(c.optInt("id")) }; Spacer(Modifier.height(10.dp)) }
                }
            }
        }
    }
}

@Composable
fun VendorCard(c: JSONObject, onClick: () -> Unit) {
    val needsVendor = c.optString("vendor_key") == "_unrouted"
    Surface(shape = RoundedCornerShape(12.dp), color = Color.White, tonalElevation = 1.dp,
        border = androidx.compose.foundation.BorderStroke(1.dp, Sand),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(c.optString("vendor_name"), fontWeight = FontWeight.SemiBold, fontSize = 16.sp,
                    color = if (needsVendor) WarnA else Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(3.dp))
                val recv = c.optInt("recv_count"); val n = c.optInt("line_count")
                Text("$n items" + (if (recv > 0) " · $recv received" else "") +
                    (c.optString("fulfilment").takeIf { it.isNotEmpty() }?.let { " · $it" } ?: ""),
                    color = Muted, fontSize = 13.sp)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(rupee(c.optInt("expected_amount_paise")), fontWeight = FontWeight.Bold, color = Ink, fontSize = 16.sp)
                Spacer(Modifier.height(4.dp)); StatusPill(c.optString("status"))
            }
        }
    }
}

@Composable
fun StatusPill(status: String) {
    val pair = when (status) {
        "REQUESTED" -> Color(0xFFFFF4DB) to WarnA
        "RECEIVED" -> Color(0xFFE6F2E6) to GoodG
        "RAISED" -> Color(0xFFEAF1FF) to Color(0xFF2563EB)
        "PAID", "RECONCILED" -> Color(0xFFE9E3F5) to Color(0xFF5B3FA0)
        else -> Sand to Muted
    }
    Surface(color = pair.first, shape = RoundedCornerShape(6.dp)) {
        Text(status, color = pair.second, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
    }
}

// ---- Card detail + receive ------------------------------------------------
@Composable
fun CardScreen(me: JSONObject, s: Screen.Card, back: () -> Unit) {
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf("") }
    var actionError by remember { mutableStateOf("") }
    var receiving by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var goodsImage by remember { mutableStateOf("") }
    var billImage by remember { mutableStateOf("") }
    val recvQty = remember { mutableStateMapOf<Int, String>() }
    val recvRate = remember { mutableStateMapOf<Int, String>() }
    val scope = rememberCoroutineScope()
    fun load() {
        data = null
        error = ""
        actionError = ""
        scope.launch {
            val r = Api.get("action=card&id=${s.id}")
            if (r.optBoolean("ok")) data = r else error = r.optString("error")
        }
    }
    LaunchedEffect(s.id) { load() }
    val caps = me.optJSONArray("capabilities")?.toStrList() ?: emptyList()
    val card = data?.optJSONObject("card")
    val lines = data?.optJSONArray("lines")?.toObjList() ?: emptyList()
    val status = card?.optString("status") ?: ""
    Scaffold(topBar = { HnBar(card?.optString("vendor_name") ?: "Order",
        subtitle = card?.let { rupee(it.optInt("expected_amount_paise")) + " · " + status }, onBack = back) }) { p ->
        Column(Modifier.padding(p).fillMaxSize()) {
            when {
                error.isNotEmpty() -> CenterMsg("⚠ $error") { load() }
                data == null -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = Maroon) }
                else -> {
                    LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp)) {
                        items(lines) { l ->
                            val id = l.optInt("id")
                            LineRow(
                                l = l,
                                receiving = receiving,
                                recvVal = recvQty[id] ?: numStr(l.optDouble("qty_ordered", 0.0)),
                                rateVal = recvRate[id] ?: rupeeTextFromPaise(l.optInt("unit_cost_paise")),
                                onRecv = { recvQty[id] = it },
                                onRate = { recvRate[id] = it }
                            )
                            HorizontalDivider(color = Sand)
                        }
                        item { PaymentTrail(me, card, s.id) { load() } }
                    }
                    if (caps.contains("sauda.place") || caps.contains("sauda.receive")) Surface(shadowElevation = 8.dp, color = Color.White) {
                        Column(Modifier.padding(16.dp)) {
                            if (status == "REQUESTED" && caps.contains("sauda.place")) Button(
                                onClick = {
                                    if (busy) return@Button; busy = true; actionError = ""
                                    scope.launch {
                                        val r = Api.post("mark-ordered", JSONObject().put("order_id", s.id))
                                        busy = false
                                        if (r.optBoolean("ok")) load() else actionError = r.optString("error")
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Maroon),
                                modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(10.dp)
                            ) { Icon(Icons.Filled.Send, null); Spacer(Modifier.width(8.dp)); Text("Vendor order placed") }
                            else if (!receiving && status == "ORDERED" && caps.contains("sauda.receive")) Button(
                                onClick = {
                                    receiving = true
                                    actionError = ""
                                    goodsImage = ""; billImage = ""
                                    lines.forEach {
                                        recvQty[it.optInt("id")] = numStr(it.optDouble("qty_ordered", 0.0))
                                        recvRate[it.optInt("id")] = rupeeTextFromPaise(it.optInt("unit_cost_paise"))
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Maroon),
                                modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(10.dp)
                            ) { Icon(Icons.Filled.Inventory2, null); Spacer(Modifier.width(8.dp)); Text("Receive goods") }
                            else if (receiving) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    PhotoCaptureButton("Goods photo", goodsImage.isNotEmpty(), Modifier.weight(1f)) { goodsImage = it }
                                    PhotoCaptureButton("Bill photo", billImage.isNotEmpty(), Modifier.weight(1f)) { billImage = it }
                                }
                                Spacer(Modifier.height(10.dp))
                                if (actionError.isNotEmpty()) {
                                    Text("⚠ $actionError", color = WarnA, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp))
                                }
                                Row {
                                    OutlinedButton(onClick = { receiving = false }, modifier = Modifier.weight(1f).height(50.dp)) { Text("Cancel") }
                                    Spacer(Modifier.width(12.dp))
                                    Button(
                                    onClick = {
                                        if (busy) return@Button
                                        if (goodsImage.isEmpty() || billImage.isEmpty()) {
                                            actionError = "Upload goods photo and bill photo before saving proof."
                                            return@Button
                                        }
                                        val incomplete = lines.firstOrNull { l ->
                                            val id = l.optInt("id")
                                            (recvQty[id]?.toDoubleOrNull() ?: 0.0) <= 0.0 ||
                                                paiseFromRupeeText(recvRate[id] ?: "") <= 0
                                        }
                                        if (incomplete != null) {
                                            actionError = "Enter received quantity and bill rate for every item."
                                            return@Button
                                        }
                                        busy = true; actionError = ""
                                        scope.launch {
                                            val arr = JSONArray()
                                            lines.forEach { l -> val id = l.optInt("id")
                                                arr.put(JSONObject().put("line_id", id)
                                                    .put("qty_received", (recvQty[id] ?: "").ifEmpty { "0" })
                                                    .put("unit_cost_paise", paiseFromRupeeText(recvRate[id] ?: "0"))
                                                    .put("receive_state", "ok")) }
                                            val r = Api.post("receive", JSONObject()
                                                .put("order_id", s.id)
                                                .put("lines", arr)
                                                .put("goods_image", goodsImage)
                                                .put("bill_image", billImage))
                                            busy = false
                                            if (r.optBoolean("ok")) { receiving = false; load() } else actionError = r.optString("error")
                                        }
                                    },
                                    colors = ButtonDefaults.buttonColors(containerColor = GoodG),
                                    modifier = Modifier.weight(1.4f).height(50.dp), shape = RoundedCornerShape(10.dp)
                                    ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                                        else { Icon(Icons.Filled.Check, null); Spacer(Modifier.width(8.dp)); Text("Save proof") } }
                                }
                            }
                            else if (status == "RECEIVED") Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.CheckCircle, null, tint = GoodG)
                                Spacer(Modifier.width(8.dp))
                                Text("Received by ${card?.optString("received_by") ?: ""}", color = GoodG, fontWeight = FontWeight.Medium)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun LineRow(l: JSONObject, receiving: Boolean, recvVal: String, rateVal: String, onRecv: (String) -> Unit, onRate: (String) -> Unit) {
    val flag = l.optString("flag")
    Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(l.optString("item_label"), fontWeight = FontWeight.Medium, color = Ink, fontSize = 15.sp)
            val q = numStr(l.optDouble("qty_ordered", 0.0)); val uom = l.optString("uom")
            val cost = l.optInt("unit_cost_paise")
            Text("ordered $q $uom" + (if (cost > 0) " · ${rupee(cost)}/$uom" else ""), color = Muted, fontSize = 12.sp)
            if (flag.isNotEmpty()) Text("⚠ $flag", color = WarnA, fontSize = 11.sp)
        }
        if (receiving) Column(horizontalAlignment = Alignment.End) {
            OutlinedTextField(
                value = recvVal, onValueChange = { onRecv(it.replace(Regex("[^0-9.]"), "")) }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.width(92.dp), label = { Text("recv", fontSize = 10.sp) })
            Spacer(Modifier.height(4.dp))
            OutlinedTextField(
                value = rateVal, onValueChange = { onRate(it.replace(Regex("[^0-9.]"), "")) }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.width(92.dp), label = { Text("₹/${l.optString("uom").ifEmpty { "u" }}", fontSize = 10.sp) })
        }
        else {
            val qr = l.opt("qty_received")
            Column(horizontalAlignment = Alignment.End) {
                Text(rupee(l.optInt("line_amount_paise")), color = Ink, fontSize = 14.sp)
                if (qr != null && qr != JSONObject.NULL) Text("✓ ${numStr(l.optDouble("qty_received", 0.0))}", color = GoodG, fontSize = 12.sp)
            }
        }
    }
}

@Composable
fun PaymentTrail(me: JSONObject, card: JSONObject?, orderId: Int, onSaved: () -> Unit) {
    if (card == null) return
    val status = card.optString("status")
    if (status !in listOf("RECEIVED", "RAISED", "PAID", "RECONCILED")) return
    val caps = me.optJSONArray("capabilities")?.toStrList() ?: emptyList()
    val canSave = caps.contains("sauda.raise") || caps.contains("sauda.pay")
    val canPay = caps.contains("sauda.pay")
    val requestOnly = !canPay
    var amount by remember(orderId, card.optInt("pay_amount_paise"), card.optInt("expected_amount_paise")) {
        mutableStateOf(rupeeTextFromPaise(card.optInt("pay_amount_paise").takeIf { it > 0 } ?: card.optInt("expected_amount_paise")))
    }
    var method by remember(orderId, card.optString("pay_method")) { mutableStateOf(card.optString("pay_method").ifEmpty { "upi" }) }
    var ref by remember(orderId, card.optString("bank_ref")) { mutableStateOf(card.optString("bank_ref")) }
    var paid by remember(orderId, status) { mutableStateOf(status == "PAID" || status == "RECONCILED") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    Surface(shape = RoundedCornerShape(12.dp), color = Color.White, tonalElevation = 1.dp,
        border = androidx.compose.foundation.BorderStroke(1.dp, Sand),
        modifier = Modifier.fillMaxWidth().padding(top = 14.dp)) {
        Column(Modifier.padding(14.dp)) {
            Text(if (requestOnly) "Payment request" else "Payment trail", color = Ink, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text(if (requestOnly) "Request owner payment from this received bill. Nihaf Agent reads this as ready_to_pay."
                else "Save method, amount and proof reference. Cash-to-Tijori adjustment can consume this later.",
                color = Muted, fontSize = 11.sp)
            Spacer(Modifier.height(10.dp))
            Row(Modifier.horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                listOf("upi", "cash", "bank", "manual").forEach { m ->
                    FilterChip(selected = method == m, onClick = { method = m }, label = { Text(m.uppercase(Locale.US)) }, modifier = Modifier.padding(end = 8.dp))
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(value = amount, onValueChange = { amount = it.replace(Regex("[^0-9.]"), "") }, singleLine = true,
                    label = { Text("Amount") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                OutlinedTextField(value = ref, onValueChange = { ref = it }, singleLine = true,
                    label = { Text("Ref") }, modifier = Modifier.weight(1.1f))
            }
            if (canPay) {
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = paid, onCheckedChange = { paid = it })
                    Text("Mark paid by Nihaf / owner approval", color = Ink, fontSize = 12.sp)
                }
            }
            if (err.isNotEmpty()) Text("⚠ $err", color = WarnA, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
            if (canSave) {
                Spacer(Modifier.height(10.dp))
                Button(
                    onClick = {
                        if (busy) return@Button
                        val payPaise = paiseFromRupeeText(amount)
                        if (payPaise <= 0) {
                            err = "Enter payment amount."
                            return@Button
                        }
                        busy = true; err = ""
                        scope.launch {
                            val r = Api.post("payment", JSONObject()
                                .put("order_id", orderId)
                                .put("pay_method", method)
                                .put("pay_amount_paise", payPaise)
                                .put("bank_ref", ref)
                                .put("paid", paid))
                            busy = false
                            if (r.optBoolean("ok")) onSaved() else err = r.optString("error")
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Maroon),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth().height(46.dp)
                ) { if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp) else Text(if (requestOnly) "Request payment" else "Save payment trail") }
            }
        }
    }
}

// ---- Demand: outlet staff item-first order --------------------------------
@Composable
fun DemandScreen(me: JSONObject, s: Screen.Place, back: () -> Unit, placed: () -> Unit) {
    var cat by remember { mutableStateOf<JSONObject?>(null) }
    var itemQuery by remember { mutableStateOf("") }
    var selectedCat by remember { mutableStateOf("All") }
    val draft = remember { mutableStateListOf<JSONObject>() }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val speak = rememberItemSpeaker()
    LaunchedEffect(Unit) {
        val r = Api.get("action=catalog&outlet=${s.outlet}")
        if (r.optBoolean("ok")) cat = r else error = r.optString("error")
    }
    val allItems = remember(cat) { cat?.optJSONObject("items_by_vendor").catalogItems().sortedBy { it.optString("label") } }
    val categories = remember(allItems) {
        listOf("All") + allItems.map { categoryShort(it.optString("category")) }.filter { it.isNotEmpty() }.distinct().take(8)
    }
    val q = itemQuery.trim()
    val displayItems = allItems.filter {
        (selectedCat == "All" || categoryShort(it.optString("category")) == selectedCat) && (q.isEmpty() || itemMatches(it, q))
    }.take(80)
    fun addDemandItem(it2: JSONObject) {
        val code = it2.optString("item_code")
        val idx = draft.indexOfFirst { it.optString("item_code") == code }
        if (idx >= 0) {
            val old = draft[idx]
            draft[idx] = JSONObject(old.toString()).put("qty", numStr(old.optDouble("qty", 0.0) + 1.0))
            return
        }
        draft.add(JSONObject()
            .put("item_code", code)
            .put("item_label", it2.optString("label"))
            .put("hindi_label", it2.optString("hindi_label"))
            .put("qty", "1")
            .put("uom", it2.optString("unit")))
    }
    Scaffold(topBar = { HnBar("Create demand", subtitle = "${me.optString("name")} · ${prettyDate(s.date)}", onBack = back) }) { p ->
        Column(Modifier.padding(p).fillMaxSize().padding(16.dp)) {
            if (cat == null && error.isEmpty()) { Box(Modifier.fillMaxWidth().padding(40.dp), Alignment.Center) { CircularProgressIndicator(color = Maroon) }; return@Column }
            OutlinedTextField(
                value = itemQuery,
                onValueChange = { itemQuery = it; error = "" },
                singleLine = true,
                leadingIcon = { Icon(Icons.Filled.Search, null, tint = Maroon) },
                trailingIcon = { IconButton(onClick = { speak(q.ifEmpty { "Search item" }, "") }) { Icon(Icons.Filled.VolumeUp, null, tint = Maroon) } },
                label = { Text("Search item / Hindi name") },
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(10.dp))
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 12.dp)) {
                item {
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                        categories.forEach { c ->
                            FilterChip(selected = selectedCat == c, onClick = { selectedCat = c }, label = { Text(c, maxLines = 1) },
                                modifier = Modifier.padding(end = 8.dp))
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    if (draft.isNotEmpty()) {
                        Surface(shape = RoundedCornerShape(12.dp), color = Sand, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(12.dp)) {
                                Text("Demand basket · vendor hidden", color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                Text("System routes items to Zoya/Basheer by the item master.", color = Muted, fontSize = 11.sp)
                                Spacer(Modifier.height(8.dp))
                                draft.forEachIndexed { idx, d ->
                                    DemandDraftLine(d,
                                        onQty = { qv -> draft[idx] = JSONObject(d.toString()).put("qty", qv.ifEmpty { "0" }) },
                                        onRemove = { draft.removeAt(idx) })
                                }
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                    }
                }
                items(displayItems) { it2 ->
                    DemandItemRow(it2, inDraft = draft.any { d -> d.optString("item_code") == it2.optString("item_code") },
                        onSpeak = { speak(it2.optString("label"), it2.optString("hindi_label")) },
                        onAdd = { addDemandItem(it2) })
                    HorizontalDivider(color = Sand)
                }
                if (displayItems.isEmpty()) item {
                    Box(Modifier.fillMaxWidth().padding(28.dp), Alignment.Center) {
                        Text("No matching item. Zoya/Basheer can add missing master items from the purchase bucket.", color = Muted, textAlign = TextAlign.Center)
                    }
                }
            }
            if (error.isNotEmpty()) Text("⚠ $error", color = WarnA, fontSize = 13.sp, modifier = Modifier.padding(vertical = 6.dp))
            Button(
                onClick = {
                    if (busy || draft.isEmpty()) return@Button
                    busy = true; error = ""
                    scope.launch {
                        val r = Api.post("demand", JSONObject()
                            .put("outlet", s.outlet).put("for_date", s.date)
                            .put("lines", JSONArray(draft.toList())))
                        busy = false
                        if (r.optBoolean("ok")) placed() else error = r.optString("error")
                    }
                },
                enabled = draft.isNotEmpty(),
                colors = ButtonDefaults.buttonColors(containerColor = Maroon),
                modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(10.dp)
            ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                else Text("Send to purchase bucket · ${draft.size} items", fontWeight = FontWeight.SemiBold) }
        }
    }
}

@Composable
fun DemandItemRow(it2: JSONObject, inDraft: Boolean, onSpeak: () -> Unit, onAdd: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(color = categoryColor(categoryShort(it2.optString("category"))), shape = RoundedCornerShape(12.dp),
            modifier = Modifier.size(54.dp)) { Box(contentAlignment = Alignment.Center) {
                Text(it2.optString("label").take(1).uppercase(Locale.US), color = Ink, fontWeight = FontWeight.Bold)
            } }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(it2.optString("label"), fontWeight = FontWeight.SemiBold, color = Ink, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val hi = it2.optString("hindi_label")
            Text(listOf(hi.ifEmpty { "Hindi pending" }, it2.optString("unit"), categoryShort(it2.optString("category"))).filter { it.isNotEmpty() }.joinToString(" · "),
                color = Muted, fontSize = 12.sp, maxLines = 1)
        }
        IconButton(onClick = onSpeak) { Icon(Icons.Filled.VolumeUp, "speak", tint = Maroon) }
        IconButton(onClick = onAdd) { Icon(if (inDraft) Icons.Filled.CheckCircle else Icons.Filled.AddCircleOutline, "add", tint = if (inDraft) GoodG else Maroon) }
    }
}

@Composable
fun DemandDraftLine(line: JSONObject, onQty: (String) -> Unit, onRemove: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(line.optString("item_label"), color = Ink, fontWeight = FontWeight.Medium, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(line.optString("hindi_label").ifEmpty { "Hindi pending" }, color = Muted, fontSize = 11.sp)
        }
        OutlinedTextField(
            value = line.optString("qty").ifEmpty { "1" },
            onValueChange = { v -> onQty(v.replace(Regex("[^0-9.]"), "")) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.width(78.dp),
            textStyle = androidx.compose.ui.text.TextStyle(textAlign = TextAlign.Center)
        )
        Text(line.optString("uom"), color = Muted, fontSize = 11.sp, modifier = Modifier.width(42.dp).padding(start = 4.dp))
        IconButton(onClick = onRemove) { Icon(Icons.Filled.Close, "remove", tint = WarnA) }
    }
}

// ---- Place: vendor-first --------------------------------------------------
@Composable
fun PlaceScreen(me: JSONObject, s: Screen.Place, back: () -> Unit, placed: () -> Unit) {
    val caps = me.optJSONArray("capabilities")?.toStrList() ?: emptyList()
    if (caps.contains("sauda.demand") && !caps.contains("sauda.place")) {
        DemandScreen(me, s, back, placed)
        return
    }
    var cat by remember { mutableStateOf<JSONObject?>(null) }
    var vendorKey by remember { mutableStateOf("") }
    var vendorMenu by remember { mutableStateOf(false) }
    var itemQuery by remember { mutableStateOf("") }
    val draft = remember { mutableStateListOf<JSONObject>() }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        val r = Api.get("action=catalog&outlet=${s.outlet}")
        if (r.optBoolean("ok")) cat = r else error = r.optString("error")
    }
    val vendors = cat?.optJSONArray("vendors")?.toObjList() ?: emptyList()
    val vendorByKey = vendors.associateBy { it.optString("vendor_key") }
    val vendorName = vendors.firstOrNull { it.optString("vendor_key") == vendorKey }?.optString("name") ?: "Pick vendor"
    val itemsByVendor = cat?.optJSONObject("items_by_vendor")
    val allItems = remember(cat) { itemsByVendor.catalogItems() }
    val vendorItems = if (vendorKey.isNotEmpty()) itemsByVendor?.optJSONArray(vendorKey)?.toObjList() ?: emptyList() else emptyList()
    val historyByItem = cat?.optJSONObject("history_by_item")
    val searchText = itemQuery.trim()
    val displayItems = when {
        searchText.isNotEmpty() -> (if (vendorKey.isNotEmpty()) vendorItems else allItems)
            .filter { itemMatches(it, searchText) }
            .take(60)
        vendorKey.isNotEmpty() -> vendorItems
        else -> emptyList()
    }
    fun addItem(it2: JSONObject) {
        val code = it2.optString("item_code")
        val itemVendor = it2.optString("default_vendor").ifEmpty { it2.optString("_vendor_key") }.ifEmpty { "_unrouted" }
        if (vendorKey.isNotEmpty() && itemVendor != vendorKey && draft.isNotEmpty()) {
            val active = vendorByKey[vendorKey]?.optString("name") ?: vendorKey
            val other = vendorByKey[itemVendor]?.optString("name") ?: itemVendor
            error = "Finish $active first. ${it2.optString("label")} belongs to $other."
            return
        }
        if (vendorKey != itemVendor) {
            vendorKey = itemVendor
            if (draft.isEmpty()) error = ""
        }
        if (draft.none { d -> d.optString("item_code") == code }) {
            val unit = it2.optString("unit")
            val pr = it2.optInt("price_paise")
            draft.add(JSONObject().put("item_code", code).put("item_label", it2.optString("label"))
                .put("qty", 1).put("uom", unit)
                .put("unit_cost_paise", if (it2.optString("price_mode") != "live") pr else 0))
        }
    }
    fun addManualItem() {
        val label = searchText.ifEmpty { "New item" }
        if (vendorKey.isEmpty()) {
            error = "Pick a vendor first, then add the missing item."
            return
        }
        draft.add(JSONObject().put("item_code", "").put("item_label", label)
            .put("qty", 1).put("uom", "unit").put("unit_cost_paise", 0)
            .put("flag", "new item - confirm master").put("raw", label))
        itemQuery = ""
        error = "Added as a flagged item. Master data can be cleaned later."
    }
    Scaffold(topBar = { HnBar("Place order", subtitle = prettyDate(s.date), onBack = back) }) { p ->
        Column(Modifier.padding(p).fillMaxSize().padding(16.dp)) {
            if (cat == null && error.isEmpty()) { Box(Modifier.fillMaxWidth().padding(40.dp), Alignment.Center) { CircularProgressIndicator(color = Maroon) }; return@Column }
            Box {
                OutlinedButton(onClick = { vendorMenu = true }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(10.dp)) {
                    Icon(Icons.Filled.Store, null, tint = Maroon); Spacer(Modifier.width(8.dp))
                    Text(vendorName, color = Ink, modifier = Modifier.weight(1f)); Icon(Icons.Filled.ArrowDropDown, null)
                }
                DropdownMenu(expanded = vendorMenu, onDismissRequest = { vendorMenu = false }) {
                    vendors.forEach { v ->
                        DropdownMenuItem(text = { Text(v.optString("name")) }, onClick = {
                            vendorKey = v.optString("vendor_key"); vendorMenu = false; draft.clear(); error = "" })
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            vendorByKey[vendorKey]?.let { v ->
                Text(vendorTerms(v), color = Muted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp))
            }
            OutlinedTextField(
                value = itemQuery,
                onValueChange = { itemQuery = it; error = "" },
                singleLine = true,
                leadingIcon = { Icon(Icons.Filled.Search, null, tint = Maroon) },
                label = { Text(if (vendorKey.isNotEmpty()) "Search ${vendorName}" else "Search all items") },
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(10.dp))
            if (draft.isNotEmpty()) {
                Surface(shape = RoundedCornerShape(10.dp), color = Sand, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text("Order card · $vendorName", color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                        Spacer(Modifier.height(6.dp))
                        draft.forEachIndexed { idx, d ->
                            DraftLineEditor(
                                line = d,
                                onQty = { q -> draft[idx] = JSONObject(d.toString()).put("qty", q.ifEmpty { "0" }) },
                                onRemove = { draft.removeAt(idx) }
                            )
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
            }
            if (displayItems.isNotEmpty()) {
                if (vendorKey.isNotEmpty()) Text("Tap +, then set the quantity", color = Muted, fontSize = 12.sp)
                LazyColumn(Modifier.weight(1f)) {
                    items(displayItems) { it2 ->
                        val code = it2.optString("item_code")
                        val idx = draft.indexOfFirst { d -> d.optString("item_code") == code }
                        val inDraft = if (idx >= 0) draft[idx] else null
                        val unit = it2.optString("unit")
                        val pr = it2.optInt("price_paise")
                        val itemVendor = it2.optString("default_vendor").ifEmpty { it2.optString("_vendor_key") }
                        val itemVendorName = vendorByKey[itemVendor]?.optString("name") ?: itemVendor
                        val h = historyByItem?.optJSONObject(code)
                        Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(it2.optString("label"), fontWeight = FontWeight.Medium, color = Ink, fontSize = 15.sp)
                                    Text(
                                        listOfNotNull(
                                            when {
                                                it2.optString("price_mode") == "live" -> "live rate"
                                                pr > 0 -> "expected ${rupee(pr)}/$unit"
                                                else -> "rate at bill"
                                            },
                                            if (vendorKey.isEmpty() && itemVendorName.isNotEmpty()) itemVendorName else null
                                        ).joinToString(" · "),
                                        color = Muted, fontSize = 12.sp
                                    )
                                    if (h != null) {
                                        val hQty = numStr(h.optDouble("last_qty", 0.0))
                                        val hUom = h.optString("uom").ifEmpty { unit }
                                        val hRate = h.optInt("unit_cost_paise")
                                        Text("last $hQty $hUom" + (if (hRate > 0) " · ${rupee(hRate)}/$hUom" else "") +
                                            (h.optString("last_date").takeIf { it.isNotEmpty() }?.let { " · $it" } ?: ""),
                                            color = Muted, fontSize = 11.sp)
                                    }
                                }
                                if (inDraft == null) IconButton(onClick = { addItem(it2) }) { Icon(Icons.Filled.AddCircleOutline, "add", tint = Maroon) }
                                else Row(verticalAlignment = Alignment.CenterVertically) {
                                    OutlinedTextField(
                                        value = numStr(inDraft.optDouble("qty", 1.0)),
                                        onValueChange = { v ->
                                            val q = v.replace(Regex("[^0-9.]"), "")
                                            draft[idx] = JSONObject(inDraft.toString()).put("qty", q.ifEmpty { "0" }) },
                                        singleLine = true,
                                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                        modifier = Modifier.width(88.dp),
                                        textStyle = androidx.compose.ui.text.TextStyle(textAlign = TextAlign.Center))
                                    Spacer(Modifier.width(4.dp))
                                    Text(unit, color = Muted, fontSize = 12.sp, modifier = Modifier.width(46.dp))
                                    IconButton(onClick = { draft.removeAt(idx) }) { Icon(Icons.Filled.Close, "remove", tint = WarnA) }
                                }
                            }
                        }
                        HorizontalDivider(color = Sand)
                    }
                }
            } else if (searchText.isNotEmpty()) {
                Box(Modifier.weight(1f), Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
                        Text("No matching items.", color = Muted, fontSize = 15.sp, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(12.dp))
                        OutlinedButton(onClick = { addManualItem() }, shape = RoundedCornerShape(10.dp)) {
                            Icon(Icons.Filled.AddCircleOutline, null, tint = Maroon)
                            Spacer(Modifier.width(8.dp))
                            Text("Add as flagged item", color = Maroon)
                        }
                    }
                }
            } else {
                Box(Modifier.weight(1f)) { CenterMsg("Search an item or pick a vendor.\nOne vendor = one order card.", null) }
            }
            if (draft.isNotEmpty()) {
                val tot = draft.sumOf { d -> ((d.optDouble("qty", 0.0)) * d.optInt("unit_cost_paise")).toInt() }
                Text("${draft.size} items" + (if (tot > 0) " · ${rupee(tot)} expected" else ""),
                    color = Ink, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 6.dp))
            }
            if (error.isNotEmpty()) Text("⚠ $error", color = WarnA, fontSize = 13.sp, modifier = Modifier.padding(vertical = 6.dp))
            Button(
                onClick = {
                    if (busy || draft.isEmpty()) return@Button; busy = true; error = ""
                    scope.launch {
                        val r = Api.post("place", JSONObject()
                            .put("outlet", s.outlet).put("vendor_key", vendorKey).put("for_date", s.date)
                            .put("lines", JSONArray(draft.toList())))
                        busy = false
                        if (r.optBoolean("ok")) placed() else error = r.optString("error")
                    }
                },
                enabled = draft.isNotEmpty(),
                colors = ButtonDefaults.buttonColors(containerColor = Maroon),
                modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(10.dp)
            ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                else Text("Place order · ${draft.size} items", fontWeight = FontWeight.SemiBold) }
        }
    }
}

// ---- shared bits ----------------------------------------------------------
@Composable
fun DraftLineEditor(line: JSONObject, onQty: (String) -> Unit, onRemove: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(line.optString("item_label"), color = Ink, fontWeight = FontWeight.Medium, fontSize = 13.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (line.optString("flag").isNotEmpty()) Text(line.optString("flag"), color = WarnA, fontSize = 10.sp)
        }
        OutlinedTextField(
            value = numStr(line.optDouble("qty", 1.0)),
            onValueChange = { v -> onQty(v.replace(Regex("[^0-9.]"), "")) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.width(82.dp),
            textStyle = androidx.compose.ui.text.TextStyle(textAlign = TextAlign.Center)
        )
        Text(line.optString("uom"), color = Muted, fontSize = 11.sp, modifier = Modifier.width(42.dp).padding(start = 4.dp))
        IconButton(onClick = onRemove) { Icon(Icons.Filled.Close, "remove", tint = WarnA) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HnBar(title: String, subtitle: String? = null, onBack: (() -> Unit)? = null) {
    TopAppBar(
        title = { Column { Text(title, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            if (subtitle != null) Text(subtitle, fontSize = 12.sp, color = Color.White.copy(alpha = 0.8f)) } },
        navigationIcon = { if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, "back", tint = Color.White) } },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Maroon, titleContentColor = Color.White)
    )
}

@Composable
fun CenterMsg(msg: String, onRetry: (() -> Unit)?) {
    Box(Modifier.fillMaxSize().padding(32.dp), Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(msg, color = Muted, fontSize = 15.sp, textAlign = TextAlign.Center)
            if (onRetry != null) { Spacer(Modifier.height(12.dp)); OutlinedButton(onClick = onRetry) { Text("Retry") } }
        }
    }
}

fun numStr(d: Double): String = if (d == d.toLong().toDouble()) d.toLong().toString() else d.toString()
fun JSONArray.toStrList(): List<String> = (0 until length()).map { optString(it) }
fun JSONArray.toObjList(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
fun JSONObject?.catalogItems(): List<JSONObject> {
    if (this == null) return emptyList()
    val out = mutableListOf<JSONObject>()
    val ks = keys()
    while (ks.hasNext()) {
        val vendorKey = ks.next()
        val arr = optJSONArray(vendorKey) ?: continue
        for (i in 0 until arr.length()) {
            val item = JSONObject(arr.getJSONObject(i).toString())
            if (item.optString("_vendor_key").isEmpty()) item.put("_vendor_key", vendorKey)
            out.add(item)
        }
    }
    return out
}
fun softNorm(s: String): String = s.lowercase(Locale.US).replace(Regex("[^a-z0-9]+"), " ").trim().replace(Regex("\\s+"), " ")
fun compactNorm(s: String): String = softNorm(s).replace(" ", "")
fun itemMatches(item: JSONObject, query: String): Boolean {
    val q = softNorm(query)
    if (q.isEmpty()) return true
    val hay = softNorm(listOf(
        item.optString("label"),
        item.optString("item_code"),
        item.optString("category"),
        item.optString("unit"),
        item.optString("search_text")
    ).joinToString(" "))
    val termsOk = q.split(" ").filter { it.isNotEmpty() }.all { hay.contains(it) }
    return termsOk || compactNorm(hay).contains(compactNorm(query))
}
fun vendorTerms(v: JSONObject): String {
    val fulfilment = when (v.optString("fulfilment")) {
        "deliver" -> "delivery"
        "collect" -> "collect from shop"
        "standing" -> "standing supply"
        "porter" -> "porter pickup"
        "bus" -> "bus/transport"
        else -> v.optString("fulfilment").ifEmpty { "fulfilment not set" }
    }
    val pay = when (v.optString("pay_behaviour")) {
        "per" -> "pay per bill"
        "khata_roll" -> "running khata"
        "khata_periodic" -> "periodic khata"
        else -> v.optString("pay_behaviour").ifEmpty { "payment rule not set" }
    }
    return "$fulfilment · $pay"
}

@Composable
fun rememberItemSpeaker(): (String, String) -> Unit {
    val ctx = LocalContext.current
    val ttsState = remember { mutableStateOf<TextToSpeech?>(null) }
    DisposableEffect(Unit) {
        val tts = TextToSpeech(ctx) { status ->
            if (status == TextToSpeech.SUCCESS) {
                ttsState.value?.language = Locale("en", "IN")
            }
        }
        ttsState.value = tts
        onDispose { tts.stop(); tts.shutdown() }
    }
    return speak@ { english: String, hindi: String ->
        val tts = ttsState.value ?: return@speak
        val en = english.trim()
        val hi = hindi.trim()
        if (en.isNotEmpty()) {
            tts.language = Locale("en", "IN")
            tts.speak(en, TextToSpeech.QUEUE_FLUSH, null, "en-${System.currentTimeMillis()}")
        }
        if (hi.isNotEmpty()) {
            tts.language = Locale("hi", "IN")
            tts.speak(hi, TextToSpeech.QUEUE_ADD, null, "hi-${System.currentTimeMillis()}")
        }
    }
}

fun categoryShort(cat: String): String {
    val c = cat.lowercase(Locale.US)
    return when {
        c.contains("dairy") -> "Dairy"
        c.contains("fresh") || c.contains("vegetable") || c.contains("veg") -> "Fresh"
        c.contains("meat") || c.contains("chicken") -> "Meat"
        c.contains("pack") || c.contains("paper") -> "Packaging"
        c.contains("water") || c.contains("beverage") -> "Water"
        c.contains("pantry") || c.contains("dry") || c.contains("spice") -> "Pantry"
        cat.isNotBlank() -> cat.take(12)
        else -> "Other"
    }
}
fun categoryColor(cat: String): Color = when (cat) {
    "Fresh" -> Color(0xFFEAF5EA)
    "Meat" -> Color(0xFFFDECEC)
    "Dairy" -> Color(0xFFEAF1FF)
    "Packaging" -> Color(0xFFFFF4DB)
    "Water" -> Color(0xFFE6F4F1)
    "Pantry" -> Color(0xFFF5F0EF)
    else -> Sand
}
fun paiseFromRupeeText(v: String): Int = Math.max(0, Math.round(((v.replace(Regex("[^0-9.]"), "").toDoubleOrNull() ?: 0.0) * 100)).toInt())
fun rupeeTextFromPaise(paise: Int): String = if (paise <= 0) "" else (paise / 100.0).let { if (it == it.toLong().toDouble()) it.toLong().toString() else String.format(Locale.US, "%.2f", it) }

fun newImageUri(ctx: Context, prefix: String): Uri {
    val file = File(ctx.externalCacheDir, "${prefix}-${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", file)
}
fun uriToDataUrl(ctx: Context, uri: Uri): String {
    val raw = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: ByteArray(0)
    val bmp = BitmapFactory.decodeByteArray(raw, 0, raw.size)
    var bytes = raw
    if (bmp != null) {
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 70, out)
        bytes = out.toByteArray()
        if (bytes.size > 2_700_000) {
            out.reset()
            bmp.compress(Bitmap.CompressFormat.JPEG, 45, out)
            bytes = out.toByteArray()
        }
    }
    return "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
}

@Composable
fun PhotoCaptureButton(label: String, captured: Boolean, modifier: Modifier = Modifier, onCaptured: (String) -> Unit) {
    val ctx = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) onCaptured(uriToDataUrl(ctx, uri))
    }
    OutlinedButton(
        onClick = { launcher.launch("image/*") },
        shape = RoundedCornerShape(10.dp),
        modifier = modifier.height(46.dp)
    ) {
        Icon(if (captured) Icons.Filled.CheckCircle else Icons.Filled.AttachFile, null, tint = if (captured) GoodG else Maroon)
        Spacer(Modifier.width(6.dp))
        Text(if (captured) "$label uploaded" else "Upload $label", color = if (captured) GoodG else Maroon, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}
