package com.hnhotels.hnstaff

import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.util.Base64
import android.widget.Toast
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
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
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
private const val CHICKEN_BASE = "https://hnhotels.in/api/chicken-ops"
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

object ChickenApi {
    private fun conn(u: String): HttpURLConnection {
        val c = URL(u).openConnection() as HttpURLConnection
        c.connectTimeout = 12000; c.readTimeout = 18000
        c.setRequestProperty("User-Agent", "HNStaff-Android")
        return c
    }
    suspend fun get(qs: String): JSONObject = withContext(Dispatchers.IO) {
        val c = conn("$CHICKEN_BASE?$qs")
        try { JSONObject(readAll(c)) } catch (e: Exception) { JSONObject().put("success", false).put("error", e.message ?: "network error") } finally { c.disconnect() }
    }
    suspend fun post(action: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val c = conn("$CHICKEN_BASE?action=$action&pin=$PIN")
        c.requestMethod = "POST"; c.doOutput = true; c.setRequestProperty("content-type", "application/json")
        try { c.outputStream.use { it.write(body.toString().toByteArray()) }; JSONObject(readAll(c)) }
        catch (e: Exception) { JSONObject().put("success", false).put("error", e.message ?: "network error") } finally { c.disconnect() }
    }
    private fun readAll(c: HttpURLConnection): String {
        val code = c.responseCode
        return (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: "{}"
    }
}

// ---- self-update (sideload-friendly): check version.json, download + install ----
private const val VERSION_URL = "https://hn-ops-api.pages.dev/version.json"
object Updater {
    fun installedCode(ctx: Context): Long = try {
        val p = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) p.longVersionCode else @Suppress("DEPRECATION") p.versionCode.toLong()
    } catch (e: Exception) { 0L }

    suspend fun latest(): JSONObject? = withContext(Dispatchers.IO) {
        try {
            val c = URL(VERSION_URL).openConnection() as HttpURLConnection
            c.connectTimeout = 8000; c.readTimeout = 8000
            c.setRequestProperty("Cache-Control", "no-cache")
            c.setRequestProperty("Pragma", "no-cache")
            val txt = c.inputStream.bufferedReader().readText(); c.disconnect()
            JSONObject(txt)
        } catch (e: Exception) { null }
    }

    // returns the update JSON {versionCode,url,versionName,notes} if a newer one exists, else null
    suspend fun check(ctx: Context): JSONObject? {
        val j = latest() ?: return null
        return if (j.optLong("versionCode") > installedCode(ctx)) j else null
    }

    // download the apk to cache and launch the system installer; returns error string or null
    suspend fun downloadAndInstall(ctx: Context, url: String): String? = withContext(Dispatchers.IO) {
        try {
            val out = File(ctx.externalCacheDir, "HN-Ops-update.apk")
            val sep = if (url.contains("?")) "&" else "?"
            val c = URL("$url${sep}install_ts=${System.currentTimeMillis()}").openConnection() as HttpURLConnection
            c.connectTimeout = 12000; c.readTimeout = 30000
            c.setRequestProperty("Cache-Control", "no-cache")
            c.setRequestProperty("Pragma", "no-cache")
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
    data class Place(val outlet: String, val date: String, val vendorKey: String = "") : Screen()
    data class Directory(val outlet: String, val date: String) : Screen()
    data class VendorDiary(val date: String) : Screen()
    data class Chicken(val date: String) : Screen()
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
    val ctx = LocalContext.current
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var updateMsg by remember { mutableStateOf("") }
    var updateBusy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(
        Modifier.fillMaxSize().background(Maroon).padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center
    ) {
        HnOpsLogo()
        Spacer(Modifier.height(18.dp))
        Text("HN Hotels", color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Text("Ops Console", color = Color.White.copy(alpha = 0.7f), fontSize = 15.sp)
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
        Spacer(Modifier.height(14.dp))
        OutlinedButton(
            onClick = {
                if (updateBusy) return@OutlinedButton
                updateBusy = true; updateMsg = ""
                scope.launch {
                    val latest = Updater.latest()
                    if (latest == null) {
                        updateMsg = "Cannot check update. Try network again."
                    } else if (latest.optLong("versionCode") <= Updater.installedCode(ctx)) {
                        updateMsg = "Already on latest version ${latest.optString("versionName")}."
                    } else {
                        val e = Updater.downloadAndInstall(ctx, latest.optString("url"))
                        updateMsg = e ?: "Installer opened for version ${latest.optString("versionName")}."
                    }
                    updateBusy = false
                }
            },
            shape = RoundedCornerShape(8.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
            modifier = Modifier.width(190.dp).height(46.dp)
        ) {
            if (updateBusy) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
            else { Icon(Icons.Filled.SystemUpdateAlt, null, tint = Color.White); Spacer(Modifier.width(8.dp)); Text("Update app", color = Color.White, fontWeight = FontWeight.SemiBold) }
        }
        if (updateMsg.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text(updateMsg, color = Color.White.copy(alpha = 0.78f), fontSize = 12.sp, textAlign = TextAlign.Center)
        }
    }
}

@Composable
fun HnOpsLogo() {
    Surface(
        color = Color.White,
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier.size(76.dp)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("H", color = Maroon, fontSize = 31.sp, fontWeight = FontWeight.ExtraBold)
                Text("N", color = Color(0xFFD7B46A), fontSize = 31.sp, fontWeight = FontWeight.ExtraBold)
            }
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 13.dp)
                    .width(34.dp)
                    .height(3.dp)
                    .background(Maroon.copy(alpha = 0.88f), RoundedCornerShape(2.dp))
            )
        }
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
            openVendorDiary = { nav.add(Screen.VendorDiary(cur.date)) },
            openChicken = { nav.add(Screen.Chicken(cur.date)) },
            setDate = { d -> nav[nav.lastIndex] = Screen.PurchaseDay(d) })
        is Screen.Day -> DayScreen(me, cur,
            back = { nav.removeAt(nav.lastIndex) },
            openCard = { id -> nav.add(Screen.Card(id, cur.outlet, cur.date)) },
            openPlace = { nav.add(Screen.Place(cur.outlet, cur.date)) },
            setOutletDate = { o, d -> nav[nav.lastIndex] = Screen.Day(o, d) })
        is Screen.Card -> CardScreen(me, cur,
            back = { nav.removeAt(nav.lastIndex) },
            deleted = {
                nav.removeAt(nav.lastIndex)
                val i = nav.lastIndex
                when (val prev = nav[i]) {
                    is Screen.PurchaseDay -> nav[i] = Screen.PurchaseDay(prev.date)
                    is Screen.Day -> nav[i] = Screen.Day(prev.outlet, prev.date)
                    else -> {}
                }
            })
        is Screen.Place -> PlaceScreen(me, cur, back = { nav.removeAt(nav.lastIndex) }) { nav.removeAt(nav.lastIndex) }
        is Screen.Directory -> CatalogDirectoryScreen(me, cur,
            back = { nav.removeAt(nav.lastIndex) },
            openPlace = { nav.add(Screen.Place(cur.outlet, cur.date)) })
        is Screen.VendorDiary -> VendorDiaryScreen(me, cur,
            back = { nav.removeAt(nav.lastIndex) },
            openCard = { id, outlet -> nav.add(Screen.Card(id, outlet, cur.date)) },
            openPlace = { outlet, vendorKey -> nav.add(Screen.Place(outlet, cur.date, vendorKey)) },
            setDate = { d -> nav[nav.lastIndex] = Screen.VendorDiary(d) })
        is Screen.Chicken -> ChickenScreen(cur, back = { nav.removeAt(nav.lastIndex) },
            setDate = { d -> nav[nav.lastIndex] = Screen.Chicken(d) })
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
                      openDirectory: (String) -> Unit, openVendorDiary: () -> Unit,
                      openChicken: () -> Unit, setDate: (String) -> Unit) {
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
                OutlinedButton(onClick = openVendorDiary, shape = RoundedCornerShape(8.dp), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp), modifier = Modifier.padding(end = 8.dp)) {
                    Icon(Icons.Filled.MenuBook, null, tint = Maroon, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(5.dp))
                    Text("Diary", color = Maroon, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
                if (canPlace || caps.contains("sauda.receive")) {
                    OutlinedButton(onClick = openChicken, shape = RoundedCornerShape(8.dp), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp), modifier = Modifier.padding(end = 8.dp)) {
                        Icon(Icons.Filled.SetMeal, null, tint = Maroon, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(5.dp))
                        Text("MN", color = Maroon, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
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

// ---- Vendor diary: local vendors, requests, paid trail ---------------------
@Composable
fun VendorDiaryScreen(me: JSONObject, s: Screen.VendorDiary, back: () -> Unit,
                      openCard: (Int, String) -> Unit, openPlace: (String, String) -> Unit,
                      setDate: (String) -> Unit) {
    var brand by remember { mutableStateOf("all") }
    var tab by remember { mutableStateOf(0) }
    var diary by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    fun load() {
        diary = null; error = ""
        scope.launch {
            val r = Api.get("action=vendor_diary&date=${s.date}&brand=$brand&days=45")
            if (r.optBoolean("ok")) diary = r else error = r.optString("error")
        }
    }
    LaunchedEffect(s.date, brand) { load() }
    val vendors = diary?.optJSONArray("vendors")?.toObjList() ?: emptyList()
    val outlets = diary?.optJSONArray("outlets")?.toObjList() ?: emptyList()
    val summary = diary?.optJSONObject("summary")
    val caps = me.optJSONArray("capabilities")?.toStrList() ?: emptyList()
    val canAdd = caps.contains("sauda.place") || caps.contains("sauda.demand")
    val placeOutlet = when (brand) {
        "HE" -> outlets.firstOrNull { it.optString("brand") == "HE" }?.optString("outlet_id")
        "NCH" -> outlets.firstOrNull { it.optString("brand") == "NCH" }?.optString("outlet_id")
        else -> outlets.firstOrNull()?.optString("outlet_id")
    } ?: ""
    val paymentCards = vendorDiaryPaymentCards(vendors)
    Scaffold(
        topBar = { HnBar("Vendor diary", subtitle = "Local purchase trail", onBack = back) },
        floatingActionButton = {
            if (canAdd && placeOutlet.isNotEmpty()) ExtendedFloatingActionButton(
                onClick = { openPlace(placeOutlet, "") },
                containerColor = Maroon,
                contentColor = Color.White,
                icon = { Icon(Icons.Filled.Add, null) },
                text = { Text("Add purchase") }
            )
        }
    ) { p ->
        Column(Modifier.padding(p).fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                IconButton(onClick = { setDate(stepDate(s.date, -1)) }) { Icon(Icons.Filled.ChevronLeft, "prev", tint = Maroon) }
                Text(prettyDate(s.date), fontWeight = FontWeight.SemiBold, color = Ink, fontSize = 16.sp,
                    modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
                IconButton(onClick = { setDate(stepDate(s.date, 1)) }) { Icon(Icons.Filled.ChevronRight, "next", tint = Maroon) }
            }
            Row(Modifier.padding(horizontal = 16.dp, vertical = 2.dp).horizontalScroll(rememberScrollState())) {
                FilterChip(selected = brand == "all", onClick = { brand = "all" }, label = { Text("All HN") }, modifier = Modifier.padding(end = 8.dp))
                FilterChip(selected = brand == "HE", onClick = { brand = "HE" }, label = { Text("HE") }, modifier = Modifier.padding(end = 8.dp))
                FilterChip(selected = brand == "NCH", onClick = { brand = "NCH" }, label = { Text("NCH") })
            }
            TabRow(selectedTabIndex = tab, containerColor = Color.White, contentColor = Maroon) {
                listOf("Diary", "Payments", "Add").forEachIndexed { idx, label ->
                    Tab(
                        selected = tab == idx,
                        onClick = { tab = idx },
                        text = { Text(label, fontWeight = if (tab == idx) FontWeight.Bold else FontWeight.Medium) }
                    )
                }
            }
            HorizontalDivider(color = Sand, modifier = Modifier.padding(top = 6.dp))
            when {
                error.isNotEmpty() -> CenterMsg("⚠ $error") { load() }
                diary == null -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = Maroon) }
                tab == 2 -> VendorDiaryAddTab(canAdd, placeOutlet, brand, openPlace)
                tab == 1 -> {
                    if (paymentCards.isEmpty()) CenterMsg("No payment cards in this diary window.\nReceive a bill first, then this tab becomes the payment queue.", null)
                    else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 10.dp, 16.dp, 96.dp)) {
                        item {
                            VendorDiarySummary(summary)
                            Spacer(Modifier.height(10.dp))
                        }
                        items(paymentCards) { c ->
                            VendorPaymentRow(me, c, openCard) { load() }
                            Spacer(Modifier.height(12.dp))
                        }
                    }
                }
                vendors.isEmpty() -> VendorDiaryEmpty(canAdd, placeOutlet, openPlace)
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 10.dp, 16.dp, 96.dp)) {
                    item {
                        VendorDiarySummary(summary)
                        Spacer(Modifier.height(10.dp))
                    }
                    items(vendors) { v ->
                        VendorDiaryCard(v, openCard, canAdd, placeOutlet, openPlace)
                        Spacer(Modifier.height(10.dp))
                    }
                }
            }
        }
    }
}

