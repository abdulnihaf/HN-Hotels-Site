// ═══════════════════════════════════════════════════════════════════════════
// ANBAR — inventory chamber API (anbar.hnhotels.in)
// Sauda buys · Anbar counts and settles. Layer 1: NCH, six unit-countable items.
//
// The conservation law per item per location:
//   counter: last_count + receipts(counter) + issues(store→counter) − POS sold = expected
//   store:   last_count + receipts(store) − issues(store→counter)            = expected
// Deduction is ALWAYS derived from the POS (configs 27 counter, 32/36 kiosks,
// 37 chai chowki) — staff never record consumption, only receive/issue/count.
//
// D1: hn-hiring → rm_outlet_counts / rm_outlet_receipts / rm_outlet_issues
// Odoo POS (read-only): ops.hamzahotel.com via ODDO key env ODOO_NCH_POS_KEY
// ═══════════════════════════════════════════════════════════════════════════

const ODOO_URL = 'https://ops.hamzahotel.com/jsonrpc';
const ODOO_DB = 'main';
const ODOO_UID = 2;
const POS_CONFIGS = [27, 32, 36, 37];

const PINS = {
  '0305': 'Nihaf', '8523': 'Bashir', '6890': 'Tanveer', '3754': 'Naveen',
  '7115': 'CASH001', '8241': 'CASH002', '2847': 'CASH003', '5190': 'CASH004',
  '3678': 'RUN001', '4421': 'RUN002', '5503': 'RUN003', '6604': 'RUN004', '7705': 'RUN005',
  '2026': 'Zoya',
};

// Layer-1 NCH items. pos = product.template ids + factor (units consumed per line qty).
// All bun SKUs consume the same physical bun → one Anbar item, factor 1 each.
const ITEMS = [
  // HUMANS NEVER MULTIPLY: pack = the unit issues move in (store→counter);
  // case = the unit deliveries arrive in (receives). The server converts both.
  // 1 OB box = 20 packets = 480 pieces · 1 cutlet box = 30 pieces.
  // made_in_house: produced in the kitchen — receive = "made & moved to counter".
  { code: 'NCH-OB',  name: 'Osmania Biscuit', uom: 'piece',  locs: ['counter', 'store'], pack: { name: 'packet', size: 24 }, ccase: { name: 'box', size: 480 }, pos: [{ tmpl: 1030, f: 1 }, { tmpl: 1033, f: 3 }] },
  { code: 'NCH-WTR', name: 'Water Bottle',    uom: 'bottle', locs: ['counter'],          ccase: { name: 'case', size: 24 }, pos: [{ tmpl: 1076, f: 1 }] },
  { code: 'NCH-KH',  name: 'Khajoor',         uom: 'piece',  locs: ['counter'],          made_in_house: true, pos: [{ tmpl: 1435, f: 1 }] },
  { code: 'NCH-BUN', name: 'Bun (all types)', uom: 'bun',    locs: ['counter'],          pos: [{ tmpl: 1029, f: 1 }, { tmpl: 1644, f: 1 }, { tmpl: 1645, f: 1 }, { tmpl: 1643, f: 1 }] },
  { code: 'NCH-CC',  name: 'Chicken Cutlet',  uom: 'piece',  locs: ['counter'],          ccase: { name: 'box', size: 10 }, pos: [{ tmpl: 1031, f: 1 }] },
  { code: 'NCH-PS',  name: 'Pyaaz Samosa',    uom: 'piece',  locs: ['counter'],          pos: [{ tmpl: 1097, f: 1 }] },
  // Store-only items (layer 2 ingredients): tracked at the store door from the
  // moment anything exits. No POS term — store law is count + received − issued.
  // Consumption joins later via the chai recipe lane.
  { code: 'HN-RM-200', name: 'Buffalo Milk',         uom: 'L',  locs: ['store'], pos: [] },
  { code: 'HN-RM-202', name: 'Tea Powder',          uom: 'kg', locs: ['store'], pos: [] },
  { code: 'HN-RM-201', name: 'Skimmed Milk Powder', uom: 'kg', locs: ['store'], pos: [] },
];

const CHICKEN_CUTS = ['boneless', 'shawarma', 'kebab', 'tandoori', 'grill', 'tangdi', 'lollipop'];
const KG_ORDERED_CHICKEN_CUTS = ['boneless', 'shawarma'];
const CHICKEN_LABELS = {
  boneless: 'Boneless Chicken',
  shawarma: 'Shawarma Chicken',
  kebab: 'Kebab Chicken',
  tandoori: 'Tandoori Cut Chicken',
  grill: 'Grill Chicken',
  tangdi: 'Tangdi Chicken',
  lollipop: 'Chicken Lollipop',
};
const MN_BROILERS_RE = /\b(m\.?\s*n\.?\s*broilers|mn\s*broilers|m\.?\s*n\.?\s*chicken|mn\s*chicken)\b/i;
const NCH_RECEIVE_DEFS = [
  {
    kind: 'buns',
    aliases: ['bun'],
    code: 'NCH-BUN',
    name: 'Bun (all types)',
    uom: 'bun',
    loc: 'counter',
    vendorRe: /\b(ganga\s*bake(?:ry|rs)|ganga)\b/i,
    lineRe: /\b(bun|buns|bread|paav|pav)\b/i,
  },
  {
    kind: 'milk',
    aliases: ['buffalo-milk', 'buffalo_milk'],
    code: 'HN-RM-200',
    name: 'Buffalo Milk',
    uom: 'L',
    loc: 'store',
    vendorRe: /\b(prabhu|buffalo\s*milk|bootha)\b/i,
    lineRe: /\b(buffalo\s*)?milk\b/i,
  },
];
const MILK_CANS = {
  BLUE40: { can_id: 'BLUE40', label: 'Blue 40L can', color: 'blue', tare_kg: 4.70, nominal_l: 40 },
  GREY40: { can_id: 'GREY40', label: 'Grey 40L can', color: 'grey', tare_kg: 4.38, nominal_l: 40 },
};
const MILK_DENSITY_KG_PER_L = 1.03;

const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function parseJsonArray(s) {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

function chickenCutForLine(line) {
  const explicit = norm(line.cut || line.chicken_cut || line.kind || '');
  if (CHICKEN_CUTS.includes(explicit)) return explicit;
  const n = norm([line.item_key, line.sku, line.item, line.name, line.label, line.matched].filter(Boolean).join(' '));
  if (!n) return null;
  if (/\bboneless\b/.test(n)) return 'boneless';
  if (/\b(shawarma|shawarama)\b/.test(n)) return 'shawarma';
  if (/\b(kebab|kabab)\b/.test(n)) return 'kebab';
  if (/\b(tandoori|biryani\s*cut)\b/.test(n)) return 'tandoori';
  if (/\bgrill\b/.test(n)) return 'grill';
  if (/\b(tangdi|drumstick|kalmi)\b/.test(n)) return 'tangdi';
  if (/\b(lollipop|wings?)\b/.test(n)) return 'lollipop';
  return null;
}

function legacyMovementKeyFor(purchaseId, lineIdx) {
  return `sauda_purchase:${purchaseId}:${lineIdx}:receipt`;
}

function movementKeyFor(purchaseId, lineIdx, partNo = 1) {
  return `sauda_purchase:${purchaseId}:${lineIdx}:receipt:${partNo}`;
}

function movementPrefixFor(purchaseId, lineIdx) {
  return `sauda_purchase:${purchaseId}:${lineIdx}:receipt`;
}

function lineOrderMode(line, cut) {
  const unit = norm(line.unit || line.uom || line.ordered_unit || '');
  if (unit === 'kg' || unit === 'kgs' || unit === 'kilogram' || unit === 'kilograms') return 'kg';
  return KG_ORDERED_CHICKEN_CUTS.includes(cut) ? 'kg' : 'pieces';
}

function orderedAmount(line) {
  return toNum(line.qty ?? line.count ?? line.ordered_qty ?? line.ordered_count) || 0;
}

function parseReceiptPartNo(key) {
  const m = String(key || '').match(/:receipt:(\d+)$/);
  return m ? Number(m[1]) : 1;
}

function dailyRatePaiseFrom(body, fallback) {
  const paise = toNum(body.daily_rate_paise);
  if (paise > 0) return Math.round(paise);
  const rupees = toNum(body.daily_rate);
  if (rupees > 0) return Math.round(rupees * 100);
  return fallback > 0 ? Math.round(fallback) : null;
}

function normaliseReceiptPart(part) {
  if (!part || typeof part !== 'object') return null;
  const yieldedKg = toNum(part.yielded_kg ?? part.purchased_kg ?? part.received_qty);
  const deliveredKg = toNum(part.delivered_kg);
  const partNo = Number(part.part_no || parseReceiptPartNo(part.movement_key) || 1);
  if (!(yieldedKg > 0) || !(deliveredKg > 0)) return null;
  return {
    part_no: partNo,
    movement_key: part.movement_key || '',
    anbar_receipt_id: part.anbar_receipt_id || null,
    received_at: part.received_at || '',
    received_by: part.received_by || '',
    received_pieces: toNum(part.received_pieces),
    yielded_kg: round2(yieldedKg),
    purchased_kg: round2(yieldedKg),
    delivered_kg: round2(deliveredKg),
    daily_rate_paise: toNum(part.daily_rate_paise),
    cost_paise: toNum(part.cost_paise),
    effective_usable_price_paise: toNum(part.effective_usable_price_paise),
    evidence_key: part.evidence_key || '',
    evidence_mime: part.evidence_mime || '',
    evidence_url: part.evidence_url || (part.evidence_key ? `/api/anbar?action=evidence&key=${encodeURIComponent(part.evidence_key)}` : ''),
  };
}

function receiptPartsFromLine(line) {
  const parts = Array.isArray(line.receipt_parts) ? line.receipt_parts : [];
  const out = parts.map(normaliseReceiptPart).filter(Boolean);
  const legacy = normaliseReceiptPart(line.receipt);
  if (legacy && !out.some(p => p.movement_key && p.movement_key === legacy.movement_key)) out.push(legacy);
  return out.sort((a, b) => (a.part_no || 0) - (b.part_no || 0));
}

function summariseReceiptParts(parts, ordered, mode) {
  const receivedPieces = round2(parts.reduce((sum, p) => sum + (toNum(p.received_pieces) || 0), 0));
  const yieldedKg = round2(parts.reduce((sum, p) => sum + (toNum(p.yielded_kg) || 0), 0));
  const deliveredKg = round2(parts.reduce((sum, p) => sum + (toNum(p.delivered_kg) || 0), 0));
  const complete = mode === 'pieces'
    ? ordered > 0 && receivedPieces >= ordered
    : ordered > 0 ? yieldedKg + 0.001 >= ordered : yieldedKg > 0;
  const partial = parts.length > 0 && !complete;
  return {
    part_count: parts.length,
    received_pieces: receivedPieces,
    yielded_kg: yieldedKg,
    purchased_kg: yieldedKg,
    delivered_kg: deliveredKg,
    remaining_pieces: mode === 'pieces' && ordered > 0 ? Math.max(0, round2(ordered - receivedPieces)) : null,
    remaining_kg: mode === 'kg' && ordered > 0 ? Math.max(0, round2(ordered - yieldedKg)) : null,
    complete,
    partial,
    next_part_no: (parts.reduce((m, p) => Math.max(m, Number(p.part_no || 0)), 0) || 0) + 1,
  };
}

function receiveKindParam(value) {
  const k = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!k || k === 'all') return 'all';
  const hit = NCH_RECEIVE_DEFS.find(d => d.kind === k || d.aliases.includes(k));
  return hit ? hit.kind : k;
}

