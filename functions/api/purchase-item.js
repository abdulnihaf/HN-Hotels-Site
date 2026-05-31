// Purchase-Item API — generic COUNT-based vendor purchase thread (buns, water, packaging…).
// Distinct from milk (which is weigh-based, 2 slots). Here: order in the owner's unit,
// vendor bills in their pack SKU, staff receives by COUNT. One engine, items are config.
//
// COA: pack_qty/pack_rate captures "buying unit ≠ counting unit" (Ganga sells 3-piece packs;
// owner thinks in buns). Each item is a point in (item × vendor × order_unit × pack). New item = 1 row.
// Posture: TRACK not CATCH. Self-creating schema. Shares DB binding (hn-hiring).

export async function onRequest(context) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(context.request.url);
  const action = url.searchParams.get('action');
  const DB = context.env.DB;
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });

  const USERS = { '0305':'Nihaf','5882':'Nihaf','2026':'Zoya','8316':'Zoya','3678':'Faheem','6045':'Faheem','6890':'Tanveer','7115':'Kesmat','3946':'Jafar','9991':'Mujib','3697':'Yashwant','3754':'Naveen','8241':'Nafees','8523':'Basheer','4040':'Haneef','5050':'Nisar' };
  const who = pin => USERS[(pin || '').trim()] || null;

  // Manager (Basheer) WhatsApp — pulled LIVE from Darbar's hr_employees (single source of truth,
  // not hardcoded). Basheer = PIN 8523. Falls back to '' so the UI shows "set number" rather than guess.
  async function managerPhone() {
    try {
      const r = await DB.prepare(`SELECT phone FROM hr_employees WHERE pin='8523' AND is_active=1 LIMIT 1`).first();
      return (r?.phone || '').replace(/[^\d]/g, '');
    } catch (_) { return ''; }
  }

  async function ensureSchema() {
    await DB.batch([
      DB.prepare(`CREATE TABLE IF NOT EXISTS purchase_items (
        code TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT 'NCH',
        vendor TEXT, vendor_phone TEXT, emoji TEXT DEFAULT '📦',
        channel TEXT NOT NULL DEFAULT 'vendor',     -- 'vendor' (WhatsApp) | 'ration' (departmental/q-comm)
        order_unit TEXT NOT NULL DEFAULT 'units',   -- how owner orders (e.g. "buns")
        pack_qty REAL DEFAULT 1, pack_rate REAL DEFAULT 0, pack_label TEXT DEFAULT '',
        receive_unit TEXT NOT NULL DEFAULT 'units',
        last_dept_price REAL DEFAULT 0, last_dept_store TEXT DEFAULT '', last_qcomm_price REAL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 100)`),
      DB.prepare(`CREATE TABLE IF NOT EXISTS manager_pickup_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT, item_code TEXT NOT NULL, item_name TEXT, brand TEXT DEFAULT 'NCH',
        for_date TEXT NOT NULL, qty REAL NOT NULL, unit TEXT, store_hint TEXT,
        status TEXT NOT NULL DEFAULT 'open',   -- open | sent | done
        added_by TEXT, added_at TEXT NOT NULL, sent_at TEXT)`),
      DB.prepare(`CREATE TABLE IF NOT EXISTS purchase_item_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, item_code TEXT NOT NULL, brand TEXT DEFAULT 'NCH',
        for_date TEXT NOT NULL, qty REAL NOT NULL, message TEXT,
        placed_by_pin TEXT, placed_by TEXT, placed_at TEXT NOT NULL)`),
      DB.prepare(`CREATE TABLE IF NOT EXISTS purchase_item_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, item_code TEXT NOT NULL, brand TEXT DEFAULT 'NCH',
        for_date TEXT NOT NULL, qty_received REAL NOT NULL, ordered_qty REAL, variance REAL,
        photo_data TEXT, received_by_pin TEXT, received_by TEXT, received_at TEXT NOT NULL, notes TEXT)`),
      // DEMAND = "what to buy" per day, seeded from the uploaded PO. The /order screen IS this list.
      DB.prepare(`CREATE TABLE IF NOT EXISTS purchase_demand (
        id INTEGER PRIMARY KEY AUTOINCREMENT, brand TEXT NOT NULL, for_date TEXT NOT NULL,
        item_code TEXT NOT NULL, qty_text TEXT, unit TEXT, note TEXT,
        UNIQUE(brand, for_date, item_code))`),
    ]);
    // MIGRATE FIRST — older purchase_items table may predate these columns (CREATE IF NOT EXISTS skips them).
    // Must run before any INSERT that references the new columns.
    // receivable: 1 = something is DELIVERED (vendor / quick-commerce) → gets a receive link.
    //             0 = owner/manager BUYS IN PERSON (Shariff/Ashrafiya go-collect) → no receive step.
    for (const col of [
      "channel TEXT NOT NULL DEFAULT 'vendor'", 'last_dept_price REAL DEFAULT 0',
      "last_dept_store TEXT DEFAULT ''", 'last_qcomm_price REAL DEFAULT 0',
      'receivable INTEGER NOT NULL DEFAULT 1',
      // match_rule: how the price-scout resolves this item across platforms.
      //   'cheapest' = lowest-priced match for the commodity (default)
      //   'locked'   = fetch ONLY the exact pinned SKU in locked_sku / locked_query
      "match_rule TEXT NOT NULL DEFAULT 'cheapest'", "locked_sku TEXT DEFAULT ''", "locked_query TEXT DEFAULT ''"]) {
      try { await DB.prepare(`ALTER TABLE purchase_items ADD COLUMN ${col}`).run(); } catch (_) { /* already exists */ }
    }
    // ── CATALOG: full NCH + HE purchase items (tomorrow's POs), seeded idempotently. ──
    // channel: vendor=WhatsApp delivered · ration=departmental/q-comm · qcomm=quick-commerce.
    // receivable: 1 if delivered (vendor/qcomm) → has receive link; 0 if bought-in-person (go-collect).
    // [code,name,brand,vendor,phone,emoji,channel,order_unit,pack_qty,pack_rate,pack_label,receive_unit,dept_price,dept_store,qcomm_price,receivable,sort]
    const CAT = [
      // ===== NCH =====
      ['MILK','Buffalo Milk','NCH','Prabhu Buffalo Milk','919886806395','🥛','vendor','litres',1,55,'','litres',0,'',0,1,5],
      ['BUNS','Buns','NCH','Ganga Bakery','917019547835','🍞','vendor','buns',3,25,'3-piece pack','buns',0,'',0,1,10],
      ['WATER','Bisleri 500ml Water','NCH','Nadeem (Water & Cold Drinks)','919900323484','💧','vendor','cases',1,0,'','cases',0,'',0,1,20],
      ['BUTTER','Amul Butter','NCH','','','🧈','ration','kg',1,0,'','kg',285,'Ashrafiya',280,0,30],
      ['MILKMAID','Milkmaid (Condensed Milk)','NCH','','','🥫','ration','kg',1,0,'','kg',324,'Ashrafiya',0,0,40],
      ['NCH_LEMON','Lemon','NCH','','','🍋','ration','pcs',1,0,'','pcs',0,'Ashrafiya',0,0,50],
      ['NCH_CUTLET','Chicken Cutlets','NCH','','','🍗','vendor','box',1,0,'','box',0,'',0,1,60],
      ['NCH_SAMOSA','Samosa','NCH','','','🥟','vendor','pcs',1,0,'','pcs',0,'',0,1,70],
      ['NCH_CARRY_S','Small carry bags','NCH','Shree Ram Deepak','919620515684','🛍️','vendor','packet',1,0,'','packet',0,'',0,1,80],
      ['NCH_CARRY_M','Medium carry bags','NCH','Shree Ram Deepak','919620515684','🛍️','vendor','packet',1,0,'','packet',0,'',0,1,81],
      ['NCH_CUPS','Small use-&-throw cups','NCH','Shree Ram Deepak','919620515684','🥤','vendor','packet',1,0,'','packet',0,'',0,1,82],
      // ===== HE ===== dry goods / pantry (ration unless a known vendor)
      ['HE_CHILLI_PWD','Chilli powder','HE','','','🌶️','ration','kg',1,0,'','kg',0,'Ashrafiya',0,0,110],
      ['HE_TOMATO_SAUCE','Tomato sauce (Kissan)','HE','','','🍅','ration','bottle',1,0,'','bottle',0,'Ashrafiya',0,0,111],
      ['HE_CHILLI_SAUCE','Chilli sauce','HE','','','🌶️','ration','pc',1,0,'','pc',0,'Ashrafiya',0,0,112],
      ['HE_SOYA_SAUCE','Soya sauce','HE','','','🫙','ration','pc',1,0,'','pc',0,'Ashrafiya',0,0,113],
      ['HE_KKING','Kitchen King masala','HE','','','🧂','ration','kg',1,0,'','kg',0,'Ashrafiya',0,0,114],
      ['HE_OIL_BOX','Oil','HE','','','🛢️','ration','box',1,0,'','box',0,'Ashrafiya',0,0,115],
      ['HE_SUNFLOWER','Sunflower oil','HE','','','🛢️','ration','L',1,0,'','L',0,'Ashrafiya',0,0,116],
      ['HE_MAIDA','Maida','HE','','','🌾','ration','kg',1,0,'','kg',0,'Ashrafiya',0,0,117],
      // HE fresh & dairy
      ['HE_AMUL_CREAM','Amul cream','HE','','','🥛','ration','L',1,0,'','L',0,'Ashrafiya',0,0,120],
      ['HE_DAHI','Dahi','HE','','','🥛','ration','L',1,0,'','L',0,'Ashrafiya',0,0,121],
      ['HE_MILK','Milk','HE','','','🥛','ration','L',1,0,'','L',0,'Ashrafiya',0,0,122],
      ['HE_CAPSICUM','Capsicum','HE','Manju Veg','919886744138','🫑','vendor','kg',1,0,'','kg',0,'',0,1,123],
      ['HE_DHANIA','Dhania patta (coriander)','HE','Manju Veg','919886744138','🌿','vendor','bunch',1,0,'','bunch',0,'',0,1,124],
      ['HE_SPRING_ONION','Spring onion','HE','Manju Veg','919886744138','🧅','vendor','bunch',1,0,'','bunch',0,'',0,1,125],
      ['HE_CARROT','Carrot','HE','Manju Veg','919886744138','🥕','vendor','kg',1,0,'','kg',0,'',0,1,126],
      ['HE_CABBAGE','Cabbage','HE','Manju Veg','919886744138','🥬','vendor','kg',1,0,'','kg',0,'',0,1,127],
      ['HE_PANEER','Paneer','HE','','','🧀','ration','kg',1,0,'','kg',0,'Ashrafiya',0,0,128],
      ['HE_BUTTER','Butter','HE','','','🧈','ration','gm',1,0,'','gm',285,'Ashrafiya',280,0,129],
      // HE proteins (vendor-delivered)
      ['HE_MUTTON','Mutton','HE','Mutton Irshad Bhai','919880656387','🐐','vendor','kg',1,0,'','kg',0,'',0,1,140],
      ['HE_MUTTON_BRAIN','Mutton brain','HE','Mutton Irshad Bhai','919880656387','🧠','vendor','pcs',1,0,'','pcs',0,'',0,1,141],
      ['HE_EGG','Egg','HE','','','🥚','ration','crate',1,0,'','crate',0,'Ashrafiya',0,0,142],
      ['HE_BONELESS','Boneless chicken','HE','M.N. Broilers','919845237700','🍗','vendor','kg',1,0,'','kg',0,'',0,1,143],
      ['HE_SHAWARMA','Shawarma chicken','HE','M.N. Broilers','919845237700','🍗','vendor','kg',1,0,'','kg',0,'',0,1,144],
      ['HE_TANDOORI','Tandoori chicken','HE','M.N. Broilers','919845237700','🍗','vendor','birds',1,0,'','birds',0,'',0,1,145],
      // HE other
      ['HE_CHARCOAL','Charcoal','HE','Charcoal Mudassir','918050547191','🪵','vendor','bag',1,0,'','bag',0,'',0,1,150],
      ['HE_SILVER_POUCH','Silver pouch (8×10)','HE','Shree Ram Deepak','919620515684','🥡','vendor','packet',1,0,'','packet',0,'',0,1,151],
      ['HE_CARRY_68','Carry bag (6×8)','HE','Shree Ram Deepak','919620515684','🛍️','vendor','packet',1,0,'','packet',0,'',0,1,152],
      ['HE_CARRY_810','Carry bag (8×10)','HE','Shree Ram Deepak','919620515684','🛍️','vendor','packet',1,0,'','packet',0,'',0,1,153],
      ['HE_WATER_1L','Bisleri 1L water','HE','Nadeem (Water & Cold Drinks)','919900323484','💧','vendor','cases',1,0,'','cases',0,'',0,1,154],
      ['HE_WATER_500','Bisleri 500ml water','HE','Nadeem (Water & Cold Drinks)','919900323484','💧','vendor','cases',1,0,'','cases',0,'',0,1,155],
      ['HE_COKE','Coke (200ml)','HE','Nadeem (Water & Cold Drinks)','919900323484','🥤','vendor','cases',1,0,'','cases',0,'',0,1,156],
      ['HE_SELLO','Sello tape','HE','','','📦','ration','pc',1,0,'','pc',0,'Ashrafiya',0,0,157],
    ];
    const stmts = CAT.map(r => DB.prepare(
      `INSERT OR IGNORE INTO purchase_items (code,name,brand,vendor,vendor_phone,emoji,channel,order_unit,pack_qty,pack_rate,pack_label,receive_unit,last_dept_price,last_dept_store,last_qcomm_price,receivable,sort,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`
    ).bind(...r));
    // keep the proven-correct fields fresh on the already-seeded items (idempotent UPDATEs)
    stmts.push(DB.prepare(`UPDATE purchase_items SET channel='ration', last_dept_price=285, last_dept_store='Ashrafiya', last_qcomm_price=280, receivable=0 WHERE code='BUTTER'`));
    stmts.push(DB.prepare(`UPDATE purchase_items SET channel='ration', last_dept_price=324, last_dept_store='Ashrafiya', receivable=0 WHERE code='MILKMAID'`));
    stmts.push(DB.prepare(`UPDATE purchase_items SET receivable=1 WHERE code IN ('BUNS','WATER')`));
    // Match rules: most items = cheapest. These have a LOCKED exact SKU (Nihaf, 2026-06-01).
    stmts.push(DB.prepare(`UPDATE purchase_items SET match_rule='locked', locked_query='Amul unsalted butter 500g' WHERE code IN ('BUTTER','HE_BUTTER')`));
    stmts.push(DB.prepare(`UPDATE purchase_items SET match_rule='locked', locked_query='Nestle Milkmaid 5kg' WHERE code='MILKMAID'`));
    await DB.batch(stmts);

    // ── DEMAND seed: tomorrow's PO (2026-06-01), both brands. qty_text keeps the PO's own wording. ──
    // '—' = PO left it blank (confirm at purchase). Idempotent on (brand,for_date,item_code).
    const D = '2026-06-01';
    const DEM = [
      // NCH
      ['NCH','MILK','60 + 40','litres','morning 60 · evening 40'],
      ['NCH','BUNS','100','buns',''],['NCH','BUTTER','3.5','kg','7 pkts'],
      ['NCH','MILKMAID','5','kg',''],['NCH','NCH_LEMON','20','pcs',''],
      ['NCH','NCH_CUTLET','3','box','30 pcs'],['NCH','NCH_SAMOSA','10','pcs','verify no vs pack'],
      ['NCH','WATER','6','case',''],['NCH','NCH_CARRY_S','2','packet',''],
      ['NCH','NCH_CARRY_M','2','packet',''],['NCH','NCH_CUPS','5','packet',''],
      // HE
      ['HE','HE_CHILLI_PWD','1','kg',''],['HE','HE_TOMATO_SAUCE','—','bottle','Kissan'],
      ['HE','HE_CHILLI_SAUCE','2','pc',''],['HE','HE_SOYA_SAUCE','2','pc',''],
      ['HE','HE_KKING','1','kg',''],['HE','HE_OIL_BOX','—','box',''],
      ['HE','HE_SUNFLOWER','4','L',''],['HE','HE_MAIDA','10','kg',''],
      ['HE','HE_AMUL_CREAM','1','L',''],['HE','HE_DAHI','4','L',''],
      ['HE','HE_MILK','2','L',''],['HE','HE_CAPSICUM','2','kg',''],
      ['HE','HE_DHANIA','2','bunch',''],['HE','HE_SPRING_ONION','1','bunch',''],
      ['HE','HE_CARROT','2','kg',''],['HE','HE_CABBAGE','4','kg',''],
      ['HE','HE_PANEER','1','kg',''],['HE','HE_BUTTER','500','gm',''],
      ['HE','HE_MUTTON','3','kg',''],['HE','HE_MUTTON_BRAIN','20','pc',''],
      ['HE','HE_EGG','3','crate',''],['HE','HE_BONELESS','10','kg',''],
      ['HE','HE_SHAWARMA','7','kg',''],['HE','HE_TANDOORI','3','birds',''],
      ['HE','HE_CHARCOAL','—','bag',''],['HE','HE_SILVER_POUCH','—','packet',''],
      ['HE','HE_CARRY_68','—','packet',''],['HE','HE_CARRY_810','—','packet',''],
      ['HE','HE_WATER_1L','2','case',''],['HE','HE_WATER_500','1','case',''],
      ['HE','HE_COKE','1','case',''],['HE','HE_SELLO','5','pc',''],
    ];
    await DB.batch(DEM.map(d => DB.prepare(
      `INSERT OR IGNORE INTO purchase_demand (brand,for_date,item_code,qty_text,unit,note) VALUES (?,?,?,?,?,?)`
    ).bind(d[0], D, d[1], d[2], d[3], d[4])));
  }

  try {
    await ensureSchema();

    if (action === 'verify-pin') { const n = who(url.searchParams.get('pin')); return n ? json({ success:true, name:n }) : json({ success:false, error:'Invalid PIN' }, 401); }

    if (action === 'item') {
      const it = await DB.prepare('SELECT * FROM purchase_items WHERE code=? AND active=1').bind(url.searchParams.get('code')).first();
      return it ? json({ success:true, item:it }) : json({ success:false, error:'Unknown item' }, 404);
    }

    // ── LIVE PRICES — scrape the ready+wired portals for one item, rank cheapest. ──
    // Uses the proven VPS scout (same call shape as purchase-control). Stale/unwired
    // portals self-filter (return ERROR → dropped). Locked items query exact SKU.
    if (action === 'prices') {
      const code = url.searchParams.get('code');
      const it = await DB.prepare('SELECT * FROM purchase_items WHERE code=? AND active=1').bind(code).first();
      if (!it) return json({ success:false, error:'Unknown item' }, 404);
      // only items that are open-market get scraped; vendor/known-rate items don't need it
      const query = (it.match_rule === 'locked' && it.locked_query) ? it.locked_query : it.name;
      // Only portals with a wired VPS adapter (kept in sync with purchase-control VPS_WIRED_SOURCES).
      const SCRAPEABLE = ['HYPERPURE','BIGBASKET','JIOMART','BLINKIT','FLIPKART_MINUTES','AMAZON_NOW','AMAZON_FRESH','ZEPTO'];
      const VPS_URL = context.env.SCOUT_VPS_URL, BEARER = context.env.SCOUT_VPS_BEARER;
      if (!VPS_URL || !BEARER) return json({ success:false, error:'Price scout not configured on this environment' }, 503);
      // Mirror the PROVEN scout contract: {material_id,name,search_query,match_rule,sources:[src]} → data.results[src]
      const scout = async (src) => {
        try {
          const r = await fetch(`${VPS_URL}/scout`, {
            method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${BEARER}`},
            body: JSON.stringify({ material_id: code, name: it.name, search_query: query,
              match_rule: it.match_rule === 'locked' ? 'EXACT_SKU' : 'COMMODITY_EQUIVALENT', sources:[src] }),
            signal: AbortSignal.timeout(40000),
          });
          if (!r.ok) return { src, ok:false, note:`VPS ${r.status}` };
          const data = await r.json().catch(() => ({}));
          const d = data.results?.[src];
          if (!d || d.stock_status === 'ERROR') return { src, ok:false, note: d?.match_notes || 'no match' };
          const paise = d.price_paise || (d.unit_price_paise || 0);
          if (!paise) return { src, ok:false, note: d.match_notes || 'no price' };
          return { src, ok:true, price: Math.round(paise)/100, sku: d.sku_title || '', url: d.sku_url || '', pack: d.pack_size || '', eta: d.eta_label || '', conf: d.match_confidence || 0 };
        } catch (e) { return { src, ok:false, note: e.message }; }
      };
      const all = await Promise.all(SCRAPEABLE.map(scout));
      const live = all.filter(r => r.ok).sort((a,b) => a.price - b.price);
      const dead = all.filter(r => !r.ok).map(r => r.src);
      return json({ success:true, item: it.name, query, match_rule: it.match_rule, fetched_at: new Date().toISOString(), results: live, no_result: dead });
    }
    if (action === 'items') {
      const brand = url.searchParams.get('brand');
      const r = brand
        ? await DB.prepare('SELECT * FROM purchase_items WHERE active=1 AND brand=? ORDER BY sort, name').bind(brand).all()
        : await DB.prepare('SELECT * FROM purchase_items WHERE active=1 ORDER BY sort, name').all();
      return json({ success:true, items:r.results || [] });
    }

    // Purchase Home — the DAY'S PO: only items with demand for the date, each with its qty-to-buy.
    // This screen IS "what to buy tomorrow"; the owner's only job is "from where" → tap a card.
    if (action === 'home') {
      const brand = url.searchParams.get('brand') || 'NCH';
      const date = url.searchParams.get('date') || new Date(Date.now() + 864e5).toISOString().slice(0,10); // default tomorrow
      const demand = (await DB.prepare('SELECT item_code, qty_text, unit, note FROM purchase_demand WHERE brand=? AND for_date=?').bind(brand, date).all()).results || [];
      const demandMap = Object.fromEntries(demand.map(d => [d.item_code, d]));
      const codes = demand.map(d => d.item_code);
      let items = [];
      if (codes.length) {
        const ph = codes.map(() => '?').join(',');
        items = (await DB.prepare(`SELECT * FROM purchase_items WHERE active=1 AND code IN (${ph}) ORDER BY sort, name`).bind(...codes).all()).results || [];
      }
      const ordered = new Set((await DB.prepare('SELECT DISTINCT item_code FROM purchase_item_orders WHERE for_date=?').bind(date).all()).results.map(o => o.item_code));
      const listSet = new Set((await DB.prepare(`SELECT DISTINCT item_code FROM manager_pickup_list WHERE for_date=? AND status='open'`).bind(date).all()).results.map(o => o.item_code));
      // milk receipts count as "ordered" too (milk uses its own thread)
      for (const it of items) {
        const d = demandMap[it.code] || {};
        it.qty_text = d.qty_text; it.demand_unit = d.unit; it.note = d.note;
        it.is_ordered = ordered.has(it.code);
        it.on_pickup_list = listSet.has(it.code);
      }
      return json({ success:true, brand, date, manager_phone: await managerPhone(), items });
    }

    if (action === 'log-order' && context.request.method === 'POST') {
      const b = await context.request.json(); const name = who(b.pin);
      if (!name) return json({ success:false, error:'Invalid PIN' }, 401);
      const qty = parseFloat(b.qty); if (!(qty > 0)) return json({ success:false, error:'qty required' }, 400);
      const it = await DB.prepare('SELECT code FROM purchase_items WHERE code=?').bind(b.item_code).first();
      if (!it) return json({ success:false, error:'Unknown item' }, 400);
      const forDate = b.for_date || new Date().toISOString().slice(0,10);
      const res = await DB.prepare(`INSERT INTO purchase_item_orders (item_code,for_date,qty,message,placed_by_pin,placed_by,placed_at) VALUES (?,?,?,?,?,?,?)`)
        .bind(b.item_code, forDate, qty, b.message || '', String(b.pin), name, new Date().toISOString()).run();
      return json({ success:true, id: res.meta?.last_row_id });
    }

    // ── RATION rail: add an item to Basheer's departmental go-collect list ──
    if (action === 'add-to-manager-list' && context.request.method === 'POST') {
      const b = await context.request.json(); const name = who(b.pin);
      if (!name) return json({ success:false, error:'Invalid PIN' }, 401);
      const qty = parseFloat(b.qty); if (!(qty > 0)) return json({ success:false, error:'qty required' }, 400);
      const it = await DB.prepare('SELECT code,name,order_unit,last_dept_store FROM purchase_items WHERE code=?').bind(b.item_code).first();
      if (!it) return json({ success:false, error:'Unknown item' }, 400);
      const forDate = b.for_date || new Date().toISOString().slice(0,10);
      // de-dupe: one open line per item+date — update qty instead of stacking
      const ex = await DB.prepare(`SELECT id FROM manager_pickup_list WHERE item_code=? AND for_date=? AND status='open'`).bind(b.item_code, forDate).first();
      if (ex) {
        await DB.prepare(`UPDATE manager_pickup_list SET qty=?, added_by=?, added_at=? WHERE id=?`).bind(qty, name, new Date().toISOString(), ex.id).run();
        return json({ success:true, id: ex.id, updated:true });
      }
      const res = await DB.prepare(`INSERT INTO manager_pickup_list (item_code,item_name,for_date,qty,unit,store_hint,status,added_by,added_at) VALUES (?,?,?,?,?,?, 'open', ?, ?)`)
        .bind(it.code, it.name, forDate, qty, it.order_unit, b.store_hint || it.last_dept_store || '', name, new Date().toISOString()).run();
      return json({ success:true, id: res.meta?.last_row_id });
    }

    // view the current open pickup list (owner)
    if (action === 'manager-list') {
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0,10);
      const r = await DB.prepare(`SELECT id,item_code,item_name,qty,unit,store_hint,status,added_by FROM manager_pickup_list WHERE for_date=? AND status='open' ORDER BY id`).bind(date).all();
      return json({ success:true, manager_phone: await managerPhone(), items: r.results || [] });
    }

    // remove a line from the list
    if (action === 'remove-from-manager-list' && context.request.method === 'POST') {
      const b = await context.request.json(); if (!who(b.pin)) return json({ success:false, error:'Invalid PIN' }, 401);
      await DB.prepare(`DELETE FROM manager_pickup_list WHERE id=?`).bind(b.id).run();
      return json({ success:true });
    }

    // mark the whole list sent (after owner taps the WhatsApp send)
    if (action === 'mark-list-sent' && context.request.method === 'POST') {
      const b = await context.request.json(); if (!who(b.pin)) return json({ success:false, error:'Invalid PIN' }, 401);
      const date = b.for_date || new Date().toISOString().slice(0,10);
      await DB.prepare(`UPDATE manager_pickup_list SET status='sent', sent_at=? WHERE for_date=? AND status='open'`).bind(new Date().toISOString(), date).run();
      return json({ success:true });
    }

    if (action === 'receive' && context.request.method === 'POST') {
      const b = await context.request.json(); const name = who(b.pin);
      if (!name) return json({ success:false, error:'Invalid PIN' }, 401);
      const qty = parseFloat(b.qty_received); if (!(qty > 0)) return json({ success:false, error:'qty required' }, 400);
      if (!b.photo_data || !String(b.photo_data).startsWith('data:image')) return json({ success:false, error:'Live photo required' }, 400);
      const it = await DB.prepare('SELECT code FROM purchase_items WHERE code=?').bind(b.item_code).first();
      if (!it) return json({ success:false, error:'Unknown item' }, 400);
      const forDate = b.for_date || new Date().toISOString().slice(0,10);
      let ordered = null;
      const o = await DB.prepare('SELECT qty FROM purchase_item_orders WHERE item_code=? AND for_date=? ORDER BY placed_at DESC LIMIT 1').bind(b.item_code, forDate).first();
      if (o) ordered = o.qty;
      const variance = ordered != null ? Math.round((ordered - qty) * 100) / 100 : null;
      const receivedAt = new Date().toISOString();
      const res = await DB.prepare(`INSERT INTO purchase_item_receipts (item_code,for_date,qty_received,ordered_qty,variance,photo_data,received_by_pin,received_by,received_at,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(b.item_code, forDate, qty, ordered, variance, b.photo_data, String(b.pin), name, receivedAt, b.notes || '').run();
      return json({ success:true, id: res.meta?.last_row_id, qty_received: qty, ordered_qty: ordered, variance, received_at: receivedAt });
    }

    if (action === 'ledger') {
      const code = url.searchParams.get('code');
      const ow = code ? ' WHERE item_code=?' : '';
      const orders = (await (code ? DB.prepare(`SELECT item_code,for_date,qty,placed_by,placed_at FROM purchase_item_orders${ow} ORDER BY for_date DESC, placed_at DESC LIMIT 120`).bind(code) : DB.prepare(`SELECT item_code,for_date,qty,placed_by,placed_at FROM purchase_item_orders ORDER BY for_date DESC, placed_at DESC LIMIT 120`)).all()).results || [];
      const receipts = (await (code ? DB.prepare(`SELECT item_code,for_date,qty_received,ordered_qty,variance,received_by,received_at FROM purchase_item_receipts${ow} ORDER BY for_date DESC, received_at DESC LIMIT 120`).bind(code) : DB.prepare(`SELECT item_code,for_date,qty_received,ordered_qty,variance,received_by,received_at FROM purchase_item_receipts ORDER BY for_date DESC, received_at DESC LIMIT 120`)).all()).results || [];
      return json({ success:true, orders, receipts });
    }

    return json({ success:false, error:'Invalid action' }, 400);
  } catch (e) { return json({ success:false, error: e.message }, 500); }
}