@Composable
fun VendorDiarySummary(s: JSONObject?) {
    Surface(shape = RoundedCornerShape(10.dp), color = Sand, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            SummaryBit((s?.optInt("vendor_count") ?: 0).toString(), "vendors", Modifier.weight(1f))
            SummaryBit((s?.optInt("open_cards") ?: 0).toString(), "open", Modifier.weight(1f))
            SummaryBit(rupee(s?.optInt("outstanding_paise") ?: 0), "to pay", Modifier.weight(1.2f))
            SummaryBit(rupee(s?.optInt("paid_paise") ?: 0), "paid", Modifier.weight(1.2f))
        }
    }
}

@Composable
fun VendorDiaryEmpty(canAdd: Boolean, placeOutlet: String, openPlace: (String, String) -> Unit) {
    Box(Modifier.fillMaxSize().padding(24.dp), Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("No vendor trail in this window.", color = Muted, fontSize = 15.sp, textAlign = TextAlign.Center)
            if (canAdd && placeOutlet.isNotEmpty()) {
                Spacer(Modifier.height(14.dp))
                Button(
                    onClick = { openPlace(placeOutlet, "") },
                    colors = ButtonDefaults.buttonColors(containerColor = Maroon),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.height(48.dp)
                ) {
                    Icon(Icons.Filled.Add, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Add purchase")
                }
            }
        }
    }
}