function receiveTextForLine(line) {
  return norm([line.item_key, line.sku, line.item, line.name, line.label, line.matched].filter(Boolean).join(' '));
}

function nchReceiveDefForLine(line, vendorName, requestedKind = 'all') {
  const k = receiveKindParam(requestedKind);
  const text = receiveTextForLine(line);
  return NCH_RECEIVE_DEFS.find(d => {
    if (k !== 'all' && d.kind !== k) return false;
    if (d.kind === 'milk' && /\b(powder|milkmaid|condensed|skimmed|smp)\b/.test(text)) return false;
    return d.lineRe.test(text) || (!text && d.vendorRe.test(vendorName || ''));
  }) || null;
}

function brandKey(v) {
  return String(v || '').trim().toUpperCase();
}

function saudaBrandMatches(poBrand, line, brand) {
  const target = brandKey(brand);
  const p = brandKey(poBrand);
  const l = brandKey(line?.brand);
  const poOk = !p || p === target || p === 'BOTH';
  const lineOk = !l || l === target || l === 'BOTH';
  return poOk && lineOk;
}

function genericItemName(line) {
  return String(line?.item || line?.name || line?.label || line?.sku || line?.item_key || 'Sauda item').trim();
}

function genericItemUnit(line) {
  return String(line?.unit || line?.uom || line?.ordered_unit || '').trim() || 'unit';
}

function genericItemCode(line, purchaseId, lineIdx) {
  const raw = String(line?.item_code || line?.sku || line?.item_key || line?.item || `sauda-${purchaseId}-${lineIdx}`).trim();
  const safe = raw.toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
  return safe || `SAUDA_${purchaseId}_${lineIdx}`;
}

function wholeNumberReceiptRequired(def) {
  if (def?.kind === 'buns') return true;
  const u = norm(def?.uom || '');
  return /\b(pc|pcs|piece|pieces|bird|birds|case|packet|bundle|bottle|box|bag|bora|cylinder|can)\b/.test(u);
}

function universalReceiveDefForLine(line, vendorName, brand, requestedKind = 'all', purchaseId = 0, lineIdx = 0) {
  const k = receiveKindParam(requestedKind);
  if (brand === 'HE' && MN_BROILERS_RE.test(vendorName || '') && chickenCutForLine(line)) return null;

  const special = brand === 'NCH' ? nchReceiveDefForLine(line, vendorName, 'all') : null;
  if (special) return (k === 'all' || k === special.kind) ? special : null;
  if (k !== 'all' && k !== 'generic' && k !== 'sauda') return null;

  const name = genericItemName(line);
  const ordered = orderedAmount(line);
  if (!name && !(ordered > 0)) return null;
  return {
    kind: 'generic',
    code: genericItemCode(line, purchaseId, lineIdx),
    name,
    uom: genericItemUnit(line),
    loc: 'store',
  };
}

function normaliseGenericReceiptPart(part) {
  if (!part || typeof part !== 'object') return null;
  const qty = toNum(part.received_qty ?? part.qty ?? part.litres_received);
  const partNo = Number(part.part_no || parseReceiptPartNo(part.movement_key) || 1);
  if (!(qty > 0)) return null;
  return {
    kind: part.kind || '',
    slot: part.slot || '',
    part_no: partNo,
    movement_key: part.movement_key || '',
    anbar_receipt_id: part.anbar_receipt_id || null,
    received_at: part.received_at || '',
    received_by: part.received_by || '',
    received_qty: round2(qty),
    received_unit: part.received_unit || part.uom || '',
    price_paise: toNum(part.price_paise),
    cost_paise: toNum(part.cost_paise),
    can_id: part.can_id || '',
    gross_kg: toNum(part.gross_kg),
    tare_kg: toNum(part.tare_kg),
    density_kg_per_l: toNum(part.density_kg_per_l),
    evidence_key: part.evidence_key || '',
    evidence_mime: part.evidence_mime || '',
    evidence_url: part.evidence_url || (part.evidence_key ? `/api/anbar?action=evidence&key=${encodeURIComponent(part.evidence_key)}` : ''),
  };
}

function genericReceiptPartsFromLine(line, kind) {
  const parts = Array.isArray(line.receipt_parts) ? line.receipt_parts : [];
  const out = parts
    .map(normaliseGenericReceiptPart)
    .filter(p => p && (!kind || !p.kind || p.kind === kind));
  const legacy = normaliseGenericReceiptPart(line.receipt);
  if (legacy && (!kind || !legacy.kind || legacy.kind === kind) && !out.some(p => p.movement_key && p.movement_key === legacy.movement_key)) out.push(legacy);
  return out.sort((a, b) => (a.part_no || 0) - (b.part_no || 0));
}

function summariseGenericReceiptParts(parts, ordered) {
  const qty = round2(parts.reduce((sum, p) => sum + (toNum(p.received_qty) || 0), 0));
  const costPaise = Math.round(parts.reduce((sum, p) => sum + (toNum(p.cost_paise) || 0), 0));
  const complete = ordered > 0 ? qty + 0.001 >= ordered : qty > 0;
  return {
    part_count: parts.length,
    received_qty: qty,
    cost_paise: costPaise,
    remaining_qty: ordered > 0 ? Math.max(0, round2(ordered - qty)) : null,
    complete,
    partial: parts.length > 0 && !complete,
    next_part_no: (parts.reduce((m, p) => Math.max(m, Number(p.part_no || 0)), 0) || 0) + 1,
  };
}

function linePricePaise(line) {
  return Math.max(0, Math.round(toNum(line && line.price_paise) || 0));
}

