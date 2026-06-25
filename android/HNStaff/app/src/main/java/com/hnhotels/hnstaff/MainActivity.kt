package com.hnhotels.hnstaff

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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

// ---- nav model ------------------------------------------------------------
sealed class Screen {
    object Home : Screen()
    data class Day(val outlet: String, val date: String) : Screen()
    data class Card(val id: Int, val outlet: String, val date: String) : Screen()
    data class Place(val outlet: String, val date: String) : Screen()
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
    val nav = remember { mutableStateListOf<Screen>(Screen.Home) }
    val cur = nav.last()
    BackHandler(enabled = nav.size > 1) { nav.removeAt(nav.lastIndex) }
    when (cur) {
        is Screen.Home -> HomeScreen(me, chambers) { o, d -> nav.add(Screen.Day(o, d)) }
        is Screen.Day -> DayScreen(me, cur,
            back = { nav.removeAt(nav.lastIndex) },
            openCard = { id -> nav.add(Screen.Card(id, cur.outlet, cur.date)) },
            openPlace = { nav.add(Screen.Place(cur.outlet, cur.date)) },
            setOutletDate = { o, d -> nav[nav.lastIndex] = Screen.Day(o, d) })
        is Screen.Card -> CardScreen(me, cur) { nav.removeAt(nav.lastIndex) }
        is Screen.Place -> PlaceScreen(me, cur, back = { nav.removeAt(nav.lastIndex) }) { nav.removeAt(nav.lastIndex) }
    }
}