@Composable
fun VendorDiaryAddTab(canAdd: Boolean, placeOutlet: String, brand: String, openPlace: (String, String) -> Unit) {
    Box(Modifier.fillMaxSize().padding(16.dp), Alignment.TopCenter) {
        Surface(shape = RoundedCornerShape(12.dp), color = Sand, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("Add local purchase", color = Ink, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text("Creates the normal one-vendor Sauda card for this diary date. Add vendor, product, quantity and expected rate from the purchase flow.",
                    color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                Spacer(Modifier.height(14.dp))
                Button(
                    onClick = { if (placeOutlet.isNotEmpty()) openPlace(placeOutlet, "") },
                    enabled = canAdd && placeOutlet.isNotEmpty(),
                    colors = ButtonDefaults.buttonColors(containerColor = Maroon),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth().height(50.dp)
                ) {
                    Icon(Icons.Filled.AddShoppingCart, null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (brand == "all") "Add purchase card" else "Add $brand purchase")
                }
                if (!canAdd || placeOutlet.isEmpty()) {
                    Text("Your role cannot add purchase cards for this selection.", color = WarnA, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
                }
            }
        }
    }
}

@Composable
fun VendorDiaryCard(v: JSONObject, openCard: (Int, String) -> Unit,
                    canAdd: Boolean, placeOutlet: String, openPlace: (String, String) -> Unit) {
    val cards = v.optJSONArray("cards")?.toObjList() ?: emptyList()
    Surface(shape = RoundedCornerShape(12.dp), color = Color.White, tonalElevation = 1.dp,
        border = androidx.compose.foundation.BorderStroke(1.dp, Sand), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(color = Sand, shape = RoundedCornerShape(10.dp), modifier = Modifier.size(46.dp)) {
                    Box(contentAlignment = Alignment.Center) { Text(v.optString("vendor_name").take(1).uppercase(Locale.US), color = Maroon, fontWeight = FontWeight.Bold) }
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(v.optString("vendor_name"), color = Ink, fontWeight = FontWeight.Bold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(listOf(v.optString("brand").ifEmpty { "HN" }, vendorTerms(v), v.optString("latest_date")).filter { it.isNotEmpty() }.joinToString(" · "),
                        color = Muted, fontSize = 11.sp, maxLines = 2)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(rupee(v.optInt("outstanding_paise")), color = if (v.optInt("outstanding_paise") > 0) WarnA else GoodG,
                        fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Text("to pay", color = Muted, fontSize = 10.sp)
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth()) {
                SummaryBit(v.optInt("order_count").toString(), "cards", Modifier.weight(1f))
                SummaryBit(rupee(v.optInt("received_paise")), "received", Modifier.weight(1f))
                SummaryBit(rupee(v.optInt("raised_paise")), "requested", Modifier.weight(1f))
                SummaryBit(rupee(v.optInt("paid_paise")), "paid", Modifier.weight(1f))
            }
            if (cards.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                cards.take(4).forEach { c ->
                    Row(Modifier.fillMaxWidth().clickable { openCard(c.optInt("id"), c.optString("outlet_id")) }.padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        BrandPill(c.optString("brand"))
                        Spacer(Modifier.width(8.dp))
                        Text("${prettyDate(c.optString("for_date"))} · ${c.optString("status")}",
                            color = Ink, fontSize = 12.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(rupee(c.optInt("amount_paise")), color = Ink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                if ((v.optInt("order_count")) > 4) Text("+${v.optInt("order_count") - 4} older cards", color = Muted, fontSize = 11.sp)
            }
            if (canAdd && placeOutlet.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                OutlinedButton(
                    onClick = { openPlace(placeOutlet, v.optString("vendor_key")) },
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth().height(44.dp)
                ) {
                    Icon(Icons.Filled.Add, null, tint = Maroon, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Add purchase", color = Maroon, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
fun VendorPaymentRow(me: JSONObject, c: JSONObject, openCard: (Int, String) -> Unit, onSaved: () -> Unit) {
    val status = c.optString("status")
    val canOpenPayment = status in listOf("RECEIVED", "RAISED", "PAID", "RECONCILED")
    Surface(shape = RoundedCornerShape(12.dp), color = Color.White, tonalElevation = 1.dp,
        border = androidx.compose.foundation.BorderStroke(1.dp, Sand), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                BrandPill(c.optString("brand"))
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(c.optString("vendor_name"), color = Ink, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${prettyDate(c.optString("for_date"))} · ${c.optString("line_count")} items · ${c.optString("outlet_name")}",
                        color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(rupee(c.optInt("amount_paise")), color = Ink, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    StatusPill(status)
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = { openCard(c.optInt("id"), c.optString("outlet_id")) },
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.weight(1f).height(44.dp)
                ) {
                    Icon(Icons.Filled.ReceiptLong, null, tint = Maroon, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Open card", color = Maroon, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                }
                if (!canOpenPayment) {
                    OutlinedButton(
                        onClick = { openCard(c.optInt("id"), c.optString("outlet_id")) },
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.weight(1f).height(44.dp)
                    ) {
                        Icon(Icons.Filled.Inventory2, null, tint = Maroon, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Receive first", color = Maroon, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                    }
                }
            }
            if (canOpenPayment) {
                PaymentTrail(me, c, c.optInt("id"), onSaved)
            } else {
                Text("Payment opens after goods and bill proof are saved on this card.", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 8.dp))
            }
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
        "CANCELLED" -> Color(0xFFFFE8E1) to WarnA
        else -> Sand to Muted
    }
    Surface(color = pair.first, shape = RoundedCornerShape(6.dp)) {
        Text(status, color = pair.second, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
    }
}

// ---- Card detail + receive ------------------------------------------------
@Composable
fun CardScreen(me: JSONObject, s: Screen.Card, back: () -> Unit, deleted: () -> Unit) {
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf("") }
    var actionError by remember { mutableStateOf("") }
    var receiving by remember { mutableStateOf(false) }
    var editingItems by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var goodsImage by remember { mutableStateOf("") }
    var billImage by remember { mutableStateOf("") }
    val recvQty = remember { mutableStateMapOf<Int, String>() }
    val recvRate = remember { mutableStateMapOf<Int, String>() }
    val editQty = remember { mutableStateMapOf<Int, String>() }
    val editUom = remember { mutableStateMapOf<Int, String>() }
    val editRate = remember { mutableStateMapOf<Int, String>() }
    val editRemoved = remember { mutableStateListOf<Int>() }
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
    val events = data?.optJSONArray("events")?.toObjList() ?: emptyList()
    val status = card?.optString("status") ?: ""
    val canEditItems = caps.contains("sauda.place") && status in listOf("REQUESTED", "ORDERED")
    val canDeleteOrder = caps.contains("sauda.place") && status in listOf("REQUESTED", "ORDERED") && !receiving && !editingItems
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { if (!busy) confirmDelete = false },
            icon = { Icon(Icons.Filled.Delete, null, tint = WarnA) },
            title = { Text("Delete this order card?") },
            text = { Text("This removes it from today's purchase board, but keeps the card lines and event trail for audit.") },
            dismissButton = {
                TextButton(onClick = { if (!busy) confirmDelete = false }) { Text("Cancel") }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (busy) return@Button
                        busy = true; actionError = ""
                        scope.launch {
                            val r = Api.post("delete-order", JSONObject()
                                .put("order_id", s.id)
                                .put("reason", "deleted from Android purchase card"))
                            busy = false
                            if (r.optBoolean("ok")) { confirmDelete = false; deleted() }
                            else { confirmDelete = false; actionError = r.optString("error") }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = WarnA)
                ) { if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp) else Text("Delete") }
            }
        )
    }
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
                            if (editingItems) {
                                EditableOrderLineRow(
                                    l = l,
                                    removed = editRemoved.contains(id),
                                    qtyVal = editQty[id] ?: numStr(l.optDouble("qty_ordered", 0.0)),
                                    uomVal = editUom[id] ?: l.optString("uom"),
                                    rateVal = editRate[id] ?: rupeeTextFromPaise(l.optInt("unit_cost_paise")),
                                    onQty = { editQty[id] = it },
                                    onUom = { editUom[id] = it },
                                    onRate = { editRate[id] = it },
                                    onToggleRemove = {
                                        if (editRemoved.contains(id)) editRemoved.remove(id) else editRemoved.add(id)
                                    }
                                )
                            } else {
                                LineRow(
                                    l = l,
                                    receiving = receiving,
                                    recvVal = recvQty[id] ?: numStr(l.optDouble("qty_ordered", 0.0)),
                                    rateVal = recvRate[id] ?: rupeeTextFromPaise(l.optInt("unit_cost_paise")),
                                    onRecv = { recvQty[id] = it },
                                    onRate = { recvRate[id] = it }
                                )
                            }
                            HorizontalDivider(color = Sand)
                        }
                        item { PurchaseEventTrail(events) }
                        item { PaymentTrail(me, card, s.id) { load() } }
                    }
                    if (caps.contains("sauda.place") || caps.contains("sauda.receive")) Surface(shadowElevation = 8.dp, color = Color.White) {
                        Column(Modifier.padding(16.dp)) {
                            if (editingItems) {
                                if (actionError.isNotEmpty()) {
                                    Text("⚠ $actionError", color = WarnA, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp))
                                }
                                Row {
                                    OutlinedButton(onClick = {
                                        editingItems = false; actionError = ""; editRemoved.clear(); editQty.clear(); editUom.clear(); editRate.clear()
                                    }, modifier = Modifier.weight(1f).height(50.dp)) { Text("Cancel") }
                                    Spacer(Modifier.width(12.dp))
                                    Button(
                                        onClick = {
                                            if (busy) return@Button
                                            val kept = lines.filter { !editRemoved.contains(it.optInt("id")) }
                                            if (kept.isEmpty()) {
                                                actionError = "Keep at least one item on this card."
                                                return@Button
                                            }
                                            val bad = kept.firstOrNull { l -> (editQty[l.optInt("id")]?.toDoubleOrNull() ?: l.optDouble("qty_ordered", 0.0)) <= 0.0 }
                                            if (bad != null) {
                                                actionError = "Enter quantity for every item. Half kg is 0.5 kg."
                                                return@Button
                                            }
                                            val missingUom = kept.firstOrNull { l -> (editUom[l.optInt("id")] ?: l.optString("uom")).trim().isEmpty() }
                                            if (missingUom != null) {
                                                actionError = "Enter unit for every item."
                                                return@Button
                                            }
                                            busy = true; actionError = ""
                                            scope.launch {
                                                val arr = JSONArray()
                                                kept.forEach { l ->
                                                    val id = l.optInt("id")
                                                    arr.put(JSONObject()
                                                        .put("line_id", id)
                                                        .put("item_code", l.optString("item_code"))
                                                        .put("item_label", l.optString("item_label"))
                                                        .put("qty_ordered", editQty[id] ?: numStr(l.optDouble("qty_ordered", 0.0)))
                                                        .put("uom", (editUom[id] ?: l.optString("uom")).trim())
                                                        .put("unit_cost_paise", paiseFromRupeeText(editRate[id] ?: rupeeTextFromPaise(l.optInt("unit_cost_paise"))))
                                                        .put("flag", l.optString("flag")))
                                                }
                                                val r = Api.post("edit-lines", JSONObject().put("order_id", s.id).put("lines", arr))
                                                busy = false
                                                if (r.optBoolean("ok")) {
                                                    editingItems = false; editRemoved.clear(); editQty.clear(); editUom.clear(); editRate.clear(); load()
                                                } else actionError = r.optString("error")
                                            }
                                        },
                                        colors = ButtonDefaults.buttonColors(containerColor = Maroon),
                                        modifier = Modifier.weight(1.4f).height(50.dp), shape = RoundedCornerShape(10.dp)
                                    ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                                        else { Icon(Icons.Filled.Save, null); Spacer(Modifier.width(8.dp)); Text("Save edit") } }
                                }
                            } else {
                                if (canEditItems && !receiving) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                        OutlinedButton(
                                            onClick = {
                                                actionError = ""; editRemoved.clear(); editQty.clear(); editRate.clear()
                                                lines.forEach {
                                                    val id = it.optInt("id")
                                                    editQty[id] = numStr(it.optDouble("qty_ordered", 0.0))
                                                    editUom[id] = it.optString("uom")
                                                    editRate[id] = rupeeTextFromPaise(it.optInt("unit_cost_paise"))
                                                }
                                                editingItems = true
                                            },
                                            modifier = Modifier.weight(1f).height(48.dp),
                                            shape = RoundedCornerShape(10.dp)
                                        ) { Icon(Icons.Filled.Edit, null, tint = Maroon); Spacer(Modifier.width(8.dp)); Text("Edit", color = Maroon, fontWeight = FontWeight.SemiBold) }
                                        if (canDeleteOrder) {
                                            OutlinedButton(
                                                onClick = { actionError = ""; confirmDelete = true },
                                                modifier = Modifier.weight(1f).height(48.dp),
                                                shape = RoundedCornerShape(10.dp),
                                                colors = ButtonDefaults.outlinedButtonColors(contentColor = WarnA)
                                            ) { Icon(Icons.Filled.Delete, null, tint = WarnA); Spacer(Modifier.width(8.dp)); Text("Delete", fontWeight = FontWeight.SemiBold) }
                                        }
                                    }
                                    Spacer(Modifier.height(10.dp))
                                }
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
fun EditableOrderLineRow(l: JSONObject, removed: Boolean, qtyVal: String, uomVal: String, rateVal: String,
                         onQty: (String) -> Unit, onUom: (String) -> Unit, onRate: (String) -> Unit, onToggleRemove: () -> Unit) {
    val uom = uomVal.ifEmpty { "u" }
    Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(l.optString("item_label"), fontWeight = FontWeight.Medium, color = if (removed) Muted else Ink,
                fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(if (removed) "will be removed from this card" else "qty can be decimal; unit is editable",
                color = if (removed) WarnA else Muted, fontSize = 11.sp)
        }
        if (!removed) {
            OutlinedTextField(
                value = qtyVal, onValueChange = { onQty(it.replace(Regex("[^0-9.]"), "")) }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.width(82.dp), label = { Text("qty", fontSize = 10.sp) })
            Spacer(Modifier.width(6.dp))
            OutlinedTextField(
                value = uomVal, onValueChange = { onUom(cleanUnitText(it)) }, singleLine = true,
                modifier = Modifier.width(66.dp), label = { Text("unit", fontSize = 10.sp) })
            Spacer(Modifier.width(6.dp))
            OutlinedTextField(
                value = rateVal, onValueChange = { onRate(it.replace(Regex("[^0-9.]"), "")) }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.width(86.dp), label = { Text("₹/$uom", fontSize = 10.sp) })
        }
        IconButton(onClick = onToggleRemove) {
            Icon(if (removed) Icons.Filled.Restore else Icons.Filled.Close, if (removed) "restore" else "remove",
                tint = if (removed) GoodG else WarnA)
        }
    }
}

@Composable
fun PurchaseEventTrail(events: List<JSONObject>) {
    if (events.isEmpty()) return
    Surface(shape = RoundedCornerShape(12.dp), color = Sand, modifier = Modifier.fillMaxWidth().padding(top = 14.dp)) {
        Column(Modifier.padding(14.dp)) {
            Text("Purchase trail", color = Ink, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Spacer(Modifier.height(6.dp))
            events.take(8).forEach { ev ->
                val label = when (ev.optString("event_type")) {
                    "edit-lines" -> "Items edited"
                    "mark-ordered" -> "Vendor order placed"
                    "receive" -> "Received with proof"
                    "payment-request" -> "Payment requested"
                    "paid" -> "Marked paid"
                    "waba-order-placed" -> "WABA order alerts"
                    "waba-payment-done" -> "WABA payment alerts"
                    "delete-order" -> "Order card deleted"
                    "place" -> "Order card created"
                    "demand" -> "Demand routed"
                    else -> ev.optString("event_type")
                }
                Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.History, null, tint = Maroon, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(label, color = Ink, fontSize = 12.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                    Text(listOf(ev.optString("actor_name"), ev.optString("created_at").take(16)).filter { it.isNotEmpty() }.joinToString(" · "),
                        color = Muted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
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
    val ctx = LocalContext.current
    val vendorVpa = firstVpa(card.optString("vpa_json"))
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
            if (method == "upi" && canPay) {
                Spacer(Modifier.height(8.dp))
                UpiShortcutRow(vendorVpa, amount) { app -> openUpiApp(ctx, app, vendorVpa) }
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
                ) {
                    if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                    else Text(if (requestOnly) "Request payment" else if (paid) "Mark paid" else "Save payment request")
                }
            }
        }
    }
}

data class UpiApp(val label: String, val packageName: String, val mark: String, val bg: Color, val fg: Color)
private val UpiApps = listOf(
    UpiApp("PhonePe", "com.phonepe.app", "P", Color(0xFF4B248C), Color.White),
    UpiApp("GPay", "com.google.android.apps.nbu.paisa.user", "GPay", Color(0xFFEAF1FF), Color(0xFF1A73E8)),
    UpiApp("Paytm", "net.one97.paytm", "Paytm", Color(0xFFE5F5FF), Color(0xFF003DA6)),
    UpiApp("CRED", "com.dreamplug.androidapp", "CRED", Color(0xFF111111), Color.White),
    UpiApp("BHIM", "in.org.npci.upiapp", "BHIM", Color(0xFFFFF0E0), Color(0xFFE65100))
)

@Composable
fun UpiShortcutRow(vpa: String, amount: String, openApp: (UpiApp) -> Unit) {
    Surface(shape = RoundedCornerShape(12.dp), color = Sand, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = RoundedCornerShape(10.dp), color = Color.White, modifier = Modifier.size(42.dp)) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.ContentCopy, null, tint = Maroon, modifier = Modifier.size(20.dp))
                    }
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(if (vpa.isNotEmpty()) vpa else "UPI ID not saved", color = Ink, fontWeight = FontWeight.Bold, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("UPI ID copies automatically. Enter ${amount.ifEmpty { "amount" }} manually in the app.", color = Muted, fontSize = 11.sp, maxLines = 2)
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                UpiApps.forEach { app ->
                    UpiPaymentTile(app, enabled = vpa.isNotEmpty()) { openApp(app) }
                }
            }
        }
    }
}

@Composable
fun UpiPaymentTile(app: UpiApp, enabled: Boolean, onClick: () -> Unit) {
    val ctx = LocalContext.current
    val appIcon = remember(app.packageName) { paymentAppIconBitmap(ctx, app.packageName) }
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = Color.White,
        tonalElevation = 1.dp,
        border = androidx.compose.foundation.BorderStroke(1.dp, Sand),
        modifier = Modifier.padding(end = 10.dp).width(82.dp).height(94.dp).clickable(enabled = enabled, onClick = onClick)
    ) {
        Column(Modifier.padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = if (enabled) app.bg else Sand,
                modifier = Modifier.size(48.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    if (appIcon != null) {
                        Image(
                            bitmap = appIcon.asImageBitmap(),
                            contentDescription = app.label,
                            modifier = Modifier.size(42.dp).clip(RoundedCornerShape(11.dp))
                        )
                    } else {
                        Text(app.mark, color = if (enabled) app.fg else Muted, fontWeight = FontWeight.Black, fontSize = if (app.mark.length > 2) 11.sp else 20.sp)
                    }
                }
            }
            Spacer(Modifier.height(7.dp))
            Text(app.label, color = if (enabled) Ink else Muted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

private val ChickenCuts = listOf("boneless", "shawarma", "kebab", "tandoori", "grill", "tangdi", "lollipop")

@Composable
fun ChickenScreen(s: Screen.Chicken, back: () -> Unit, setDate: (String) -> Unit) {
    var queue by remember { mutableStateOf<JSONObject?>(null) }
    var detailRows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var error by remember { mutableStateOf("") }
    var saveMsg by remember { mutableStateOf("") }
    var dailyRate by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val yieldedKg = remember { mutableStateMapOf<String, String>() }
    val deliveredKg = remember { mutableStateMapOf<String, String>() }
    val scope = rememberCoroutineScope()
    fun load() {
        queue = null; error = ""; saveMsg = ""
        scope.launch {
            val q = ChickenApi.get("action=price-backfill-queue&brand=HE")
            val d = ChickenApi.get("action=day-detail&date=${s.date}&brand=HE")
            if (q.optBoolean("success")) {
                queue = q
                detailRows = d.optJSONArray("rows")?.toObjList() ?: emptyList()
            } else error = q.optString("error", "chicken spine unavailable")
        }
    }
    LaunchedEffect(s.date) { load() }
    val days = queue?.optJSONArray("days")?.toObjList() ?: emptyList()
    val day = days.firstOrNull { it.optString("date") == s.date }
    val lines = day?.optJSONArray("lines")?.toObjList() ?: ChickenCuts.map { JSONObject().put("business_date", s.date).put("cut", it) }
    val detailByCut = detailRows.associateBy { it.optString("cut") }
    LaunchedEffect(queue?.toString(), s.date) {
        yieldedKg.clear(); deliveredKg.clear()
        dailyRate = day?.optInt("daily_rate_paise")?.takeIf { it > 0 }?.let { rupeeTextFromPaise(it) } ?: ""
        lines.forEach { ln ->
            val cut = ln.optString("cut")
            val yielded = ln.optDoubleOrNull("purchased_kg")
            val delivered = ln.optDoubleOrNull("delivered_kg")
            if (yielded != null && yielded > 0) yieldedKg[cut] = numStr(yielded)
            if (delivered != null && delivered > 0) deliveredKg[cut] = numStr(delivered)
        }
    }
    Scaffold(topBar = { HnBar("MN Broilers", subtitle = "HE chicken spine · ${prettyDate(s.date)}", onBack = back) }) { p ->
        Column(Modifier.padding(p).fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                IconButton(onClick = { setDate(stepDate(s.date, -1)) }) { Icon(Icons.Filled.ChevronLeft, "prev", tint = Maroon) }
                Text(prettyDate(s.date), fontWeight = FontWeight.SemiBold, color = Ink, fontSize = 16.sp,
                    modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
                IconButton(onClick = { setDate(stepDate(s.date, 1)) }) { Icon(Icons.Filled.ChevronRight, "next", tint = Maroon) }
            }
            when {
                error.isNotEmpty() -> CenterMsg("⚠ $error") { load() }
                queue == null -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = Maroon) }
                else -> {
                    LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 92.dp)) {
                        item {
                            Surface(shape = RoundedCornerShape(12.dp), color = Sand, modifier = Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(14.dp)) {
                                    Text("Daily chicken bill", color = Ink, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                    Text("Enter MN's one ₹/kg rate, then delivered kg by cut. Backend computes cost and effective yielded rate.",
                                        color = Muted, fontSize = 11.sp)
                                    Spacer(Modifier.height(10.dp))
                                    OutlinedTextField(
                                        value = dailyRate,
                                        onValueChange = { dailyRate = it.replace(Regex("[^0-9.]"), "") },
                                        singleLine = true,
                                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                        label = { Text("MN daily rate ₹/kg") },
                                        modifier = Modifier.fillMaxWidth()
                                    )
                                }
                            }
                            Spacer(Modifier.height(10.dp))
                        }
                        items(lines) { line ->
                            val cut = line.optString("cut")
                            ChickenCutRow(
                                line = line,
                                detail = detailByCut[cut],
                                yielded = yieldedKg[cut] ?: "",
                                delivered = deliveredKg[cut] ?: "",
                                onYielded = { yieldedKg[cut] = it },
                                onDelivered = { deliveredKg[cut] = it }
                            )
                            HorizontalDivider(color = Sand)
                        }
                    }
                    Surface(shadowElevation = 8.dp, color = Color.White) {
                        Column(Modifier.padding(16.dp)) {
                            if (saveMsg.isNotEmpty()) Text(saveMsg, color = if (saveMsg.startsWith("Saved")) GoodG else WarnA,
                                fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp))
                            Button(
                                onClick = {
                                    if (busy) return@Button
                                    val rate = paiseFromRupeeText(dailyRate)
                                    if (rate <= 0) { saveMsg = "Enter MN daily rate."; return@Button }
                                    val cuts = JSONArray()
                                    lines.forEach { line ->
                                        val cut = line.optString("cut")
                                        val delivered = deliveredKg[cut]?.toDoubleOrNull() ?: 0.0
                                        val yielded = yieldedKg[cut]?.toDoubleOrNull() ?: 0.0
                                        if (delivered > 0.0) {
                                            cuts.put(JSONObject().put("cut", cut).put("delivered_kg", delivered).put("yielded_kg", yielded))
                                        }
                                    }
                                    if (cuts.length() == 0) { saveMsg = "Enter delivered kg for at least one cut."; return@Button }
                                    busy = true; saveMsg = ""
                                    scope.launch {
                                        val r = ChickenApi.post("save-day-prices", JSONObject()
                                            .put("date", s.date)
                                            .put("daily_rate", dailyRate)
                                            .put("cuts", cuts))
                                        busy = false
                                        if (r.optBoolean("success")) {
                                            val results = r.optJSONArray("results")?.toObjList() ?: emptyList()
                                            val ok = results.count { it.optBoolean("ok") }
                                            val bad = results.firstOrNull { !it.optBoolean("ok") }
                                            saveMsg = if (bad == null) "Saved $ok chicken cuts." else "Saved $ok; ${bad.optString("cut")} needs ${bad.optString("error")}."
                                            load()
                                        } else saveMsg = r.optString("error", "save failed")
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Maroon),
                                modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(10.dp)
                            ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                                else { Icon(Icons.Filled.Save, null); Spacer(Modifier.width(8.dp)); Text("Save MN chicken entry") } }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ChickenCutRow(line: JSONObject, detail: JSONObject?, yielded: String, delivered: String,
                  onYielded: (String) -> Unit, onDelivered: (String) -> Unit) {
    val cut = line.optString("cut")
    val cost = line.optInt("cost_paise")
    val effective = line.optInt("price_per_kg_paise")
    val recipeG = detail?.optInt("recipe_consumed_g") ?: 0
    val variance = detail?.optDoubleOrNull("variance_pct")
    Column(Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(chickenCutLabel(cut), color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                val sub = mutableListOf<String>()
                if (cost > 0) sub.add("cost ${rupee(cost)}")
                if (effective > 0) sub.add("effective ${rupee(effective)}/kg")
                if (recipeG > 0) sub.add("recipe ${numStr(recipeG / 1000.0)} kg")
                if (variance != null) sub.add("${if (variance > 0) "+" else ""}${numStr(variance)}% variance")
                Text(sub.ifEmpty { listOf("waiting for MN bill entry") }.joinToString(" · "),
                    color = Muted, fontSize = 11.sp, maxLines = 2)
            }
            OutlinedTextField(
                value = yielded,
                onValueChange = { onYielded(it.replace(Regex("[^0-9.]"), "")) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.width(82.dp),
                label = { Text("yield", fontSize = 10.sp) }
            )
            Spacer(Modifier.width(6.dp))
            OutlinedTextField(
                value = delivered,
                onValueChange = { onDelivered(it.replace(Regex("[^0-9.]"), "")) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.width(82.dp),
                label = { Text("MN kg", fontSize = 10.sp) }
            )
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
                                        onUom = { uv -> draft[idx] = JSONObject(d.toString()).put("uom", uv) },
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
                    if (draft.any { it.optDouble("qty", 0.0) <= 0.0 }) {
                        error = "Enter quantity for every item. Half kg is 0.5 kg."
                        return@Button
                    }
                    if (draft.any { it.optString("uom").trim().isEmpty() }) {
                        error = "Enter unit for every item."
                        return@Button
                    }
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
fun DemandDraftLine(line: JSONObject, onQty: (String) -> Unit, onUom: (String) -> Unit, onRemove: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(line.optString("item_label"), color = Ink, fontWeight = FontWeight.Medium, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                line.optString("hindi_label").ifEmpty { "Hindi pending" } + " · 0.5 kg ok",
                color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis
            )
        }
        OutlinedTextField(
            value = line.optString("qty").ifEmpty { "1" },
            onValueChange = { v -> onQty(v.replace(Regex("[^0-9.]"), "")) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.width(74.dp),
            textStyle = androidx.compose.ui.text.TextStyle(textAlign = TextAlign.Center)
        )
        Spacer(Modifier.width(6.dp))
        OutlinedTextField(
            value = line.optString("uom"),
            onValueChange = { v -> onUom(cleanUnitText(v)) },
            singleLine = true,
            modifier = Modifier.width(62.dp),
            label = { Text("unit", fontSize = 10.sp) }
        )
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
    var vendorKey by remember(s.outlet, s.date, s.vendorKey) { mutableStateOf(s.vendorKey) }
    var vendorMenu by remember { mutableStateOf(false) }
    var itemQuery by remember { mutableStateOf("") }
    val draft = remember { mutableStateListOf<JSONObject>() }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var masterBusy by remember { mutableStateOf(false) }
    var masterError by remember { mutableStateOf("") }
    var addVendorOpen by remember { mutableStateOf(false) }
    var addProductOpen by remember { mutableStateOf(false) }
    var newVendorName by remember { mutableStateOf("") }
    var newVendorCategory by remember { mutableStateOf("") }
    var newVendorFulfilment by remember { mutableStateOf("deliver") }
    var newVendorPay by remember { mutableStateOf("per") }
    var newVendorPhone by remember { mutableStateOf("") }
    var newVendorVpa by remember { mutableStateOf("") }
    var newItemLabel by remember { mutableStateOf("") }
    var newItemUnit by remember { mutableStateOf("kg") }
    var newItemCategory by remember { mutableStateOf("") }
    var newItemPriceMode by remember { mutableStateOf("live") }
    var newItemRate by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    suspend fun loadCatalog(): JSONObject {
        val r = Api.get("action=catalog&outlet=${s.outlet}")
        if (r.optBoolean("ok")) cat = r else error = r.optString("error")
        return r
    }
    LaunchedEffect(Unit) {
        loadCatalog()
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
    fun addCreatedItemToDraft(it2: JSONObject) {
        val code = it2.optString("item_code")
        if (code.isEmpty()) return
        vendorKey = it2.optString("default_vendor").ifEmpty { vendorKey }
        if (draft.none { d -> d.optString("item_code") == code }) {
            draft.add(JSONObject().put("item_code", code).put("item_label", it2.optString("label"))
                .put("qty", 1).put("uom", it2.optString("unit"))
                .put("unit_cost_paise", if (it2.optString("price_mode") != "live") it2.optInt("price_paise") else 0))
        }
    }
    fun openProductDialog(defaultLabel: String = searchText) {
        if (vendorKey.isEmpty()) {
            error = "Pick or add a vendor first, then add the product."
            return
        }
        masterError = ""
        newItemLabel = defaultLabel.trim()
        newItemUnit = "kg"
        newItemCategory = vendorByKey[vendorKey]?.optString("category").orEmpty()
        newItemPriceMode = "live"
        newItemRate = ""
        addProductOpen = true
    }
    if (addVendorOpen) {
        AlertDialog(
            onDismissRequest = { if (!masterBusy) addVendorOpen = false },
            title = { Text("Add vendor", color = Ink, fontWeight = FontWeight.Bold) },
            text = {
                Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                    OutlinedTextField(
                        value = newVendorName,
                        onValueChange = { newVendorName = it; masterError = "" },
                        singleLine = true,
                        label = { Text("Vendor name *") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = newVendorCategory,
                        onValueChange = { newVendorCategory = it; masterError = "" },
                        singleLine = true,
                        label = { Text("Category *") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = newVendorPhone,
                        onValueChange = { newVendorPhone = it.replace(Regex("[^0-9+]"), "").take(16); masterError = "" },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        label = { Text("Phone / WhatsApp *") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = newVendorVpa,
                        onValueChange = { newVendorVpa = it.trim(); masterError = "" },
                        singleLine = true,
                        label = { Text("UPI VPA") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(12.dp))
                    Text("Fulfilment *", color = Ink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                        listOf("deliver" to "Delivery", "collect" to "Collect", "standing" to "Standing", "porter" to "Porter", "bus" to "Bus").forEach { opt ->
                            FilterChip(
                                selected = newVendorFulfilment == opt.first,
                                onClick = { newVendorFulfilment = opt.first; masterError = "" },
                                label = { Text(opt.second, maxLines = 1) },
                                modifier = Modifier.padding(end = 8.dp)
                            )
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Text("Payment rule *", color = Ink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                        listOf("per" to "Per bill", "khata_roll" to "Running khata", "khata_periodic" to "Periodic khata").forEach { opt ->
                            FilterChip(
                                selected = newVendorPay == opt.first,
                                onClick = { newVendorPay = opt.first; masterError = "" },
                                label = { Text(opt.second, maxLines = 1) },
                                modifier = Modifier.padding(end = 8.dp)
                            )
                        }
                    }
                    if (masterError.isNotEmpty()) Text(masterError, color = WarnA, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (masterBusy) return@Button
                        val name = newVendorName.trim()
                        val category = newVendorCategory.trim()
                        val phone = newVendorPhone.trim()
                        if (name.isEmpty() || category.isEmpty() || phone.isEmpty()) {
                            masterError = "Vendor name, category, phone, fulfilment and payment rule are mandatory."
                            return@Button
                        }
                        masterBusy = true; masterError = ""
                        scope.launch {
                            val r = Api.post("add-vendor", JSONObject()
                                .put("outlet", s.outlet)
                                .put("name", name)
                                .put("category", category)
                                .put("fulfilment", newVendorFulfilment)
                                .put("pay_behaviour", newVendorPay)
                                .put("phone", phone)
                                .put("vpa", newVendorVpa.trim()))
                            masterBusy = false
                            if (r.optBoolean("ok")) {
                                val v = r.optJSONObject("vendor") ?: JSONObject()
                                val key = v.optString("vendor_key")
                                if (key.isNotEmpty()) vendorKey = key
                                draft.clear()
                                addVendorOpen = false
                                newItemLabel = searchText
                                newItemCategory = category
                                newItemUnit = "kg"
                                newItemPriceMode = "live"
                                newItemRate = ""
                                loadCatalog()
                                addProductOpen = true
                                error = if (r.optBoolean("existed")) "Vendor already existed. Add product under it." else "Vendor added. Add product under it."
                            } else masterError = r.optString("error", "vendor add failed")
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Maroon)
                ) {
                    if (masterBusy) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                    else Text("Save vendor")
                }
            },
            dismissButton = {
                OutlinedButton(onClick = { if (!masterBusy) addVendorOpen = false }) { Text("Cancel") }
            }
        )
    }
    if (addProductOpen) {
        AlertDialog(
            onDismissRequest = { if (!masterBusy) addProductOpen = false },
            title = { Text("Add product", color = Ink, fontWeight = FontWeight.Bold) },
            text = {
                Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                    Text("Vendor: ${vendorName}", color = Muted, fontSize = 12.sp)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = newItemLabel,
                        onValueChange = { newItemLabel = it; masterError = "" },
                        singleLine = true,
                        label = { Text("Product name *") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = newItemUnit,
                        onValueChange = { newItemUnit = cleanUnitText(it); masterError = "" },
                        singleLine = true,
                        label = { Text("Unit *") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = newItemCategory,
                        onValueChange = { newItemCategory = it; masterError = "" },
                        singleLine = true,
                        label = { Text("Category *") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(12.dp))
                    Text("Price mode *", color = Ink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                        FilterChip(
                            selected = newItemPriceMode == "live",
                            onClick = { newItemPriceMode = "live"; masterError = "" },
                            label = { Text("Live bill rate") },
                            modifier = Modifier.padding(end = 8.dp)
                        )
                        FilterChip(
                            selected = newItemPriceMode == "fixed",
                            onClick = { newItemPriceMode = "fixed"; masterError = "" },
                            label = { Text("Fixed expected rate") }
                        )
                    }
                    if (newItemPriceMode == "fixed") {
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = newItemRate,
                            onValueChange = { newItemRate = it.replace(Regex("[^0-9.]"), ""); masterError = "" },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            label = { Text("Expected rate ₹ *") },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    if (masterError.isNotEmpty()) Text(masterError, color = WarnA, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (masterBusy) return@Button
                        val label = newItemLabel.trim()
                        val unit = newItemUnit.trim()
                        val category = newItemCategory.trim()
                        val pricePaise = paiseFromRupeeText(newItemRate)
                        if (vendorKey.isEmpty()) {
                            masterError = "Pick or add vendor first."
                            return@Button
                        }
                        if (label.isEmpty() || unit.isEmpty() || category.isEmpty()) {
                            masterError = "Product name, unit, category and price mode are mandatory."
                            return@Button
                        }
                        if (newItemPriceMode == "fixed" && pricePaise <= 0) {
                            masterError = "Enter expected rate for fixed-rate product."
                            return@Button
                        }
                        masterBusy = true; masterError = ""
                        scope.launch {
                            val r = Api.post("add-item", JSONObject()
                                .put("outlet", s.outlet)
                                .put("vendor_key", vendorKey)
                                .put("label", label)
                                .put("unit", unit)
                                .put("category", category)
                                .put("price_mode", newItemPriceMode)
                                .put("price_paise", if (newItemPriceMode == "fixed") pricePaise else 0))
                            masterBusy = false
                            if (r.optBoolean("ok")) {
                                val it2 = r.optJSONObject("item")
                                if (it2 != null) addCreatedItemToDraft(it2)
                                addProductOpen = false
                                itemQuery = ""
                                loadCatalog()
                                error = if (r.optBoolean("existed")) "Product already existed. Added to order card." else "Product added to master and order card."
                            } else masterError = r.optString("error", "product add failed")
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Maroon)
                ) {
                    if (masterBusy) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                    else Text("Save product")
                }
            },
            dismissButton = {
                OutlinedButton(onClick = { if (!masterBusy) addProductOpen = false }) { Text("Cancel") }
            }
        )
    }
    Scaffold(topBar = { HnBar("Place order", subtitle = prettyDate(s.date), onBack = back) }) { p ->
        Column(Modifier.padding(p).fillMaxSize().padding(16.dp)) {
            if (cat == null && error.isEmpty()) { Box(Modifier.fillMaxWidth().padding(40.dp), Alignment.Center) { CircularProgressIndicator(color = Maroon) }; return@Column }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    OutlinedButton(onClick = { vendorMenu = true }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(10.dp)) {
                        Icon(Icons.Filled.Store, null, tint = Maroon); Spacer(Modifier.width(8.dp))
                        Text(vendorName, color = Ink, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis); Icon(Icons.Filled.ArrowDropDown, null)
                    }
                    DropdownMenu(expanded = vendorMenu, onDismissRequest = { vendorMenu = false }) {
                        vendors.forEach { v ->
                            DropdownMenuItem(text = { Text(v.optString("name")) }, onClick = {
                                vendorKey = v.optString("vendor_key"); vendorMenu = false; draft.clear(); error = "" })
                        }
                    }
                }
                Spacer(Modifier.width(8.dp))
                OutlinedButton(onClick = {
                    masterError = ""; error = ""
                    newVendorName = ""; newVendorCategory = ""; newVendorFulfilment = "deliver"
                    newVendorPay = "per"; newVendorPhone = ""; newVendorVpa = ""
                    addVendorOpen = true
                }, shape = RoundedCornerShape(10.dp), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 10.dp)) {
                    Icon(Icons.Filled.AddCircleOutline, null, tint = Maroon)
                    Spacer(Modifier.width(6.dp))
                    Text("Vendor", color = Maroon, maxLines = 1)
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
            Spacer(Modifier.height(6.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (vendorKey.isNotEmpty()) "Products will be added under $vendorName." else "Pick or add vendor before adding product.",
                    color = Muted, fontSize = 12.sp, modifier = Modifier.weight(1f), maxLines = 2
                )
                TextButton(onClick = { openProductDialog(searchText) }, enabled = vendorKey.isNotEmpty()) {
                    Icon(Icons.Filled.AddCircleOutline, null, tint = if (vendorKey.isNotEmpty()) Maroon else Muted)
                    Spacer(Modifier.width(4.dp))
                    Text("Product", color = if (vendorKey.isNotEmpty()) Maroon else Muted)
                }
            }
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
                                onUom = { u -> draft[idx] = JSONObject(d.toString()).put("uom", u) },
                                onRemove = { draft.removeAt(idx) }
                            )
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
            }
            if (displayItems.isNotEmpty()) {
                if (vendorKey.isNotEmpty()) Text("Tap +, then set quantity and unit. Half kg = 0.5 kg.", color = Muted, fontSize = 12.sp)
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
                                        modifier = Modifier.width(78.dp),
                                        textStyle = androidx.compose.ui.text.TextStyle(textAlign = TextAlign.Center))
                                    Spacer(Modifier.width(4.dp))
                                    OutlinedTextField(
                                        value = inDraft.optString("uom").ifEmpty { unit },
                                        onValueChange = { v -> draft[idx] = JSONObject(inDraft.toString()).put("uom", cleanUnitText(v)) },
                                        singleLine = true,
                                        modifier = Modifier.width(62.dp),
                                        label = { Text("unit", fontSize = 10.sp) }
                                    )
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
                        Text(
                            if (vendorKey.isEmpty()) "Pick or add a vendor first." else "Add this as a product under $vendorName.",
                            color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp)
                        )
                        Spacer(Modifier.height(12.dp))
                        OutlinedButton(onClick = { openProductDialog(searchText) }, enabled = vendorKey.isNotEmpty(), shape = RoundedCornerShape(10.dp)) {
                            Icon(Icons.Filled.AddCircleOutline, null, tint = Maroon)
                            Spacer(Modifier.width(8.dp))
                            Text("Add product", color = Maroon)
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
                    if (busy || draft.isEmpty()) return@Button
                    if (draft.any { it.optDouble("qty", 0.0) <= 0.0 }) {
                        error = "Enter quantity for every item. Half kg is 0.5 kg."
                        return@Button
                    }
                    if (draft.any { it.optString("uom").trim().isEmpty() }) {
                        error = "Enter unit for every item."
                        return@Button
                    }
                    busy = true; error = ""
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
fun DraftLineEditor(line: JSONObject, onQty: (String) -> Unit, onUom: (String) -> Unit, onRemove: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(line.optString("item_label"), color = Ink, fontWeight = FontWeight.Medium, fontSize = 13.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (line.optString("flag").isNotEmpty()) Text(line.optString("flag"), color = WarnA, fontSize = 10.sp)
            else Text("Half kg = 0.5 kg. Change unit only if bill uses another unit.", color = Muted, fontSize = 10.sp, maxLines = 2)
        }
        OutlinedTextField(
            value = numStr(line.optDouble("qty", 1.0)),
            onValueChange = { v -> onQty(v.replace(Regex("[^0-9.]"), "")) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.width(76.dp),
            textStyle = androidx.compose.ui.text.TextStyle(textAlign = TextAlign.Center)
        )
        Spacer(Modifier.width(6.dp))
        OutlinedTextField(
            value = line.optString("uom"),
            onValueChange = { v -> onUom(cleanUnitText(v)) },
            singleLine = true,
            modifier = Modifier.width(62.dp),
            label = { Text("unit", fontSize = 10.sp) }
        )
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
fun cleanUnitText(s: String): String = s.replace(Regex("[^A-Za-z0-9./ -]"), "").take(12)
fun JSONArray.toStrList(): List<String> = (0 until length()).map { optString(it) }
fun JSONArray.toObjList(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
fun JSONObject.optDoubleOrNull(key: String): Double? {
    val v = opt(key)
    if (v == null || v == JSONObject.NULL) return null
    val d = when (v) {
        is Number -> v.toDouble()
        else -> v.toString().toDoubleOrNull()
    } ?: return null
    return if (d.isNaN() || d.isInfinite()) null else d
}
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
fun vendorDiaryPaymentCards(vendors: List<JSONObject>): List<JSONObject> {
    val rows = mutableListOf<JSONObject>()
    vendors.forEach { v ->
        val cards = v.optJSONArray("cards")?.toObjList() ?: emptyList()
        cards.forEach { c ->
            rows.add(JSONObject(c.toString())
                .put("vendor_key", v.optString("vendor_key"))
                .put("vendor_name", v.optString("vendor_name"))
                .put("fulfilment", v.optString("fulfilment"))
                .put("pay_behaviour", v.optString("pay_behaviour"))
                .put("phone", v.optString("phone"))
                .put("vpa_json", v.optString("vpa_json"))
                .put("expected_amount_paise", c.optInt("expected_amount_paise").takeIf { it > 0 } ?: c.optInt("amount_paise"))
            )
        }
    }
    val priority = mapOf("RECEIVED" to 0, "RAISED" to 1, "ORDERED" to 2, "REQUESTED" to 3, "PAID" to 4, "RECONCILED" to 5)
    return rows.sortedWith(compareBy<JSONObject> { priority[it.optString("status")] ?: 9 }
        .thenByDescending { it.optInt("amount_paise") }
        .thenBy { it.optString("vendor_name") })
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
fun firstVpa(rawJson: String): String {
    if (rawJson.isBlank()) return ""
    return try {
        val arr = JSONArray(rawJson)
        (0 until arr.length()).map { arr.optString(it).trim() }.firstOrNull { it.isNotEmpty() } ?: ""
    } catch (e: Exception) {
        rawJson.split(',', ';', '\n').map { it.trim().trim('[', ']', '"') }.firstOrNull { it.contains("@") } ?: ""
    }
}
fun paymentAppIconBitmap(ctx: Context, packageName: String): Bitmap? = try {
    drawableToBitmap(ctx.packageManager.getApplicationIcon(packageName))
} catch (e: Exception) {
    null
}
fun drawableToBitmap(drawable: Drawable): Bitmap {
    if (drawable is BitmapDrawable && drawable.bitmap != null) return drawable.bitmap
    val w = if (drawable.intrinsicWidth > 0) drawable.intrinsicWidth else 96
    val h = if (drawable.intrinsicHeight > 0) drawable.intrinsicHeight else 96
    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    drawable.setBounds(0, 0, canvas.width, canvas.height)
    drawable.draw(canvas)
    return bitmap
}
fun openUpiApp(ctx: Context, app: UpiApp, vpa: String) {
    if (vpa.isBlank()) {
        Toast.makeText(ctx, "No UPI ID saved for this vendor", Toast.LENGTH_SHORT).show()
        return
    }
    val clip = ClipData.newPlainText("Vendor UPI ID", vpa)
    (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
    val launch = ctx.packageManager.getLaunchIntentForPackage(app.packageName)
    if (launch != null) {
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(launch)
        Toast.makeText(ctx, "UPI ID copied. Enter amount manually.", Toast.LENGTH_LONG).show()
        return
    }
    val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=${app.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
        ctx.startActivity(market)
    } catch (e: Exception) {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=${app.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    Toast.makeText(ctx, "UPI ID copied. Install or open ${app.label}.", Toast.LENGTH_LONG).show()
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
        c.contains("chicken") -> "Chicken"
        c.contains("meat") -> "Meat"
        c.contains("pack") || c.contains("paper") -> "Packaging"
        c.contains("water") || c.contains("beverage") -> "Water"
        c.contains("pantry") || c.contains("dry") || c.contains("spice") -> "Pantry"
        cat.isNotBlank() -> cat.take(12)
        else -> "Other"
    }
}
fun categoryColor(cat: String): Color = when (cat) {
    "Fresh" -> Color(0xFFEAF5EA)
    "Chicken" -> Color(0xFFFDE5E5)
    "Meat" -> Color(0xFFFDECEC)
    "Dairy" -> Color(0xFFEAF1FF)
    "Packaging" -> Color(0xFFFFF4DB)
    "Water" -> Color(0xFFE6F4F1)
    "Pantry" -> Color(0xFFF5F0EF)
    else -> Sand
}
fun paiseFromRupeeText(v: String): Int = Math.max(0, Math.round(((v.replace(Regex("[^0-9.]"), "").toDoubleOrNull() ?: 0.0) * 100)).toInt())
fun rupeeTextFromPaise(paise: Int): String = if (paise <= 0) "" else (paise / 100.0).let { if (it == it.toLong().toDouble()) it.toLong().toString() else String.format(Locale.US, "%.2f", it) }
fun chickenCutLabel(cut: String): String = when (cut) {
    "boneless" -> "Boneless"
    "shawarma" -> "Shawarma"
    "kebab" -> "Kebab"
    "tandoori" -> "Tandoori"
    "grill" -> "Grill"
    "tangdi" -> "Tangdi"
    "lollipop" -> "Lollipop / wings"
    else -> cut.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() }
}

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