async function ensureAnbarSchema(DB) {
  await DB.prepare(
    `CREATE TABLE IF NOT EXISTS rm_outlet_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT NOT NULL,
      loc TEXT,
      item_code TEXT,
      item_name TEXT,
      qty REAL,
      uom TEXT,
      received_at TEXT,
      received_by TEXT,
      source TEXT,
      notes TEXT,
      movement_key TEXT,
      evidence_key TEXT,
      evidence_mime TEXT
    )`
  ).run();
  const alters = [
    `ALTER TABLE rm_outlet_receipts ADD COLUMN movement_key TEXT`,
    `ALTER TABLE rm_outlet_receipts ADD COLUMN evidence_key TEXT`,
    `ALTER TABLE rm_outlet_receipts ADD COLUMN evidence_mime TEXT`,
    `ALTER TABLE sauda_purchase ADD COLUMN received_at TEXT`,
    `ALTER TABLE sauda_purchase ADD COLUMN received_by TEXT`,
    `ALTER TABLE sauda_purchase ADD COLUMN received_station TEXT`,
    `ALTER TABLE sauda_purchase ADD COLUMN received_items_json TEXT`,
    `ALTER TABLE sauda_purchase ADD COLUMN receive_note TEXT`,
    `ALTER TABLE sauda_purchase ADD COLUMN has_goods INTEGER DEFAULT 0`,
  ];
  for (const sql of alters) {
    try { await DB.prepare(sql).run(); } catch (_) {}
  }
  await DB.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_rm_outlet_receipts_movement_key
     ON rm_outlet_receipts(movement_key)`
  ).run();
}

async function storeReceiptEvidence(env, { brand, date, purchaseId, lineIdx, partNo, image }) {
  if (!image) return null;
  if (!env?.EVIDENCE) return null;
  const raw = String(image);
  const m = /^data:(image\/[a-z.+-]+);base64,(.+)$/i.exec(raw);
  const mime = m ? m[1] : 'image/jpeg';
  const b64 = m ? m[2] : raw;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw new Error('weight photo invalid');
  const bytes = Uint8Array.from(atob(b64.replace(/\s+/g, '')), c => c.charCodeAt(0));
  if (bytes.byteLength > 3_000_000) throw new Error('weight photo too large');
  const key = `chicken-receipts/${brand}/${date}/sauda-${purchaseId}/line-${lineIdx}/part-${partNo}-${Date.now()}.jpg`;
  await env.EVIDENCE.put(key, bytes, { httpMetadata: { contentType: mime } });
  return { key, mime, bytes: bytes.byteLength };
}

async function storeGenericReceiptEvidence(env, { brand, kind, date, purchaseId, lineIdx, partNo, image }) {
  if (!image) return null;
  if (!env?.EVIDENCE) return null;
  const raw = String(image);
  const m = /^data:(image\/[a-z.+-]+);base64,(.+)$/i.exec(raw);
  const mime = m ? m[1] : 'image/jpeg';
  const b64 = m ? m[2] : raw;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw new Error('receipt photo invalid');
  const bytes = Uint8Array.from(atob(b64.replace(/\s+/g, '')), c => c.charCodeAt(0));
  if (bytes.byteLength > 3_000_000) throw new Error('receipt photo too large');
  const safeKind = String(kind || 'receipt').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const key = `anbar-receipts/${safeKind}/${brand}/${date}/sauda-${purchaseId}/line-${lineIdx}/part-${partNo}-${Date.now()}.jpg`;
  await env.EVIDENCE.put(key, bytes, { httpMetadata: { contentType: mime } });
  return { key, mime, bytes: bytes.byteLength };
}

async function chickenLedgerEntry(DB, brand, date, cut) {
  const row = await DB.prepare(
    `SELECT * FROM chicken_daily_ledger WHERE brand=? AND business_date=? AND cut=?`
  ).bind(brand, date, cut).first().catch(() => null);
  const rateRow = row?.daily_rate_paise
    ? row
    : await DB.prepare(
        `SELECT daily_rate_paise FROM chicken_daily_ledger
         WHERE brand=? AND business_date=? AND daily_rate_paise IS NOT NULL AND daily_rate_paise > 0
         ORDER BY updated_at DESC, id DESC LIMIT 1`
      ).bind(brand, date).first().catch(() => null);
  const deliveredKg = toNum(row?.delivered_kg);
  const yieldedKg = toNum(row?.purchased_kg);
  const dailyRatePaise = toNum(row?.daily_rate_paise || rateRow?.daily_rate_paise);
  const costPaise = deliveredKg && dailyRatePaise ? Math.round(deliveredKg * dailyRatePaise) : toNum(row?.cost_paise);
  const effectivePaise = yieldedKg && costPaise ? Math.round(costPaise / yieldedKg) : toNum(row?.price_per_kg_paise);
  return {
    row: row || null,
    delivered_kg: deliveredKg,
    yielded_kg: yieldedKg,
    purchased_kg: yieldedKg,
    daily_rate_paise: dailyRatePaise,
    cost_paise: costPaise,
    effective_usable_price_paise: effectivePaise,
    ready: deliveredKg > 0 && yieldedKg > 0 && dailyRatePaise > 0,
    source: row ? 'chicken_daily_ledger' : null,
  };
}

async function alignChickenLedger(DB, { brand, date, cut, deliveredKg, yieldedKg, dailyRatePaise, pin }) {
  const existing = await DB.prepare(
    `SELECT id, recipe_consumed_g FROM chicken_daily_ledger WHERE brand=? AND business_date=? AND cut=?`
  ).bind(brand, date, cut).first();
  const costPaise = Math.round(deliveredKg * dailyRatePaise);
  const effectivePricePaise = Math.round(costPaise / yieldedKg);
  const recipeG = existing?.recipe_consumed_g || 0;
  const variancePct = recipeG > 0
    ? Math.round(((yieldedKg * 1000 - recipeG) / recipeG) * 100 * 100) / 100
    : null;

  if (existing) {
    await DB.prepare(
      `UPDATE chicken_daily_ledger
       SET purchased_kg=?, delivered_kg=?, daily_rate_paise=?,
           price_per_kg_paise=?, cost_paise=?, variance_pct=?,
           price_entered_by_pin=COALESCE(price_entered_by_pin, ?),
           price_entered_at=COALESCE(price_entered_at, datetime('now')),
           updated_at=datetime('now')
       WHERE id=?`
    ).bind(yieldedKg, deliveredKg, dailyRatePaise, effectivePricePaise, costPaise, variancePct, pin || '', existing.id).run();
  } else {
    await DB.prepare(
      `INSERT INTO chicken_daily_ledger
        (business_date, brand, cut, purchased_kg, delivered_kg, daily_rate_paise,
         price_per_kg_paise, cost_paise, variance_pct, price_entered_by_pin, price_entered_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(date, brand, cut, yieldedKg, deliveredKg, dailyRatePaise, effectivePricePaise, costPaise, variancePct, pin || '').run();
  }

  return { cost_paise: costPaise, effective_usable_price_paise: effectivePricePaise, variance_pct: variancePct };
}

async function saudaChickenQueue(DB, url) {
  await ensureAnbarSchema(DB);
  const brand = (url.searchParams.get('brand') || 'HE').toUpperCase();
  const kind = (url.searchParams.get('kind') || '').toLowerCase();
  const date = url.searchParams.get('date') || istToday();
  if (brand !== 'HE' || kind !== 'chicken') return json({ success: true, brand, date, kind, lines: [] });
  if (!isYmd(date)) return json({ success: false, error: 'date invalid' }, 400);

  const rows = (await DB.prepare(
    `SELECT id, brand, vendor_name, for_date, status, items_json, ordered_at
     FROM sauda_purchase
     WHERE brand=? AND for_date=? AND COALESCE(status,'') != 'CANCELLED'
     ORDER BY id DESC`
  ).bind(brand, date).all()).results || [];

  const lines = [];
  let dayRatePaise = null;
  for (const po of rows) {
    if (!MN_BROILERS_RE.test(po.vendor_name || '')) continue;
    const items = parseJsonArray(po.items_json);
    for (let idx = 0; idx < items.length; idx++) {
      const line = items[idx] || {};
      const cut = chickenCutForLine(line);
      if (!cut) continue;
      const prefix = movementPrefixFor(po.id, idx);
      const movementRows = (await DB.prepare(
        `SELECT id, received_at, received_by, qty, movement_key, evidence_key, evidence_mime
         FROM rm_outlet_receipts
         WHERE movement_key=? OR movement_key LIKE ?
         ORDER BY movement_key`
      ).bind(legacyMovementKeyFor(po.id, idx), `${prefix}:%`).all()).results || [];
      const ledger = await chickenLedgerEntry(DB, brand, date, cut);
      if (!dayRatePaise && ledger.daily_rate_paise > 0) dayRatePaise = ledger.daily_rate_paise;
      const mode = lineOrderMode(line, cut);
      const ordered = orderedAmount(line);
      const parts = receiptPartsFromLine(line);
      const summary = summariseReceiptParts(parts, ordered, mode);
      const legacySaved = movementRows.length > 0 && parts.length === 0;
      const saved = summary.complete || legacySaved;
      const partial = summary.partial;
      const status = saved ? 'inventory_saved' : partial ? 'partial' : 'ordered';
      const latestPart = parts[parts.length - 1] || null;
      const latestMovement = movementRows[movementRows.length - 1] || null;
      lines.push({
        purchase_id: po.id,
        line_idx: idx,
        movement_key: movementKeyFor(po.id, idx, summary.next_part_no),
        movement_key_prefix: prefix,
        next_part_no: summary.next_part_no,
        order_status: po.status,
        vendor_name: po.vendor_name,
        for_date: po.for_date,
        brand,
        kind: 'chicken',
        cut,
        cut_label: CHICKEN_LABELS[cut],
        item_code: `HE-CHICKEN-${cut.toUpperCase()}`,
        item_name: CHICKEN_LABELS[cut],
        uom: 'kg',
        item: line.item || line.sku || line.name || CHICKEN_LABELS[cut],
        ordered_qty: line.qty ?? line.count ?? '',
        ordered_unit: line.unit || '',
        ordered_mode: mode,
        ordered_amount: ordered,
        ordered_pieces: mode === 'pieces' ? ordered : null,
        partial,
        inventory_saved: saved,
        saved_at: latestMovement?.received_at || latestPart?.received_at || null,
        saved_by: latestMovement?.received_by || latestPart?.received_by || '',
        status,
        receipt_parts: parts,
        receipt_summary: summary,
        chicken_entry: (ledger.source || ledger.daily_rate_paise) ? {
          source: ledger.source,
          delivered_kg: ledger.delivered_kg,
          yielded_kg: ledger.yielded_kg,
          purchased_kg: ledger.purchased_kg,
          daily_rate_paise: ledger.daily_rate_paise,
        } : null,
      });
    }
  }

  return json({ success: true, brand, date, kind, vendor: 'M.N. Broilers', daily_rate_paise: dayRatePaise, lines });
}