// ---- Home: chamber tiles derived from role --------------------------------
@Composable
fun HomeScreen(me: JSONObject, chambers: List<String>, openSauda: (String, String) -> Unit) {
    val outlets = me.optJSONArray("outlets") ?: JSONArray()
    val firstOutlet = if (outlets.length() > 0) outlets.getJSONObject(0).optString("outlet_id") else ""
    Scaffold(topBar = { HnBar("HN Hotels", subtitle = me.optString("name") + " · " + me.optString("role_label")) }) { p ->
        Column(Modifier.padding(p).padding(20.dp).fillMaxSize()) {
            Text("Your work", color = Muted, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(12.dp))
            if (chambers.contains("sauda"))
                ChamberTile("Sauda", "Purchase — place & receive", Icons.Filled.ShoppingCart, true) { openSauda(firstOutlet, todayIst()) }
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
        "RECEIVED" -> Color(0xFFE6F2E6) to GoodG
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
    var receiving by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val recvQty = remember { mutableStateMapOf<Int, String>() }
    val scope = rememberCoroutineScope()
    fun load() {
        data = null
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
                            LineRow(l, receiving, recvQty[id] ?: numStr(l.optDouble("qty_ordered", 0.0))) { recvQty[id] = it }
                            HorizontalDivider(color = Sand)
                        }
                    }
                    if (caps.contains("sauda.receive")) Surface(shadowElevation = 8.dp, color = Color.White) {
                        Box(Modifier.padding(16.dp)) {
                            if (!receiving && status == "ORDERED") Button(
                                onClick = { receiving = true; lines.forEach { recvQty[it.optInt("id")] = numStr(it.optDouble("qty_ordered", 0.0)) } },
                                colors = ButtonDefaults.buttonColors(containerColor = Maroon),
                                modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(10.dp)
                            ) { Icon(Icons.Filled.Inventory2, null); Spacer(Modifier.width(8.dp)); Text("Receive goods") }
                            else if (receiving) Row {
                                OutlinedButton(onClick = { receiving = false }, modifier = Modifier.weight(1f).height(50.dp)) { Text("Cancel") }
                                Spacer(Modifier.width(12.dp))
                                Button(
                                    onClick = {
                                        if (busy) return@Button; busy = true
                                        scope.launch {
                                            val arr = JSONArray()
                                            lines.forEach { l -> val id = l.optInt("id")
                                                arr.put(JSONObject().put("line_id", id)
                                                    .put("qty_received", (recvQty[id] ?: "").ifEmpty { "0" })
                                                    .put("receive_state", "ok")) }
                                            val r = Api.post("receive", JSONObject().put("order_id", s.id).put("lines", arr))
                                            busy = false
                                            if (r.optBoolean("ok")) { receiving = false; load() } else error = r.optString("error")
                                        }
                                    },
                                    colors = ButtonDefaults.buttonColors(containerColor = GoodG),
                                    modifier = Modifier.weight(1.4f).height(50.dp), shape = RoundedCornerShape(10.dp)
                                ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                                    else { Icon(Icons.Filled.Check, null); Spacer(Modifier.width(8.dp)); Text("Confirm received") } }
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
fun LineRow(l: JSONObject, receiving: Boolean, recvVal: String, onRecv: (String) -> Unit) {
    val flag = l.optString("flag")
    Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(l.optString("item_label"), fontWeight = FontWeight.Medium, color = Ink, fontSize = 15.sp)
            val q = numStr(l.optDouble("qty_ordered", 0.0)); val uom = l.optString("uom")
            val cost = l.optInt("unit_cost_paise")
            Text("ordered $q $uom" + (if (cost > 0) " · ${rupee(cost)}/$uom" else ""), color = Muted, fontSize = 12.sp)
            if (flag.isNotEmpty()) Text("⚠ $flag", color = WarnA, fontSize = 11.sp)
        }
        if (receiving) OutlinedTextField(
            value = recvVal, onValueChange = onRecv, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.width(92.dp), label = { Text("recv", fontSize = 10.sp) })
        else {
            val qr = l.opt("qty_received")
            Column(horizontalAlignment = Alignment.End) {
                Text(rupee(l.optInt("line_amount_paise")), color = Ink, fontSize = 14.sp)
                if (qr != null && qr != JSONObject.NULL) Text("✓ ${numStr(l.optDouble("qty_received", 0.0))}", color = GoodG, fontSize = 12.sp)
            }
        }
    }
}

// ---- Place: vendor-first --------------------------------------------------
@Composable
fun PlaceScreen(me: JSONObject, s: Screen.Place, back: () -> Unit, placed: () -> Unit) {
    var cat by remember { mutableStateOf<JSONObject?>(null) }
    var vendorKey by remember { mutableStateOf("") }
    var vendorMenu by remember { mutableStateOf(false) }
    val draft = remember { mutableStateListOf<JSONObject>() }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        val r = Api.get("action=catalog&outlet=${s.outlet}")
        if (r.optBoolean("ok")) cat = r else error = r.optString("error")
    }
    val vendors = cat?.optJSONArray("vendors")?.toObjList() ?: emptyList()
    val vendorName = vendors.firstOrNull { it.optString("vendor_key") == vendorKey }?.optString("name") ?: "Pick vendor"
    val itemsByVendor = cat?.optJSONObject("items_by_vendor")
    val vendorItems = if (vendorKey.isNotEmpty()) itemsByVendor?.optJSONArray(vendorKey)?.toObjList() ?: emptyList() else emptyList()
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
                            vendorKey = v.optString("vendor_key"); vendorMenu = false; draft.clear() })
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            if (vendorKey.isNotEmpty()) {
                Text("Tap +, then set the quantity", color = Muted, fontSize = 12.sp)
                LazyColumn(Modifier.weight(1f)) {
                    items(vendorItems) { it2 ->
                        val code = it2.optString("item_code")
                        val idx = draft.indexOfFirst { d -> d.optString("item_code") == code }
                        val inDraft = if (idx >= 0) draft[idx] else null
                        val unit = it2.optString("unit")
                        val pr = it2.optInt("price_paise")
                        Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(it2.optString("label"), fontWeight = FontWeight.Medium, color = Ink, fontSize = 15.sp)
                                    Text(if (pr > 0) rupee(pr) + "/" + unit else "rate at bill", color = Muted, fontSize = 12.sp)
                                }
                                if (inDraft == null) IconButton(onClick = {
                                    draft.add(JSONObject().put("item_code", code).put("item_label", it2.optString("label"))
                                        .put("qty", 1).put("uom", unit)
                                        .put("unit_cost_paise", if (it2.optString("price_mode") != "live") pr else 0))
                                }) { Icon(Icons.Filled.AddCircleOutline, "add", tint = Maroon) }
                                else Row(verticalAlignment = Alignment.CenterVertically) {
                                    OutlinedTextField(
                                        value = numStr(inDraft.optDouble("qty", 1.0)),
                                        onValueChange = { v ->
                                            val q = v.replace(Regex("[^0-9.]"), "")
                                            draft[idx] = JSONObject(inDraft.toString()).put("qty", q.ifEmpty { "0" }) },
                                        singleLine = true,
                                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
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
            } else CenterMsg("Pick a vendor to start.\nOne vendor = one order card.", null)
        }
    }
}

// ---- shared bits ----------------------------------------------------------
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