async function saveSaudaChickenReceive(DB, body, env = {}) {
  await ensureAnbarSchema(DB);
  const brand = (body.brand || 'HE').toUpperCase();
  const kind = String(body.kind || 'chicken').toLowerCase();
  if (brand !== 'HE' || kind !== 'chicken') return json({ success: false, error: 'unsupported receive kind' }, 400);

  const person = PINS[body.pin];
  if (!person) return json({ success: false, error: 'Wrong PIN' }, 401);
  const purchaseId = Number(body.purchase_id || body.id || 0);
  const lineIdx = Number(body.line_idx);
  if (!purchaseId || !Number.isInteger(lineIdx) || lineIdx < 0) {
    return json({ success: false, error: 'purchase_id + line_idx required' }, 400);
  }

  const po = await DB.prepare(
    `SELECT id, brand, vendor_name, for_date, status, items_json
     FROM sauda_purchase WHERE id=?`
  ).bind(purchaseId).first();
  if (!po) return json({ success: false, error: 'Sauda order not found' }, 404);
  if ((po.brand || '').toUpperCase() !== brand) return json({ success: false, error: 'brand mismatch' }, 400);
  if (!MN_BROILERS_RE.test(po.vendor_name || '')) return json({ success: false, error: 'not an MN Broilers order' }, 400);

  const items = parseJsonArray(po.items_json);
  const line = items[lineIdx];
  if (!line) return json({ success: false, error: 'Sauda line not found' }, 404);
  const cut = chickenCutForLine(line);
  if (!cut) return json({ success: false, error: 'chicken cut missing on Sauda line' }, 400);

  const mode = lineOrderMode(line, cut);
  const ordered = orderedAmount(line);
  const partsBefore = receiptPartsFromLine(line);
  const summaryBefore = summariseReceiptParts(partsBefore, ordered, mode);
  const requestedPartNo = Number(body.receipt_part_no || body.part_no || summaryBefore.next_part_no);
  if (!Number.isInteger(requestedPartNo) || requestedPartNo < 1) {
    return json({ success: false, error: 'receipt part invalid' }, 400);
  }
  const movementKey = movementKeyFor(purchaseId, lineIdx, requestedPartNo);
  let receipt = await DB.prepare(
    `SELECT id, received_at, received_by, qty, evidence_key, evidence_mime FROM rm_outlet_receipts WHERE movement_key=? LIMIT 1`
  ).bind(movementKey).first();
  const receiptExisted = !!receipt;

  const ledger = await chickenLedgerEntry(DB, brand, po.for_date, cut);
  const dailyRatePaise = dailyRatePaiseFrom(body, ledger.daily_rate_paise);
  if (!(dailyRatePaise > 0)) {
    return json({ success: false, error: 'Today live rate required' }, 409);
  }

  const deliveredKg = round2(toNum(body.delivered_kg));
  const yieldedKg = round2(toNum(body.yielded_kg ?? body.purchased_kg ?? body.received_qty));
  if (!(deliveredKg > 0) || !(yieldedKg > 0)) {
    return json({ success: false, error: 'usable kg and live kg required' }, 400);
  }

  let receivedPieces = null;
  if (mode === 'pieces') {
    receivedPieces = toNum(body.received_pieces ?? body.pieces);
    if (!(receivedPieces > 0) || Math.round(receivedPieces) !== receivedPieces) {
      return json({ success: false, error: 'received pieces required' }, 400);
    }
    const partsExcludingThis = partsBefore.filter(p => Number(p.part_no) !== requestedPartNo);
    const baseSummary = summariseReceiptParts(partsExcludingThis, ordered, mode);
    if (ordered > 0 && receivedPieces > (baseSummary.remaining_pieces + 0.001)) {
      return json({ success: false, error: `only ${baseSummary.remaining_pieces} pieces pending` }, 400);
    }
  }

  const itemCode = `HE-CHICKEN-${cut.toUpperCase()}`;
  const itemName = CHICKEN_LABELS[cut];
  const partCostPaise = Math.round(deliveredKg * dailyRatePaise);
  const partEffectivePaise = Math.round(partCostPaise / yieldedKg);
  const now = new Date().toISOString();
  const note = `Sauda #${purchaseId} line ${lineIdx + 1} · MN Broilers · ${cut} · part ${requestedPartNo}${receivedPieces ? ` · ${receivedPieces} pieces` : ''} · live ${deliveredKg} kg · usable ${yieldedKg} kg`;
  const evidence = (!receipt || !receipt.evidence_key)
    ? await storeReceiptEvidence(env, { brand, date: po.for_date, purchaseId, lineIdx, partNo: requestedPartNo, image: body.evidence_image || body.weight_photo || body.image })
    : null;
  if (!receipt) {
    await DB.prepare(
      `INSERT OR IGNORE INTO rm_outlet_receipts
        (brand, loc, item_code, item_name, qty, uom, received_at, received_by, source, notes, movement_key, evidence_key, evidence_mime)
       VALUES (?, 'kitchen', ?, ?, ?, 'kg', ?, ?, 'sauda', ?, ?, ?, ?)`
    ).bind(brand, itemCode, itemName, yieldedKg, now, person, note, movementKey, evidence?.key || null, evidence?.mime || null).run();
    receipt = await DB.prepare(
      `SELECT id, received_at, received_by, qty, evidence_key, evidence_mime FROM rm_outlet_receipts WHERE movement_key=? LIMIT 1`
    ).bind(movementKey).first();
  } else if (evidence?.key) {
    await DB.prepare(
      `UPDATE rm_outlet_receipts SET evidence_key=?, evidence_mime=? WHERE movement_key=? AND COALESCE(evidence_key,'')=''`
    ).bind(evidence.key, evidence.mime, movementKey).run();
    receipt = await DB.prepare(
      `SELECT id, received_at, received_by, qty, evidence_key, evidence_mime FROM rm_outlet_receipts WHERE movement_key=? LIMIT 1`
    ).bind(movementKey).first();
  }

  const receiptAt = receipt?.received_at || new Date().toISOString();
  const currentPart = {
    kind: 'chicken',
    part_no: requestedPartNo,
    movement_key: movementKey,
    anbar_receipt_id: receipt?.id || null,
    received_at: receiptAt,
    received_by: receipt?.received_by || person,
    received_pieces: receivedPieces,
    delivered_kg: deliveredKg,
    yielded_kg: yieldedKg,
    purchased_kg: yieldedKg,
    daily_rate_paise: dailyRatePaise,
    cost_paise: partCostPaise,
    effective_usable_price_paise: partEffectivePaise,
    evidence_key: receipt?.evidence_key || evidence?.key || '',
    evidence_mime: receipt?.evidence_mime || evidence?.mime || '',
    evidence_url: receipt?.evidence_key || evidence?.key ? `/api/anbar?action=evidence&key=${encodeURIComponent(receipt?.evidence_key || evidence?.key)}` : '',
  };
  const partsByNo = new Map(partsBefore.map(p => [Number(p.part_no), p]));
  partsByNo.set(requestedPartNo, { ...partsByNo.get(requestedPartNo), ...currentPart });
  const receiptParts = Array.from(partsByNo.values()).sort((a, b) => (a.part_no || 0) - (b.part_no || 0));
  const summary = summariseReceiptParts(receiptParts, ordered, mode);
  const aligned = await alignChickenLedger(DB, {
    brand,
    date: po.for_date,
    cut,
    deliveredKg: summary.delivered_kg,
    yieldedKg: summary.yielded_kg,
    dailyRatePaise,
    pin: body.pin,
  });

  const lineComplete = summary.complete;
  const receiptPayload = {
    status: lineComplete ? 'inventory_saved' : 'partial',
    kind: 'chicken',
    movement_key: movementKey,
    movement_keys: receiptParts.map(p => p.movement_key).filter(Boolean),
    latest_part_no: requestedPartNo,
    part_count: receiptParts.length,
    received_at: receiptAt,
    received_by: currentPart.received_by,
    received_pieces: mode === 'pieces' ? summary.received_pieces : null,
    ordered_pieces: mode === 'pieces' ? ordered : null,
    pending_pieces: summary.remaining_pieces,
    received_qty: summary.yielded_kg,
    received_unit: 'kg',
    delivered_kg: summary.delivered_kg,
    yielded_kg: summary.yielded_kg,
    purchased_kg: summary.yielded_kg,
    daily_rate_paise: dailyRatePaise,
    cost_paise: aligned.cost_paise,
    effective_usable_price_paise: aligned.effective_usable_price_paise,
  };
  items[lineIdx] = {
    ...line,
    receipt_status: receiptPayload.status,
    received_at: receiptPayload.received_at,
    received_by: receiptPayload.received_by,
    received_pieces: receiptPayload.received_pieces,
    received_qty: receiptPayload.received_qty,
    received_unit: receiptPayload.received_unit,
    anbar_movement_key: movementKey,
    anbar_movement_keys: receiptPayload.movement_keys,
    anbar_receipt_id: currentPart.anbar_receipt_id,
    receipt_parts: receiptParts,
    receipt: receiptPayload,
  };

  const chickenLineIndexes = items
    .map((it, idx) => chickenCutForLine(it) ? idx : -1)
    .filter(idx => idx >= 0);
  const allChickenReceived = chickenLineIndexes.length > 0 && chickenLineIndexes.every(idx => {
    const it = items[idx] || {};
    const itCut = chickenCutForLine(it);
    const itMode = lineOrderMode(it, itCut);
    const itSummary = summariseReceiptParts(receiptPartsFromLine(it), orderedAmount(it), itMode);
    return it.receipt_status === 'inventory_saved' || it.receipt?.status === 'inventory_saved' || itSummary.complete;
  });
  const receivedItems = chickenLineIndexes.map(idx => {
    const it = items[idx] || {};
    return {
      line_idx: idx,
      item: it.item || it.sku || CHICKEN_LABELS[chickenCutForLine(it)],
      cut: chickenCutForLine(it),
      receipt: it.receipt || null,
    };
  });

  await DB.prepare(
    `UPDATE sauda_purchase
     SET items_json=?,
         received_items_json=?,
         receive_note=?,
         has_goods=1,
         received_at=COALESCE(received_at, ?),
         received_by=COALESCE(received_by, ?),
         received_station=COALESCE(received_station, 'HE-K'),
         status=CASE WHEN ?=1 AND status IN ('ORDERED','QUEUED') THEN 'RECEIVED' ELSE status END,
         updated_at=datetime('now')
     WHERE id=?`
  ).bind(
    JSON.stringify(items),
    JSON.stringify(receivedItems),
    `Anbar HE chicken receipt · latest movement ${movementKey}`,
    receiptAt,
    receiptPayload.received_by,
    allChickenReceived ? 1 : 0,
    purchaseId
  ).run();

  return json({
    success: true,
    inventory_saved: lineComplete,
    partial: !lineComplete,
    idempotent: receiptExisted,
    purchase_id: purchaseId,
    line_idx: lineIdx,
    receipt_part_no: requestedPartNo,
    movement_key: movementKey,
    anbar_receipt_id: currentPart.anbar_receipt_id,
    at: receiptAt,
    by: currentPart.received_by,
    cut,
    cut_label: itemName,
    received_pieces: receiptPayload.received_pieces,
    pending_pieces: receiptPayload.pending_pieces,
    delivered_kg: summary.delivered_kg,
    yielded_kg: summary.yielded_kg,
    cost_paise: aligned.cost_paise,
    effective_usable_price_paise: aligned.effective_usable_price_paise,
    evidence_key: currentPart.evidence_key || '',
    evidence_url: currentPart.evidence_url || '',
    status: receiptPayload.status,
    order_fully_received: allChickenReceived,
  });
}

async function saudaUniversalReceiveQueue(DB, url) {
  await ensureAnbarSchema(DB);
  const brand = (url.searchParams.get('brand') || 'NCH').toUpperCase();
  const kind = receiveKindParam(url.searchParams.get('kind') || 'all');
  const date = url.searchParams.get('date') || istToday();
  if (!['NCH', 'HE'].includes(brand)) return json({ success: true, brand, date, kind, lines: [] });
  if (!isYmd(date)) return json({ success: false, error: 'date invalid' }, 400);

  const rows = (await DB.prepare(
    `SELECT id, brand, vendor_name, for_date, status, items_json, ordered_at
     FROM sauda_purchase
     WHERE for_date=? AND COALESCE(status,'') != 'CANCELLED'
       AND (brand=? OR brand='both' OR brand='BOTH' OR brand IS NULL OR brand='')
     ORDER BY id DESC`
  ).bind(date, brand).all()).results || [];

  const lines = [];
  let dayRatePaise = null;
  for (const po of rows) {
    const items = parseJsonArray(po.items_json);
    for (let idx = 0; idx < items.length; idx++) {
      const line = items[idx] || {};
      if (!saudaBrandMatches(po.brand, line, brand)) continue;

      const chickenCut = brand === 'HE' && MN_BROILERS_RE.test(po.vendor_name || '') ? chickenCutForLine(line) : null;
      const prefix = movementPrefixFor(po.id, idx);
      const movementRows = (await DB.prepare(
        `SELECT id, received_at, received_by, qty, movement_key, evidence_key, evidence_mime
         FROM rm_outlet_receipts
         WHERE movement_key=? OR movement_key LIKE ?
         ORDER BY movement_key`
      ).bind(legacyMovementKeyFor(po.id, idx), `${prefix}:%`).all()).results || [];
      if (chickenCut) {
        if (kind !== 'all' && kind !== 'chicken') continue;
        const ledger = await chickenLedgerEntry(DB, brand, date, chickenCut);
        if (!dayRatePaise && ledger.daily_rate_paise > 0) dayRatePaise = ledger.daily_rate_paise;
        const mode = lineOrderMode(line, chickenCut);
        const ordered = orderedAmount(line);
        const parts = receiptPartsFromLine(line);
        const summary = summariseReceiptParts(parts, ordered, mode);
        const legacySaved = movementRows.length > 0 && parts.length === 0;
        const saved = summary.complete || legacySaved;
        const partial = summary.partial;
        const latestPart = parts[parts.length - 1] || null;
        const latestMovement = movementRows[movementRows.length - 1] || null;
        lines.push({
          purchase_id: po.id,
          line_idx: idx,
          movement_key: movementKeyFor(po.id, idx, summary.next_part_no),
          movement_key_prefix: prefix,
          next_part_no: summary.next_part_no,
          order_status: po.status,
          vendor_name: po.vendor_name,
          for_date: po.for_date,
          brand,
          kind: 'chicken',
          cut: chickenCut,
          cut_label: CHICKEN_LABELS[chickenCut],
          item_code: `HE-CHICKEN-${chickenCut.toUpperCase()}`,
          item_name: CHICKEN_LABELS[chickenCut],
          loc: 'kitchen',
          uom: 'kg',
          item: line.item || line.sku || line.name || CHICKEN_LABELS[chickenCut],
          ordered_qty: line.qty ?? line.count ?? '',
          ordered_unit: line.unit || '',
          ordered_mode: mode,
          ordered_amount: ordered,
          ordered_pieces: mode === 'pieces' ? ordered : null,
          partial,
          inventory_saved: saved,
          saved_at: latestMovement?.received_at || latestPart?.received_at || null,
          saved_by: latestMovement?.received_by || latestPart?.received_by || '',
          status: saved ? 'inventory_saved' : partial ? 'partial' : 'ordered',
          receipt_parts: parts,
          receipt_summary: summary,
          chicken_entry: (ledger.source || ledger.daily_rate_paise) ? {
            source: ledger.source,
            delivered_kg: ledger.delivered_kg,
            yielded_kg: ledger.yielded_kg,
            purchased_kg: ledger.purchased_kg,
            daily_rate_paise: ledger.daily_rate_paise,
          } : null,
        });
        continue;
      }

      const def = universalReceiveDefForLine(line, po.vendor_name, brand, kind, po.id, idx);
      if (!def) continue;
      const ordered = orderedAmount(line);
      const parts = genericReceiptPartsFromLine(line, def.kind);
      const summary = summariseGenericReceiptParts(parts, ordered);
      const legacySaved = movementRows.length > 0 && parts.length === 0;
      const saved = summary.complete || legacySaved;
      const partial = summary.partial;
      const latestPart = parts[parts.length - 1] || null;
      const latestMovement = movementRows[movementRows.length - 1] || null;
      lines.push({
        purchase_id: po.id,
        line_idx: idx,
        movement_key: movementKeyFor(po.id, idx, summary.next_part_no),
        movement_key_prefix: prefix,
        next_part_no: summary.next_part_no,
        order_status: po.status,
        vendor_name: po.vendor_name,
        for_date: po.for_date,
        brand,
        kind: def.kind,
        item_code: def.code,
        item_name: def.name,
        loc: def.loc,
        uom: def.uom,
        item: line.item || line.sku || line.name || def.name,
        ordered_qty: line.qty ?? line.count ?? '',
        ordered_unit: line.unit || def.uom || '',
        ordered_amount: ordered,
        partial,
        inventory_saved: saved,
        saved_at: latestMovement?.received_at || latestPart?.received_at || null,
        saved_by: latestMovement?.received_by || latestPart?.received_by || '',
        status: saved ? 'inventory_saved' : partial ? 'partial' : 'ordered',
        receipt_parts: parts,
        receipt_summary: summary,
        milk_cans: def.kind === 'milk' ? Object.values(MILK_CANS) : [],
        density_kg_per_l: def.kind === 'milk' ? MILK_DENSITY_KG_PER_L : null,
      });
    }
  }

  return json({ success: true, brand, date, kind, daily_rate_paise: dayRatePaise, lines });
}

function milkLitresFromBody(body) {
  const direct = toNum(body.received_litres ?? body.litres_received ?? body.received_qty ?? body.qty);
  if (direct > 0) return { litres: round2(direct), can: null, grossKg: null, tareKg: null, density: null };
  const grossKg = round2(toNum(body.gross_kg));
  if (!(grossKg > 0)) return { litres: null };
  const canId = String(body.can_id || '').trim().toUpperCase();
  const can = MILK_CANS[canId] || null;
  const tareKg = round2(toNum(body.tare_kg) || can?.tare_kg || 0);
  const density = toNum(body.density_kg_per_l) || MILK_DENSITY_KG_PER_L;
  if (!(tareKg > 0) || !(density > 0)) return { litres: null };
  const litres = round2((grossKg - tareKg) / density);
  return { litres, can, grossKg, tareKg, density };
}

async function saveSaudaUniversalReceive(DB, body, env = {}) {
  await ensureAnbarSchema(DB);
  const brand = (body.brand || 'NCH').toUpperCase();
  if (!['NCH', 'HE'].includes(brand)) return json({ success: false, error: 'unsupported receive brand' }, 400);

  const person = PINS[body.pin];
  if (!person) return json({ success: false, error: 'Wrong PIN' }, 401);
  const purchaseId = Number(body.purchase_id || body.id || 0);
  const lineIdx = Number(body.line_idx);
  if (!purchaseId || !Number.isInteger(lineIdx) || lineIdx < 0) {
    return json({ success: false, error: 'purchase_id + line_idx required' }, 400);
  }

  const po = await DB.prepare(
    `SELECT id, brand, vendor_name, for_date, status, items_json
     FROM sauda_purchase WHERE id=?`
  ).bind(purchaseId).first();
  if (!po) return json({ success: false, error: 'Sauda order not found' }, 404);

  const items = parseJsonArray(po.items_json);
  const line = items[lineIdx];
  if (!line) return json({ success: false, error: 'Sauda line not found' }, 404);
  if (!saudaBrandMatches(po.brand, line, brand)) return json({ success: false, error: 'brand mismatch' }, 400);
  if (brand === 'HE' && MN_BROILERS_RE.test(po.vendor_name || '') && chickenCutForLine(line)) {
    return json({ success: false, error: 'use MN Chicken receiving for this line' }, 400);
  }
  const requestedKind = receiveKindParam(body.kind || 'all');
  const def = universalReceiveDefForLine(line, po.vendor_name, brand, requestedKind, purchaseId, lineIdx);
  if (!def) return json({ success: false, error: 'line is not a supported Anbar receive item' }, 400);

  const ordered = orderedAmount(line);
  const partsBefore = genericReceiptPartsFromLine(line, def.kind);
  const summaryBefore = summariseGenericReceiptParts(partsBefore, ordered);
  const requestedPartNo = Number(body.receipt_part_no || body.part_no || summaryBefore.next_part_no);
  if (!Number.isInteger(requestedPartNo) || requestedPartNo < 1) {
    return json({ success: false, error: 'receipt part invalid' }, 400);
  }
  const movementKey = movementKeyFor(purchaseId, lineIdx, requestedPartNo);
  let receipt = await DB.prepare(
    `SELECT id, received_at, received_by, qty, evidence_key, evidence_mime FROM rm_outlet_receipts WHERE movement_key=? LIMIT 1`
  ).bind(movementKey).first();
  const receiptExisted = !!receipt;

  let qty = null, slot = '', can = null, grossKg = null, tareKg = null, density = null;
  if (def.kind === 'milk') {
    slot = String(body.slot || '').toUpperCase();
    if (!['AM', 'PM', 'ADHOC'].includes(slot)) return json({ success: false, error: 'milk slot must be AM/PM/ADHOC' }, 400);
    const calc = milkLitresFromBody(body);
    qty = calc.litres;
    can = calc.can;
    grossKg = calc.grossKg;
    tareKg = calc.tareKg;
    density = calc.density;
    if (!(qty > 0)) return json({ success: false, error: 'milk litres or gross kg required' }, 400);
  } else {
    qty = round2(toNum(body.received_qty ?? body.qty ?? body.count));
    if (!(qty > 0)) return json({ success: false, error: 'received quantity required' }, 400);
    if (wholeNumberReceiptRequired(def) && Math.round(qty) !== qty) return json({ success: false, error: `${def.name} must be whole numbers` }, 400);
  }

  const pricePaise = linePricePaise(line);
  const costPaise = pricePaise > 0 ? Math.round(qty * pricePaise) : 0;
  const now = new Date().toISOString();
  const note = `Sauda #${purchaseId} line ${lineIdx + 1} · ${def.name} · part ${requestedPartNo}${slot ? ` · ${slot}` : ''} · received ${qty} ${def.uom}`;
  const evidence = (!receipt || !receipt.evidence_key)
    ? await storeGenericReceiptEvidence(env, { brand, kind: def.kind, date: po.for_date, purchaseId, lineIdx, partNo: requestedPartNo, image: body.evidence_image || body.photo || body.image })
    : null;

  if (!receipt) {
    await DB.prepare(
      `INSERT OR IGNORE INTO rm_outlet_receipts
        (brand, loc, item_code, item_name, qty, uom, received_at, received_by, source, notes, movement_key, evidence_key, evidence_mime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sauda', ?, ?, ?, ?)`
    ).bind(brand, def.loc, def.code, def.name, qty, def.uom, now, person, note, movementKey, evidence?.key || null, evidence?.mime || null).run();
    receipt = await DB.prepare(
      `SELECT id, received_at, received_by, qty, evidence_key, evidence_mime FROM rm_outlet_receipts WHERE movement_key=? LIMIT 1`
    ).bind(movementKey).first();
  } else if (evidence?.key) {
    await DB.prepare(
      `UPDATE rm_outlet_receipts SET evidence_key=?, evidence_mime=? WHERE movement_key=? AND COALESCE(evidence_key,'')=''`
    ).bind(evidence.key, evidence.mime, movementKey).run();
    receipt = await DB.prepare(
      `SELECT id, received_at, received_by, qty, evidence_key, evidence_mime FROM rm_outlet_receipts WHERE movement_key=? LIMIT 1`
    ).bind(movementKey).first();
  }

  const receiptAt = receipt?.received_at || now;
  const existingPart = receiptExisted ? partsBefore.find(p => Number(p.part_no) === requestedPartNo) : null;
  const currentPart = existingPart ? {
    ...existingPart,
    anbar_receipt_id: existingPart.anbar_receipt_id || receipt?.id || null,
    evidence_key: existingPart.evidence_key || receipt?.evidence_key || evidence?.key || '',
    evidence_mime: existingPart.evidence_mime || receipt?.evidence_mime || evidence?.mime || '',
    evidence_url: existingPart.evidence_url || (receipt?.evidence_key || evidence?.key ? `/api/anbar?action=evidence&key=${encodeURIComponent(receipt?.evidence_key || evidence?.key)}` : ''),
  } : {
    kind: def.kind,
    slot,
    part_no: requestedPartNo,
    movement_key: movementKey,
    anbar_receipt_id: receipt?.id || null,
    received_at: receiptAt,
    received_by: receipt?.received_by || person,
    received_qty: qty,
    received_unit: def.uom,
    price_paise: pricePaise,
    cost_paise: costPaise,
    can_id: can?.can_id || String(body.can_id || ''),
    gross_kg: grossKg,
    tare_kg: tareKg,
    density_kg_per_l: density,
    evidence_key: receipt?.evidence_key || evidence?.key || '',
    evidence_mime: receipt?.evidence_mime || evidence?.mime || '',
    evidence_url: receipt?.evidence_key || evidence?.key ? `/api/anbar?action=evidence&key=${encodeURIComponent(receipt?.evidence_key || evidence?.key)}` : '',
  };
  const partsByNo = new Map(partsBefore.map(p => [Number(p.part_no), p]));
  partsByNo.set(requestedPartNo, { ...partsByNo.get(requestedPartNo), ...currentPart });
  const receiptParts = Array.from(partsByNo.values()).sort((a, b) => (a.part_no || 0) - (b.part_no || 0));
  const summary = summariseGenericReceiptParts(receiptParts, ordered);
  const lineComplete = summary.complete;
  const receiptPayload = {
    status: lineComplete ? 'inventory_saved' : 'partial',
    kind: def.kind,
    movement_key: movementKey,
    movement_keys: receiptParts.map(p => p.movement_key).filter(Boolean),
    latest_part_no: requestedPartNo,
    part_count: receiptParts.length,
    received_at: receiptAt,
    received_by: currentPart.received_by,
    received_qty: summary.received_qty,
    received_unit: def.uom,
    ordered_qty: ordered,
    pending_qty: summary.remaining_qty,
    cost_paise: summary.cost_paise,
    price_paise: pricePaise,
  };
  items[lineIdx] = {
    ...line,
    receipt_status: receiptPayload.status,
    received_at: receiptPayload.received_at,
    received_by: receiptPayload.received_by,
    received_qty: receiptPayload.received_qty,
    received_unit: receiptPayload.received_unit,
    anbar_movement_key: movementKey,
    anbar_movement_keys: receiptPayload.movement_keys,
    anbar_receipt_id: currentPart.anbar_receipt_id,
    receipt_parts: receiptParts,
    receipt: receiptPayload,
  };

  const receiveLineIndexes = items
    .map((it, idx) => saudaBrandMatches(po.brand, it, brand) && universalReceiveDefForLine(it, po.vendor_name, brand, 'all', purchaseId, idx) ? idx : -1)
    .filter(idx => idx >= 0);
  const allReceived = receiveLineIndexes.length > 0 && receiveLineIndexes.every(idx => {
    const it = items[idx] || {};
    const itDef = universalReceiveDefForLine(it, po.vendor_name, brand, 'all', purchaseId, idx);
    const itSummary = summariseGenericReceiptParts(genericReceiptPartsFromLine(it, itDef?.kind), orderedAmount(it));
    return it.receipt_status === 'inventory_saved' || it.receipt?.status === 'inventory_saved' || itSummary.complete;
  });
  const receivedItems = receiveLineIndexes.map(idx => {
    const it = items[idx] || {};
    return {
      line_idx: idx,
      item: it.item || it.sku || '',
      kind: universalReceiveDefForLine(it, po.vendor_name, brand, 'all', purchaseId, idx)?.kind || '',
      receipt: it.receipt || null,
    };
  });

  await DB.prepare(
    `UPDATE sauda_purchase
     SET items_json=?,
         received_items_json=?,
         receive_note=?,
         has_goods=1,
         received_at=COALESCE(received_at, ?),
         received_by=COALESCE(received_by, ?),
         received_station=COALESCE(received_station, ?),
         status=CASE WHEN ?=1 AND status IN ('ORDERED','QUEUED') THEN 'RECEIVED' ELSE status END,
         updated_at=datetime('now')
     WHERE id=?`
  ).bind(
    JSON.stringify(items),
    JSON.stringify(receivedItems),
    `Anbar ${brand} receipt · latest movement ${movementKey}`,
    receiptAt,
    receiptPayload.received_by,
    `${brand}-ANBAR`,
    allReceived ? 1 : 0,
    purchaseId
  ).run();

  return json({
    success: true,
    inventory_saved: lineComplete,
    partial: !lineComplete,
    idempotent: receiptExisted,
    purchase_id: purchaseId,
    line_idx: lineIdx,
    receipt_part_no: requestedPartNo,
    movement_key: movementKey,
    anbar_receipt_id: currentPart.anbar_receipt_id,
    at: receiptAt,
    by: currentPart.received_by,
    brand,
    kind: def.kind,
    item_code: def.code,
    item_name: def.name,
    received_qty: summary.received_qty,
    received_unit: def.uom,
    pending_qty: summary.remaining_qty,
    cost_paise: summary.cost_paise,
    evidence_key: currentPart.evidence_key || '',
    evidence_url: currentPart.evidence_url || '',
    status: receiptPayload.status,
    order_fully_received: allReceived,
  });
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

async function odoo(key, model, method, args, kwargs = {}) {
  const r = await fetch(ODOO_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: Date.now(), params: {
      service: 'object', method: 'execute_kw', args: [ODOO_DB, ODOO_UID, key, model, method, args, kwargs] } }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.data?.message || 'odoo error');
  return d.result;
}

// POS units sold per item since `sinceISO` (and optionally until `untilISO`).
// Resolves product.template → variant ids once per call, then sums line qty × factor.
async function soldSince(key, sinceISO, untilISO) {
  const tmplIds = ITEMS.flatMap(i => i.pos.map(p => p.tmpl));
  const variants = await odoo(key, 'product.product', 'search_read',
    [[['product_tmpl_id', 'in', tmplIds]]], { fields: ['id', 'product_tmpl_id'] });
  const factorByVariant = {};
  for (const v of variants) {
    for (const item of ITEMS) {
      const hit = item.pos.find(p => p.tmpl === v.product_tmpl_id[0]);
      if (hit) factorByVariant[v.id] = { code: item.code, f: hit.f };
    }
  }
  const domain = [
    ['order_id.config_id', 'in', POS_CONFIGS],
    ['order_id.date_order', '>=', sinceISO.replace('T', ' ').slice(0, 19)],
    ['order_id.state', 'in', ['paid', 'done', 'invoiced', 'posted']],
    ['product_id', 'in', Object.keys(factorByVariant).map(Number)],
  ];
  if (untilISO) domain.splice(2, 0, ['order_id.date_order', '<=', untilISO.replace('T', ' ').slice(0, 19)]);
  const lines = await odoo(key, 'pos.order.line', 'search_read', [domain],
    { fields: ['product_id', 'qty'], limit: 5000 });
  const sold = {};
  for (const l of lines) {
    const m = factorByVariant[l.product_id[0]];
    if (m) sold[m.code] = (sold[m.code] || 0) + l.qty * m.f;
  }
  return sold;
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(context.request.url);
  const action = url.searchParams.get('action');
  const DB = context.env.DB;
  const ODOO_KEY = context.env.ODOO_NCH_POS_KEY;

  try {
    if (action === 'sauda-receive-queue') {
      const brand = (url.searchParams.get('brand') || '').toUpperCase();
      const kind = String(url.searchParams.get('kind') || '').toLowerCase();
      if (brand === 'HE' && kind === 'chicken') return await saudaChickenQueue(DB, url);
      return await saudaUniversalReceiveQueue(DB, url);
    }

    if (action === 'sauda-receive' && context.request.method === 'POST') {
      const body = await context.request.json();
      const brand = (body.brand || '').toUpperCase();
      const kind = String(body.kind || '').toLowerCase();
      if (brand === 'HE' && kind === 'chicken') return await saveSaudaChickenReceive(DB, body, context.env);
      return await saveSaudaUniversalReceive(DB, body, context.env);
    }

    if (action === 'evidence') {
      const key = url.searchParams.get('key') || '';
      if (!key.startsWith('chicken-receipts/') && !key.startsWith('anbar-receipts/')) return json({ success: false, error: 'invalid evidence key' }, 400);
      if (!context.env.EVIDENCE) return json({ success: false, error: 'evidence bucket missing' }, 500);
      const obj = await context.env.EVIDENCE.get(key);
      if (!obj) return json({ success: false, error: 'evidence not found' }, 404);
      return new Response(obj.body, {
        headers: {
          'content-type': obj.httpMetadata?.contentType || 'image/jpeg',
          'cache-control': 'private, max-age=3600',
        },
      });
    }

    if (action === 'verify-pin') {
      const person = PINS[url.searchParams.get('pin')];
      return person ? json({ success: true, person }) : json({ success: false, error: 'Wrong PIN' });
    }

    if (action === 'items') {
      return json({ success: true, items: ITEMS.map(({ code, name, uom, locs, pack }) => ({ code, name, uom, locs, pack: pack || null })) });
    }

    // ── LIVE BOARD: per item per location — expected vs last count ──
    if (action === 'live') {
      const out = [];
      for (const item of ITEMS) out.push({ code: item.code, name: item.name, uom: item.uom, locs: item.locs, pack: item.pack || null, ccase: item.ccase || null, made_in_house: !!item.made_in_house });

      // last count per (item, outlet)
      const counts = (await DB.prepare(
        `SELECT item_code, outlet, qty, counted_at FROM rm_outlet_counts c
         WHERE id IN (SELECT MAX(id) FROM rm_outlet_counts WHERE brand='NCH' GROUP BY item_code, outlet)`
      ).all()).results || [];
      const lastCount = {};
      for (const c of counts) lastCount[`${c.item_code}|${c.outlet}`] = c;

      // earliest anchor for the Odoo query window
      const anchors = counts.map(c => c.counted_at).sort();
      const since = anchors[0] || new Date(Date.now() - 86400000).toISOString();

      let sold = {};
      let odooOk = true;
      try { sold = ODOO_KEY ? await soldSince(ODOO_KEY, since) : {}; }
      catch (e) { odooOk = false; }

      for (const item of out) {
        const cKey = `${item.code}|NCH-COUNTER`;
        const sKey = `${item.code}|NCH-STORE`;
        const cc = lastCount[cKey], sc = lastCount[sKey];

        const sums = async (table, timecol, where) =>
          (await DB.prepare(`SELECT COALESCE(SUM(qty),0) t FROM ${table} WHERE brand='NCH' AND item_code=? AND ${where} AND ${timecol} > ?`)
            .bind(item.code, cc ? cc.counted_at : '1970').first())?.t || 0;

        // counter lane (waste rows live in rm_outlet_issues with outlet='NCH-WASTE')
        if (cc) {
          const rec = await sums('rm_outlet_receipts', 'received_at', "loc='counter'");
          const iss = await sums('rm_outlet_issues', 'issued_at', "outlet='NCH-COUNTER'");
          const waste = await sums('rm_outlet_issues', 'issued_at', "outlet='NCH-WASTE'");
          // sold since THIS item's count anchor (re-windowed client-side is overkill; one query window, filter by date in SQL-less way):
          let soldQty = sold[item.code] || 0;
          if (odooOk && ODOO_KEY && cc.counted_at !== since) {
            try { const s2 = await soldSince(ODOO_KEY, cc.counted_at); soldQty = s2[item.code] || 0; } catch (e) { /* keep window value */ }
          }
          item.counter = {
            last_count: cc.qty, counted_at: cc.counted_at,
            received: rec, issued_in: iss, sold: soldQty, waste,
            expected: Math.round((cc.qty + rec + iss - waste - soldQty) * 100) / 100,
            odoo_ok: odooOk,
          };
        } else item.counter = null;

        // store lane
        if (item.locs.includes('store')) {
          if (sc) {
            const rec = (await DB.prepare(`SELECT COALESCE(SUM(qty),0) t FROM rm_outlet_receipts WHERE brand='NCH' AND item_code=? AND loc='store' AND received_at > ?`).bind(item.code, sc.counted_at).first())?.t || 0;
            const iss = (await DB.prepare(`SELECT COALESCE(SUM(qty),0) t FROM rm_outlet_issues WHERE brand='NCH' AND item_code=? AND outlet='NCH-COUNTER' AND issued_at > ?`).bind(item.code, sc.counted_at).first())?.t || 0;
            item.store = { last_count: sc.qty, counted_at: sc.counted_at, received: rec, issued_out: iss, expected: Math.round((sc.qty + rec - iss) * 100) / 100 };
          } else item.store = { last_count: null, note: 'store baseline not counted yet' };
        }
      }
      return json({ success: true, items: out, odoo_ok: odooOk });
    }

    // ── RECORD COUNT (counter or store) — returns variance against expected ──
    if (action === 'record-count' && context.request.method === 'POST') {
      const body = await context.request.json();
      const person = PINS[body.pin];
      if (!person) return json({ success: false, error: 'Wrong PIN' }, 401);
      const loc = body.loc === 'store' ? 'NCH-STORE' : 'NCH-COUNTER';
      const now = new Date().toISOString();
      const results = [];
      for (const e of (body.items || [])) {
        const item = ITEMS.find(i => i.code === e.code);
        if (!item || e.qty == null) continue;
        await DB.prepare(
          `INSERT INTO rm_outlet_counts (brand, outlet, item_code, item_name, qty, uom, counted_at, counted_by, kind, notes)
           VALUES ('NCH', ?, ?, ?, ?, ?, ?, ?, 'daily', ?)`
        ).bind(loc, item.code, item.name, e.qty, item.uom, now, person, body.notes || '').run();
        results.push({ code: item.code, qty: e.qty });
      }
      return json({ success: true, recorded: results.length, at: now, by: person, items: results });
    }

    // ── PLACE ORDER (Zoya/Bashir — creates the receive expectations) ──
    // Placement itself happens on WhatsApp; THIS is the app record that makes
    // the outlet's receive screen know what to expect on the delivery date.
    if (action === 'place-order' && context.request.method === 'POST') {
      const ORDER_PLACERS = ['Zoya', 'Bashir', 'Nihaf', 'Tanveer', 'Naveen'];
      const body = await context.request.json();
      const person = PINS[body.pin];
      if (!person || !ORDER_PLACERS.includes(person)) return json({ success: false, error: 'Not authorised to place orders' }, 401);
      const poDate = body.po_date;  // 'YYYY-MM-DD' IST delivery date
      if (!/^\d{4}-\d{2}-\d{2}$/.test(poDate || '')) return json({ success: false, error: 'po_date invalid' });
      const brand = body.brand === 'HE' ? 'HE' : 'NCH';   // both houses place here
      const now = new Date().toISOString();
      let n = 0;
      for (const l of (body.lines || [])) {
        if (!(l.qty > 0) || !l.code) continue;
        // Sauda owns the WHOLE day's PO for BOTH houses. NCH tracked items
        // canonicalize against Anbar's ITEMS (they become counter confirm
        // cards); everything else is a PO-only line.
        const item = brand === 'NCH' ? ITEMS.find(i => i.code === l.code) : null;
        const name = item ? item.name : (l.name || l.code);
        const unit = l.unit || (item ? item.uom : 'unit');
        await DB.prepare(
          `INSERT INTO rm_po_expected (brand, po_date, item_code, item_name, ordered_qty, ordered_unit, expect_note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(brand, poDate, l.code, name, l.qty, unit, `placed by ${person}${l.note ? ' · ' + l.note : ''}`, now).run();
        n++;
      }
      return json({ success: true, placed: n, po_date: poDate, brand, by: person, at: now });
    }

    // ── CANCEL ORDER LINE (Zoya/Bashir own the order — wrong lines die honestly) ──
    // Cancelled lines keep their row (audit), vanish from the receive screen.
    if (action === 'cancel-line' && context.request.method === 'POST') {
      const ORDER_PLACERS = ['Zoya', 'Bashir', 'Nihaf', 'Tanveer', 'Naveen'];
      const body = await context.request.json();
      const person = PINS[body.pin];
      if (!person || !ORDER_PLACERS.includes(person)) return json({ success: false, error: 'Not authorised' }, 401);
      const r = await DB.prepare(
        `UPDATE rm_po_expected SET status='cancelled', expect_note = expect_note || ' · CANCELLED by ' || ? || ' ' || ? WHERE id=? AND status='pending'`
      ).bind(person, new Date().toISOString(), body.id).run();
      return json({ success: true, cancelled: r.meta.changes > 0 });
    }

    // ── ORDERS for a date (order page shows what's already placed) ──
    if (action === 'orders') {
      const date = url.searchParams.get('date');
      const brand = url.searchParams.get('brand') === 'HE' ? 'HE' : 'NCH';
      const rows = (await DB.prepare(
        `SELECT * FROM rm_po_expected WHERE brand=? AND po_date=? ORDER BY id`
      ).bind(brand, date).all()).results || [];
      return json({ success: true, po_date: date, brand, lines: rows });
    }

    // ── EXPECTED TODAY (counter receive confirms TRACKED items only — the
    // full PO lives in Sauda; milk/LPG/etc never clutter the counter door) ──
    if (action === 'expected') {
      const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST date
      const tracked = ITEMS.map(i => i.code);
      const rows = ((await DB.prepare(
        `SELECT * FROM rm_po_expected WHERE brand='NCH' AND po_date=? ORDER BY id`
      ).bind(today).all()).results || []).filter(r => tracked.includes(r.item_code));
      return json({ success: true, po_date: today, expected: rows });
    }

    // ── RECORD RECEIPT (delivery arrives — counter fresh items, or store bulk) ──
    // The receive timestamp IS the inventory-add moment. If expected_id is sent,
    // the receiver is confirming a PO line — it gets marked received and linked.
    if (action === 'record-receipt' && context.request.method === 'POST') {
      const body = await context.request.json();
      const person = PINS[body.pin];
      if (!person) return json({ success: false, error: 'Wrong PIN' }, 401);
      const item = ITEMS.find(i => i.code === body.code);
      if (!item || !(body.qty > 0)) return json({ success: false, error: 'item/qty invalid' });
      const loc = body.loc === 'store' ? 'store' : 'counter';
      // Case-unit receive: deliveries arrive in boxes/cases — server multiplies.
      let pieces = body.qty, note = body.notes || '';
      if (item.ccase && body.unit === 'case') {
        pieces = body.qty * item.ccase.size;
        note = `${body.qty} ${item.ccase.name}(es) × ${item.ccase.size} = ${pieces} ${item.uom}s. ${note}`.trim();
      }
      // Made-in-house: the kitchen batch counted as it moves to the counter.
      const source = item.made_in_house ? 'kitchen' : 'vendor';
      const now = new Date().toISOString();
      const r = await DB.prepare(
        `INSERT INTO rm_outlet_receipts (brand, loc, item_code, item_name, qty, uom, received_at, received_by, source, notes)
         VALUES ('NCH', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(loc, item.code, item.name, pieces, item.uom, now, person, source, note).run();
      body.qty = pieces;
      if (body.expected_id) {
        await DB.prepare(
          `UPDATE rm_po_expected SET status='received', received_receipt_id=? WHERE id=? AND status='pending'`
        ).bind(r.meta.last_row_id, body.expected_id).run();
      }
      return json({ success: true, at: now, by: person, code: item.code, qty: body.qty, loc });
    }

    // ── RECORD ISSUE (store room → counter; Bashir's action) ──
    if (action === 'record-issue' && context.request.method === 'POST') {
      const body = await context.request.json();
      const person = PINS[body.pin];
      if (!person) return json({ success: false, error: 'Wrong PIN' }, 401);
      const item = ITEMS.find(i => i.code === body.code);
      if (!item || !(body.qty > 0)) return json({ success: false, error: 'item/qty invalid' });
      // Pack-unit issue: server does the multiplication — humans never convert.
      let pieces = body.qty, note = body.notes || '';
      if (item.pack && body.unit === 'pack') {
        pieces = body.qty * item.pack.size;
        note = `${body.qty} ${item.pack.name}(s) × ${item.pack.size} = ${pieces} ${item.uom}s. ${note}`.trim();
      }
      const now = new Date().toISOString();
      await DB.prepare(
        `INSERT INTO rm_outlet_issues (brand, outlet, item_code, item_name, qty, uom, issued_at, issued_by, notes)
         VALUES ('NCH', 'NCH-COUNTER', ?, ?, ?, ?, ?, ?, ?)`
      ).bind(item.code, item.name, pieces, item.uom, now, person, note).run();
      return json({ success: true, at: now, by: person, code: item.code, qty: pieces, packs: item.pack && body.unit === 'pack' ? body.qty : null });
    }

    // ── RECORD WASTE (counter → bin, with reason) ──
    // Waste without a record is where theft hides ("it was waste, promise").
    // A recorded waste event separates spoilage from seepage permanently.
    if (action === 'record-waste' && context.request.method === 'POST') {
      const body = await context.request.json();
      const person = PINS[body.pin];
      if (!person) return json({ success: false, error: 'Wrong PIN' }, 401);
      const item = ITEMS.find(i => i.code === body.code);
      if (!item || !(body.qty > 0)) return json({ success: false, error: 'item/qty invalid' });
      const now = new Date().toISOString();
      await DB.prepare(
        `INSERT INTO rm_outlet_issues (brand, outlet, item_code, item_name, qty, uom, issued_at, issued_by, notes)
         VALUES ('NCH', 'NCH-WASTE', ?, ?, ?, ?, ?, ?, ?)`
      ).bind(item.code, item.name, body.qty, item.uom, now, person, `WASTE: ${body.reason || 'no reason given'}`).run();
      return json({ success: true, at: now, by: person, code: item.code, qty: body.qty });
    }

    // ── HISTORY (audit trail per item) ──
    if (action === 'history') {
      const code = url.searchParams.get('code');
      const limit = parseInt(url.searchParams.get('limit') || '30');
      const rows = (await DB.prepare(
        `SELECT 'count' k, outlet loc, qty, counted_at at, counted_by who, kind, notes FROM rm_outlet_counts WHERE brand='NCH' AND item_code=?
         UNION ALL SELECT 'receipt', loc, qty, received_at, received_by, source, notes FROM rm_outlet_receipts WHERE brand='NCH' AND item_code=?
         UNION ALL SELECT 'issue', outlet, qty, issued_at, issued_by, '', notes FROM rm_outlet_issues WHERE brand='NCH' AND item_code=?
         ORDER BY at DESC LIMIT ?`
      ).bind(code, code, code, limit).all()).results || [];
      return json({ success: true, code, events: rows });
    }

    return json({ success: false, error: 'unknown action' }, 400);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}
