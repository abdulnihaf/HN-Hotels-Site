/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HN Hotels — Raw Materials Admin API
 * Route:  /api/rm-admin
 * D1:     DB (hn-hiring)
 * Secret: ODOO_API_KEY
 *
 * GET  ?action=products|vendors|mappings|status|...
 * POST {action, pin, ...}  — PIN-gated writes + Odoo sync
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ODOO_URL  = 'https://ops.hamzahotel.com/jsonrpc';
const ODOO_DB   = 'main';
const ODOO_USER = 'yash@gmail.com';

// Master Data attribute IDs (created in Phase 1 — seeded in Odoo)
const CAT_GOODS_ROOT = 1;   // product.category "Goods"
const ATTR_BRAND     = 9;   // product.attribute "Brand"       — 40 values pre-seeded
const ATTR_PACK      = 21;  // product.attribute "Pack Size"   — 17 canonical values
const ATTR_GRADE     = 22;  // product.attribute "Grade"       — context-driven, starts empty

const PINS = {
  '0305': { name: 'Nihaf', role: 'admin' },
  '2026': { name: 'Zoya',  role: 'read'  },
};

const BRAND_COMPANY = { HE: 1, NCH: 10, BOTH: false };

const UOM_FALLBACK = {
  kg: 'kg', g: 'g', L: 'L', ml: 'ml',
  pcs: 'Units', Units: 'Units',
  bundle: 'Units', cylinder: 'Units', load: 'Units', pkt: 'Units',
};

const MAX_RUNTIME_MS = 25000;

/* ━━━ Helpers ━━━ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function checkPin(pin, requireAdmin = false) {
  const u = PINS[pin];
  if (!u) return null;
  if (requireAdmin && u.role !== 'admin') return null;
  return u;
}

/* ━━━ Odoo JSON-RPC ━━━ */

let _uid = null;

async function rpc(service, method, args) {
  const r = await fetch(ODOO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call',
      params: { service, method, args },
    }),
  });
  const d = await r.json();
  if (d.error) {
    const msg = d.error.data?.message || d.error.message || JSON.stringify(d.error);
    throw new Error(`Odoo: ${msg}`);
  }
  return d.result;
}

async function odooAuth(apiKey) {
  if (_uid) return _uid;
  const uid = await rpc('common', 'authenticate', [ODOO_DB, ODOO_USER, apiKey, {}]);
  if (!uid) throw new Error('Odoo auth failed — check ODOO_API_KEY');
  _uid = uid;
  return uid;
}

async function odoo(apiKey, model, method, args = [], kwargs = {}) {
  const uid = await odooAuth(apiKey);
  return rpc('object', 'execute_kw', [ODOO_DB, uid, apiKey, model, method, args, kwargs]);
}

/* ━━━ Sync log ━━━ */

async function logSync(db, action, model, targetId, reference, details, syncedBy) {
  await db.prepare(
    `INSERT INTO rm_sync_log (action, target_model, target_id, reference, details, synced_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(action, model, targetId, reference, JSON.stringify(details), syncedBy).run();
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * GET handlers — D1 reads, no auth
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function handleGet(url, env) {
  const db = env.DB;
  const action = url.searchParams.get('action');

  // --- Products ---
  if (action === 'products') {
    const brand = url.searchParams.get('brand');
    const category = url.searchParams.get('category');
    let q = 'SELECT * FROM rm_products WHERE is_active = 1';
    const p = [];
    if (brand) { q += ' AND (brand = ? OR brand = ?)'; p.push(brand, 'BOTH'); }
    if (category) { q += ' AND category = ?'; p.push(category); }
    q += ' ORDER BY hn_code';
    const rows = await db.prepare(q).bind(...p).all();
    return json({ products: rows.results, count: rows.results.length });
  }

  // --- Vendors ---
  if (action === 'vendors') {
    const cid = url.searchParams.get('company_id');
    let q = 'SELECT * FROM rm_vendors WHERE is_active = 1';
    const p = [];
    if (cid) { q += ' AND (company_id = ? OR company_id IS NULL)'; p.push(cid); }
    q += ' ORDER BY name';
    const rows = await db.prepare(q).bind(...p).all();
    return json({ vendors: rows.results, count: rows.results.length });
  }

  // --- Vendor↔Product mappings ---
  if (action === 'mappings') {
    const product = url.searchParams.get('product');
    const vendor = url.searchParams.get('vendor');
    let q = `SELECT vp.*, p.name AS product_name, p.brand, p.category, p.uom,
                    v.name AS vendor_name, v.phone AS vendor_phone
             FROM rm_vendor_products vp
             JOIN rm_products p ON p.hn_code = vp.product_code
             JOIN rm_vendors v ON v.key = vp.vendor_key
             WHERE p.is_active = 1`;
    const params = [];
    if (product) { q += ' AND vp.product_code = ?'; params.push(product); }
    if (vendor) { q += ' AND vp.vendor_key = ?'; params.push(vendor); }
    q += ' ORDER BY vp.product_code, vp.is_primary DESC';
    const rows = await db.prepare(q).bind(...params).all();
    return json({ mappings: rows.results, count: rows.results.length });
  }

  // --- Archive list ---
  if (action === 'archive-list') {
    const rows = await db.prepare('SELECT * FROM rm_archive_list ORDER BY id').all();
    return json({ archives: rows.results });
  }

  // --- Sync log ---
  if (action === 'sync-log') {
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const rows = await db.prepare('SELECT * FROM rm_sync_log ORDER BY synced_at DESC LIMIT ?').bind(limit).all();
    return json({ log: rows.results });
  }

  // --- Status dashboard ---
  if (action === 'status') {
    const [products, vendors, mappings, archives, synced, unsynced, byBrand, byAction, byCat, lastSync] =
      await Promise.all([
        db.prepare('SELECT COUNT(*) as c FROM rm_products WHERE is_active=1').first(),
        db.prepare('SELECT COUNT(*) as c FROM rm_vendors WHERE is_active=1').first(),
        db.prepare('SELECT COUNT(*) as c FROM rm_vendor_products').first(),
        db.prepare('SELECT COUNT(*) as c FROM rm_archive_list').first(),
        db.prepare('SELECT COUNT(*) as c FROM rm_products WHERE odoo_id IS NOT NULL AND is_active=1').first(),
        db.prepare('SELECT COUNT(*) as c FROM rm_products WHERE odoo_id IS NULL AND is_active=1').first(),
        db.prepare('SELECT brand, COUNT(*) as c FROM rm_products WHERE is_active=1 GROUP BY brand').all(),
        db.prepare('SELECT action, COUNT(*) as c FROM rm_products WHERE is_active=1 GROUP BY action').all(),
        db.prepare('SELECT category, COUNT(*) as c FROM rm_products WHERE is_active=1 GROUP BY category ORDER BY c DESC').all(),
        db.prepare('SELECT * FROM rm_sync_log ORDER BY synced_at DESC LIMIT 1').first(),
      ]);
    return json({
      products: products.c, vendors: vendors.c, mappings: mappings.c,
      archives: archives.c, synced: synced.c, unsynced: unsynced.c,
      by_brand: byBrand.results, by_action: byAction.results,
      by_category: byCat.results, last_sync: lastSync,
    });
  }

  // --- Distinct categories ---
  if (action === 'categories') {
    const rows = await db.prepare('SELECT DISTINCT category FROM rm_products WHERE is_active=1 ORDER BY category').all();
    return json({ categories: rows.results.map(r => r.category) });
  }

  // --- Next available code ---
  if (action === 'next-code') {
    const brand = url.searchParams.get('brand') || 'HE';
    const q = brand === 'NCH'
      ? "SELECT MAX(CAST(REPLACE(hn_code,'HN-RM-','') AS INTEGER)) as n FROM rm_products WHERE hn_code LIKE 'HN-RM-2%'"
      : "SELECT MAX(CAST(REPLACE(hn_code,'HN-RM-','') AS INTEGER)) as n FROM rm_products WHERE CAST(REPLACE(hn_code,'HN-RM-','') AS INTEGER) < 200";
    const row = await db.prepare(q).first();
    const next = (row?.n || (brand === 'NCH' ? 225 : 116)) + 1;
    return json({ next_code: `HN-RM-${String(next).padStart(3, '0')}` });
  }

  // --- Master Data: Categories + Brands + Pack Sizes + Grades (live from Odoo) ---
  if (action === 'master-data') {
    const apiKey = env.ODOO_API_KEY;
    if (!apiKey) return json({ error: 'ODOO_API_KEY not set' }, 500);
    try {
      const [cats, brands, packs, grades, vendors] = await Promise.all([
        odoo(apiKey, 'product.category', 'search_read',
          [[['parent_id', '=', CAT_GOODS_ROOT]]],
          { fields: ['id', 'name', 'complete_name', 'product_count'] }),
        odoo(apiKey, 'product.attribute.value', 'search_read',
          [[['attribute_id', '=', ATTR_BRAND]]],
          { fields: ['id', 'name', 'sequence'] }),
        odoo(apiKey, 'product.attribute.value', 'search_read',
          [[['attribute_id', '=', ATTR_PACK]]],
          { fields: ['id', 'name', 'sequence'] }),
        odoo(apiKey, 'product.attribute.value', 'search_read',
          [[['attribute_id', '=', ATTR_GRADE]]],
          { fields: ['id', 'name', 'sequence'] }),
        // vendors from D1 — already the source of truth for vendor master
        db.prepare('SELECT key, name, phone, company_id, odoo_id, is_active FROM rm_vendors ORDER BY name').all(),
      ]);
      // Sort: cats alpha, brands alpha, packs by sequence, grades alpha
      cats.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      brands.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      packs.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
      grades.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      return json({
        categories: cats,
        brands,
        packs,
        grades,
        vendors: vendors.results,
        attr_ids: { brand: ATTR_BRAND, pack: ATTR_PACK, grade: ATTR_GRADE },
        cat_root: CAT_GOODS_ROOT,
      });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  return json({
    error: 'Unknown action',
    actions: 'products, vendors, mappings, archive-list, sync-log, status, categories, next-code, master-data',
  }, 400);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * POST handlers — PIN-gated
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function handlePost(request, env) {
  const db = env.DB;
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { action, pin } = body;
  if (!action) return json({ error: 'Missing action' }, 400);

  const needsAdmin = action !== 'extract';
  const user = checkPin(pin, needsAdmin);
  if (!user) return json({ error: needsAdmin ? 'Admin PIN required (0305)' : 'Valid PIN required' }, 403);

  /* --- D1 writes --- */

  if (action === 'add-product') {
    const { hn_code, name, category, uom, brand, avg_cost, old_code, odoo_id, notes } = body;
    if (!hn_code || !name || !category || !uom || !brand)
      return json({ error: 'Required: hn_code, name, category, uom, brand' }, 400);
    await db.prepare(
      `INSERT INTO rm_products (hn_code, old_code, name, category, uom, brand, avg_cost, odoo_id, action, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CREATE', ?)`
    ).bind(hn_code, old_code || null, name, category, uom, brand, avg_cost || 0, odoo_id || null, notes || null).run();
    return json({ success: true, hn_code });
  }

  if (action === 'add-vendor') {
    const { key, name, phone, company_id, odoo_id, notes } = body;
    if (!key || !name) return json({ error: 'Required: key, name' }, 400);
    await db.prepare(
      `INSERT INTO rm_vendors (key, name, phone, company_id, odoo_id, notes) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(key, name, phone || null, company_id || null, odoo_id || null, notes || null).run();
    return json({ success: true, key });
  }

  if (action === 'link-vendor') {
    const { product_code, vendor_key, is_primary, last_price, notes } = body;
    if (!product_code || !vendor_key) return json({ error: 'Required: product_code, vendor_key' }, 400);
    await db.prepare(
      `INSERT OR REPLACE INTO rm_vendor_products (product_code, vendor_key, is_primary, last_price, notes)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(product_code, vendor_key, is_primary ? 1 : 0, last_price || null, notes || null).run();
    if (is_primary) {
      await db.prepare('UPDATE rm_vendor_products SET is_primary=0 WHERE product_code=? AND vendor_key!=?')
        .bind(product_code, vendor_key).run();
    }
    return json({ success: true, message: `${product_code} → ${vendor_key}` });
  }

  if (action === 'update-product') {
    const { hn_code, ...fields } = body;
    if (!hn_code) return json({ error: 'Required: hn_code' }, 400);
    const allow = ['name', 'category', 'uom', 'brand', 'avg_cost', 'old_code', 'odoo_id', 'notes', 'is_active'];
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (allow.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
    }
    if (!sets.length) return json({ error: 'No valid fields' }, 400);
    sets.push("updated_at = datetime('now')");
    vals.push(hn_code);
    await db.prepare(`UPDATE rm_products SET ${sets.join(', ')} WHERE hn_code = ?`).bind(...vals).run();
    return json({ success: true, hn_code });
  }

  if (action === 'update-vendor') {
    const { key, ...fields } = body;
    if (!key) return json({ error: 'Required: key' }, 400);
    const allow = ['name', 'phone', 'company_id', 'odoo_id', 'notes', 'is_active', 'rename_from'];
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (allow.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
    }
    if (!sets.length) return json({ error: 'No valid fields' }, 400);
    sets.push("updated_at = datetime('now')");
    vals.push(key);
    await db.prepare(`UPDATE rm_vendors SET ${sets.join(', ')} WHERE key = ?`).bind(...vals).run();
    return json({ success: true, key });
  }

  /* --- Odoo operations --- */

  if (action === 'extract') {
    return await doExtract(env);
  }

  if (action === 'sync-step') {
    const { step } = body;
    const valid = ['categories', 'uoms', 'vendors', 'products', 'supplierinfo', 'archive'];
    if (!step || !valid.includes(step))
      return json({ error: `Required: step (${valid.join('|')})` }, 400);
    const result = await runSyncStep(env, db, step, user.name);
    return json({ success: true, step, ...result });
  }

  if (action === 'sync-all') {
    const steps = ['categories', 'uoms', 'vendors', 'products', 'supplierinfo', 'archive'];
    const results = {};
    for (const step of steps) {
      try {
        results[step] = await runSyncStep(env, db, step, user.name);
      } catch (err) {
        results[step] = { error: err.message };
        results._stopped_at = step;
        break;
      }
    }
    return json({ success: !results._stopped_at, results });
  }

  if (action === 'cleanup') {
    const { step } = body;
    const valid = ['audit', 'dupes', 'rename', 'fix-d1', 'categories'];
    if (!step || !valid.includes(step))
      return json({ error: `Required: step (${valid.join('|')})` }, 400);
    return json(await runCleanup(env, db, step, user.name));
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * Master Data: Categories + Brands + Pack Sizes + Grades
   * Write path is custom UI → Odoo (source of truth) → log to D1
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  if (action === 'master-create') {
    const { type, name, parent_id } = body;
    if (!type || !name) return json({ error: 'Required: type, name' }, 400);
    const trimmed = String(name).trim();
    if (!trimmed) return json({ error: 'Name cannot be empty' }, 400);
    const apiKey = env.ODOO_API_KEY;
    if (!apiKey) return json({ error: 'ODOO_API_KEY not set' }, 500);

    const attrMap = { brand: ATTR_BRAND, pack: ATTR_PACK, grade: ATTR_GRADE };
    try {
      let odooId, model;
      if (type === 'category') {
        model = 'product.category';
        // dup check under same parent
        const pid = parent_id || CAT_GOODS_ROOT;
        const dup = await odoo(apiKey, model, 'search_count',
          [[['parent_id', '=', pid], ['name', '=ilike', trimmed]]]);
        if (dup) return json({ error: `Category "${trimmed}" already exists here` }, 409);
        odooId = await odoo(apiKey, model, 'create', [{ name: trimmed, parent_id: pid }]);
      } else if (attrMap[type] !== undefined) {
        model = 'product.attribute.value';
        const attrId = attrMap[type];
        const dup = await odoo(apiKey, model, 'search_count',
          [[['attribute_id', '=', attrId], ['name', '=ilike', trimmed]]]);
        if (dup) return json({ error: `${type} "${trimmed}" already exists` }, 409);
        odooId = await odoo(apiKey, model, 'create',
          [{ name: trimmed, attribute_id: attrId }]);
      } else {
        return json({ error: `Unknown type: ${type} (use category|brand|pack|grade)` }, 400);
      }
      await logSync(db, `create_${type}`, model, odooId, trimmed,
        { name: trimmed, type }, user.name);
      return json({ success: true, id: odooId, name: trimmed, type });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  if (action === 'master-rename') {
    const { type, id, new_name } = body;
    if (!type || !id || !new_name) return json({ error: 'Required: type, id, new_name' }, 400);
    const trimmed = String(new_name).trim();
    if (!trimmed) return json({ error: 'Name cannot be empty' }, 400);
    const apiKey = env.ODOO_API_KEY;
    if (!apiKey) return json({ error: 'ODOO_API_KEY not set' }, 500);
    const model = type === 'category' ? 'product.category' : 'product.attribute.value';
    try {
      await odoo(apiKey, model, 'write', [[parseInt(id)], { name: trimmed }]);
      await logSync(db, `rename_${type}`, model, parseInt(id), trimmed,
        { new_name: trimmed, type }, user.name);
      return json({ success: true, id: parseInt(id), new_name: trimmed });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  if (action === 'master-archive') {
    const { type, id } = body;
    if (!type || !id) return json({ error: 'Required: type, id' }, 400);
    const apiKey = env.ODOO_API_KEY;
    if (!apiKey) return json({ error: 'ODOO_API_KEY not set' }, 500);
    const nid = parseInt(id);
    try {
      if (type === 'category') {
        // Refuse if any template uses it (active or archived)
        const used = await odoo(apiKey, 'product.template', 'search_count',
          [[['categ_id', '=', nid], ['active', 'in', [true, false]]]]);
        if (used) return json({
          error: `Category has ${used} products — migrate them first`,
          product_count: used,
        }, 409);
        await odoo(apiKey, 'product.category', 'unlink', [[nid]]);
      } else if (['brand', 'pack', 'grade'].includes(type)) {
        // Refuse if value is on any template attribute line
        const used = await odoo(apiKey, 'product.template.attribute.line', 'search_count',
          [[['value_ids', 'in', [nid]]]]);
        if (used) return json({
          error: `${type} value is in use on ${used} product(s) — remove from products first`,
          usage_count: used,
        }, 409);
        await odoo(apiKey, 'product.attribute.value', 'unlink', [[nid]]);
      } else {
        return json({ error: `Unknown type: ${type}` }, 400);
      }
      const model = type === 'category' ? 'product.category' : 'product.attribute.value';
      await logSync(db, `archive_${type}`, model, nid, String(nid), { type }, user.name);
      return json({ success: true, id: nid });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  return json({ error: 'Unknown action' }, 400);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Odoo Extract — snapshot current Odoo state
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function doExtract(env) {
  const apiKey = env.ODOO_API_KEY;
  if (!apiKey) return json({ error: 'ODOO_API_KEY secret not set' }, 500);

  const uid = await odooAuth(apiKey);

  const [categories, uoms, vendors, products, fields] = await Promise.all([
    odoo(apiKey, 'product.category', 'search_read', [[]], { fields: ['name', 'parent_id', 'complete_name'] }),
    odoo(apiKey, 'uom.uom', 'search_read', [[]], { fields: ['name'] }),
    odoo(apiKey, 'res.partner', 'search_read',
      [[['supplier_rank', '>', 0]]],
      { fields: ['name', 'phone', 'supplier_rank', 'company_id', 'active'] }),
    odoo(apiKey, 'product.product', 'search_read',
      [[['default_code', '!=', false], ['default_code', 'like', 'RM-']]],
      { fields: ['name', 'default_code', 'categ_id', 'uom_id', 'standard_price', 'type', 'company_id', 'active', 'product_tmpl_id'] }),
    odoo(apiKey, 'product.product', 'fields_get', [],
      { attributes: ['string', 'type', 'selection'] }),
  ]);

  // Supplierinfo for matched products
  const tmplIds = [...new Set(products.map(p => p.product_tmpl_id?.[0]).filter(Boolean))];
  const supplierinfo = tmplIds.length
    ? await odoo(apiKey, 'product.supplierinfo', 'search_read',
        [[['product_tmpl_id', 'in', tmplIds]]],
        { fields: ['partner_id', 'product_tmpl_id', 'price', 'min_qty', 'company_id'] })
    : [];

  return json({
    uid,
    odoo_fields: {
      has_is_storable: !!fields.is_storable,
      type_selection: fields.type?.selection || null,
    },
    counts: {
      categories: categories.length, uoms: uoms.length,
      vendors: vendors.length, products: products.length,
      supplierinfo: supplierinfo.length,
    },
    data: { categories, uoms, vendors, products, supplierinfo },
  });
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Sync steps — each step is idempotent & resumable
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function runSyncStep(env, db, step, userName) {
  const apiKey = env.ODOO_API_KEY;
  if (!apiKey) throw new Error('ODOO_API_KEY not set');

  switch (step) {
    case 'categories':   return syncCategories(apiKey, db, userName);
    case 'uoms':         return syncUoms(apiKey);
    case 'vendors':      return syncVendors(apiKey, db, userName);
    case 'products':     return syncProducts(apiKey, db, userName);
    case 'supplierinfo': return syncSupplierInfo(apiKey, db, userName);
    case 'archive':      return syncArchive(apiKey, db, userName);
    default: throw new Error(`Unknown step: ${step}`);
  }
}

/* --- Categories --- */

async function syncCategories(apiKey, db, userName) {
  const existing = await odoo(apiKey, 'product.category', 'search_read', [[]], { fields: ['name', 'complete_name'] });
  const d1Cats = await db.prepare('SELECT DISTINCT category FROM rm_products WHERE is_active=1').all();

  const created = [];
  for (const { category } of d1Cats.results) {
    const found = existing.find(c => c.name === category || c.complete_name?.endsWith(category));
    if (!found) {
      const id = await odoo(apiKey, 'product.category', 'create', [{ name: category, parent_id: 1 }]);
      created.push({ name: category, odoo_id: id });
      existing.push({ id, name: category });
      await logSync(db, 'create_category', 'product.category', id, category, { name: category }, userName);
    }
  }

  return { existing: existing.length, needed: d1Cats.results.length, created };
}

/* --- UoMs (read-only — just build the mapping) --- */

async function syncUoms(apiKey) {
  const existing = await odoo(apiKey, 'uom.uom', 'search_read', [[]], { fields: ['name'] });
  const byName = {};
  for (const u of existing) byName[u.name.toLowerCase()] = u.id;

  const mapping = {};
  for (const [text, odooName] of Object.entries(UOM_FALLBACK)) {
    const id = byName[odooName.toLowerCase()] || byName[text.toLowerCase()];
    mapping[text] = id ? { odoo_id: id, name: odooName } : { odoo_id: byName['units'] || 1, name: 'Units', fallback: true };
  }

  return { odoo_uoms: existing.length, mapping };
}

/* --- Vendors --- */

async function syncVendors(apiKey, db, userName) {
  const d1 = (await db.prepare('SELECT * FROM rm_vendors WHERE is_active=1').all()).results;
  const odooV = await odoo(apiKey, 'res.partner', 'search_read',
    [[['supplier_rank', '>', 0]]], { fields: ['name', 'phone', 'company_id'] });

  const out = { renamed: [], created: [], linked: [], skipped: [] };
  const t0 = Date.now();

  for (const v of d1) {
    if (Date.now() - t0 > MAX_RUNTIME_MS) { out.partial = true; break; }

    // Already in Odoo → check rename
    if (v.odoo_id) {
      const ov = odooV.find(o => o.id === v.odoo_id);
      if (ov && v.rename_from && ov.name === v.rename_from) {
        await odoo(apiKey, 'res.partner', 'write', [[v.odoo_id], { name: v.name }]);
        out.renamed.push({ key: v.key, from: v.rename_from, to: v.name });
        await logSync(db, 'rename_vendor', 'res.partner', v.odoo_id, v.key,
          { from: v.rename_from, to: v.name }, userName);
      } else {
        out.skipped.push({ key: v.key, odoo_id: v.odoo_id });
      }
      continue;
    }

    // Try to match existing Odoo vendor by name or phone
    const match = odooV.find(o =>
      o.name.toLowerCase() === v.name.toLowerCase() ||
      (v.phone && o.phone === v.phone)
    );

    if (match) {
      await db.prepare("UPDATE rm_vendors SET odoo_id=?, updated_at=datetime('now') WHERE key=?")
        .bind(match.id, v.key).run();
      out.linked.push({ key: v.key, odoo_id: match.id });
      await logSync(db, 'link_vendor', 'res.partner', match.id, v.key, { matched: match.name }, userName);
    } else {
      const cid = v.company_id ? parseInt(v.company_id) : false;
      const newId = await odoo(apiKey, 'res.partner', 'create', [{
        name: v.name,
        phone: v.phone || false,
        supplier_rank: 1,
        company_type: 'person',
        company_id: cid,
      }]);
      await db.prepare("UPDATE rm_vendors SET odoo_id=?, updated_at=datetime('now') WHERE key=?")
        .bind(newId, v.key).run();
      out.created.push({ key: v.key, odoo_id: newId });
      await logSync(db, 'create_vendor', 'res.partner', newId, v.key, { name: v.name }, userName);
    }
  }

  return out;
}

/* --- Products --- */

async function syncProducts(apiKey, db, userName) {
  // Resolve UoM + category mappings
  const uomResult = await syncUoms(apiKey);
  const uomMap = uomResult.mapping;

  const odooCats = await odoo(apiKey, 'product.category', 'search_read', [[]], { fields: ['name', 'complete_name'] });
  const catMap = {};
  for (const c of odooCats) catMap[c.name] = c.id;

  // Detect Odoo field compatibility — check actual selection values
  const meta = await odoo(apiKey, 'product.product', 'fields_get', [], { attributes: ['type', 'selection'] });
  const hasIsStorable = !!meta.is_storable;
  const typeSelection = meta.type?.selection || [];
  const typeOptions = typeSelection.map(s => s[0]);
  // Use whatever storable type this Odoo has: 'goods', 'consu', or 'product'
  const typeVal = typeOptions.includes('goods') ? 'goods' : typeOptions.includes('consu') ? 'consu' : 'product';

  // Load D1 products by action — limit per call to avoid CF 50-subrequest limit
  const BATCH = 15;
  const creates = (await db.prepare("SELECT * FROM rm_products WHERE action='CREATE' AND is_active=1 LIMIT ?").bind(BATCH).all()).results;
  const updates = (await db.prepare("SELECT * FROM rm_products WHERE action='UPDATE' AND is_active=1 LIMIT ?").bind(BATCH).all()).results;

  const out = { created: [], updated: [], verified: [], errors: [], remaining: 0 };

  // Count remaining
  const remC = await db.prepare("SELECT COUNT(*) as c FROM rm_products WHERE action='CREATE' AND is_active=1").first();
  const remU = await db.prepare("SELECT COUNT(*) as c FROM rm_products WHERE action='UPDATE' AND is_active=1").first();
  out.remaining = (remC?.c || 0) + (remU?.c || 0);

  // Helper: resolve or create category
  async function resolveCat(name) {
    if (catMap[name]) return catMap[name];
    const id = await odoo(apiKey, 'product.category', 'create', [{ name, parent_id: 1 }]);
    catMap[name] = id;
    return id;
  }

  // Helper: build product vals
  async function buildVals(p) {
    const categId = await resolveCat(p.category);
    const uom = uomMap[p.uom] || { odoo_id: 1 };
    return {
      name: p.name,
      default_code: p.hn_code,
      type: typeVal,
      categ_id: categId,
      uom_id: uom.odoo_id,
      standard_price: p.avg_cost || 0,
      purchase_ok: true,
      sale_ok: false,
      company_id: BRAND_COMPANY[p.brand] ?? false,
      ...(hasIsStorable ? { is_storable: true } : {}),
    };
  }

  // Batch-search existing codes in ONE Odoo call (saves subrequests)
  const allCodes = [];
  for (const p of [...creates, ...updates]) {
    allCodes.push(p.hn_code);
    if (p.old_code) allCodes.push(p.old_code);
  }
  const existingOdoo = allCodes.length
    ? await odoo(apiKey, 'product.product', 'search_read',
        [[['default_code', 'in', allCodes]]], { fields: ['id', 'default_code'] })
    : [];
  const byCode = {};
  for (const e of existingOdoo) byCode[e.default_code] = e.id;

  // --- CREATE ---
  for (const p of creates) {
    try {
      const existId = byCode[p.hn_code] || (p.old_code && byCode[p.old_code]);
      if (existId) {
        await db.prepare("UPDATE rm_products SET odoo_id=?, action='KEEP', updated_at=datetime('now') WHERE hn_code=?")
          .bind(existId, p.hn_code).run();
        // Rename code in Odoo if still using old code
        if (!byCode[p.hn_code] && p.old_code && byCode[p.old_code]) {
          await odoo(apiKey, 'product.product', 'write', [[existId], { default_code: p.hn_code }]);
        }
        out.verified.push({ code: p.hn_code, odoo_id: existId });
        continue;
      }

      const vals = await buildVals(p);
      const newId = await odoo(apiKey, 'product.product', 'create', [vals]);
      await db.prepare("UPDATE rm_products SET odoo_id=?, action='KEEP', updated_at=datetime('now') WHERE hn_code=?")
        .bind(newId, p.hn_code).run();
      out.created.push({ code: p.hn_code, odoo_id: newId });
      await logSync(db, 'create_product', 'product.product', newId, p.hn_code, vals, userName);
    } catch (err) {
      out.errors.push({ code: p.hn_code, error: err.message });
    }
  }

  // --- UPDATE ---
  for (const p of updates) {
    try {
      if (!p.odoo_id) { out.errors.push({ code: p.hn_code, error: 'no odoo_id' }); continue; }

      const vals = await buildVals(p);
      await odoo(apiKey, 'product.product', 'write', [[p.odoo_id], vals]);
      await db.prepare("UPDATE rm_products SET action='KEEP', updated_at=datetime('now') WHERE hn_code=?")
        .bind(p.hn_code).run();
      out.updated.push({ code: p.hn_code, odoo_id: p.odoo_id });
      await logSync(db, 'update_product', 'product.product', p.odoo_id, p.hn_code, vals, userName);
    } catch (err) {
      out.errors.push({ code: p.hn_code, error: err.message });
    }
  }

  return out;
}

/* --- Supplierinfo --- */

async function syncSupplierInfo(apiKey, db, userName) {
  // Batch: max 35 per call to stay under CF 50-subrequest limit (2 initial + 35 creates = 37)
  const BATCH = 35;
  const rows = (await db.prepare(`
    SELECT vp.*, p.odoo_id AS p_oid, v.odoo_id AS v_oid
    FROM rm_vendor_products vp
    JOIN rm_products p ON p.hn_code = vp.product_code
    JOIN rm_vendors v ON v.key = vp.vendor_key
    WHERE p.is_active=1 AND p.odoo_id IS NOT NULL AND v.odoo_id IS NOT NULL
  `).all()).results;

  if (!rows.length) return { skipped: 'no synced product-vendor pairs' };

  // Resolve product_tmpl_id for each product (1 Odoo call)
  const pIds = [...new Set(rows.map(r => r.p_oid))];
  const pRecs = await odoo(apiKey, 'product.product', 'search_read',
    [[['id', 'in', pIds]]], { fields: ['id', 'product_tmpl_id'] });
  const tmplOf = {};
  for (const r of pRecs) tmplOf[r.id] = r.product_tmpl_id[0];

  // Load ALL existing supplierinfo in 1 call
  const tmplIds = [...new Set(Object.values(tmplOf))];
  const existingInfo = tmplIds.length
    ? await odoo(apiKey, 'product.supplierinfo', 'search_read',
        [[['product_tmpl_id', 'in', tmplIds]]], { fields: ['partner_id', 'product_tmpl_id', 'price'] })
    : [];

  // Filter to only rows that need action (not already in existingInfo)
  const needsAction = [];
  const alreadySkipped = [];
  for (const m of rows) {
    const tmplId = tmplOf[m.p_oid];
    if (!tmplId) continue;
    const exists = existingInfo.find(s =>
      s.partner_id[0] === m.v_oid && s.product_tmpl_id[0] === tmplId
    );
    if (exists && (!m.last_price || Math.abs(exists.price - m.last_price) <= 0.01)) {
      alreadySkipped.push({ p: m.product_code, v: m.vendor_key });
    } else {
      needsAction.push({ ...m, tmplId, existsId: exists?.id });
    }
  }

  const out = { created: [], updated: [], skipped: alreadySkipped, remaining: needsAction.length };
  const batch = needsAction.slice(0, BATCH);
  out.remaining = needsAction.length - batch.length;

  for (const m of batch) {
    if (m.existsId) {
      await odoo(apiKey, 'product.supplierinfo', 'write', [[m.existsId], { price: m.last_price }]);
      out.updated.push({ p: m.product_code, v: m.vendor_key });
    } else {
      const vals = { partner_id: m.v_oid, product_tmpl_id: m.tmplId, price: m.last_price || 0, min_qty: 1 };
      const id = await odoo(apiKey, 'product.supplierinfo', 'create', [vals]);
      out.created.push({ p: m.product_code, v: m.vendor_key, id });
      await logSync(db, 'create_supplierinfo', 'product.supplierinfo', id,
        `${m.product_code}→${m.vendor_key}`, vals, userName);
    }
  }

  return out;
}

/* --- Archive --- */

async function syncArchive(apiKey, db, userName) {
  const items = (await db.prepare('SELECT * FROM rm_archive_list WHERE archived_at IS NULL').all()).results;
  const out = { archived: [], not_found: [] };

  for (const a of items) {
    try {
      const domain = a.old_code
        ? [['default_code', '=', a.old_code]]
        : [['name', 'ilike', a.name]];
      const found = await odoo(apiKey, 'product.product', 'search_read', [domain],
        { fields: ['id', 'name', 'active'], limit: 1 });

      if (found.length && found[0].active !== false) {
        await odoo(apiKey, 'product.product', 'write', [[found[0].id], { active: false }]);
        await db.prepare("UPDATE rm_archive_list SET archived_at=datetime('now') WHERE id=?").bind(a.id).run();
        out.archived.push({ name: a.name, odoo_id: found[0].id });
        await logSync(db, 'archive_product', 'product.product', found[0].id,
          a.old_code || a.name, { reason: a.reason }, userName);
      } else {
        out.not_found.push({ name: a.name, code: a.old_code });
      }
    } catch (err) {
      out.not_found.push({ name: a.name, error: err.message });
    }
  }

  return out;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Cleanup — fix post-sync duplicates, wrong codes, bad D1 IDs
 * Run order: audit → dupes → rename (repeat until 0 remaining) → fix-d1 → categories
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function runCleanup(env, db, step, userName) {
  const apiKey = env.ODOO_API_KEY;
  if (!apiKey) throw new Error('ODOO_API_KEY not set');
  switch (step) {
    case 'audit':      return cleanupAudit(apiKey, db);
    case 'dupes':      return cleanupDupes(apiKey, db, userName);
    case 'rename':     return cleanupRename(apiKey, db, userName);
    case 'fix-d1':     return cleanupFixD1(apiKey, db);
    case 'categories': return cleanupCategories(apiKey, db, userName);
  }
}

async function fetchCleanupState(apiKey, db) {
  await odooAuth(apiKey);
  const [prods, cats] = await Promise.all([
    odoo(apiKey, 'product.product', 'search_read',
      [['|', ['default_code', 'like', 'RM-'], ['default_code', 'like', 'NCH-']]],
      { fields: ['id', 'default_code', 'name', 'categ_id', 'product_tmpl_id'] }),
    odoo(apiKey, 'product.category', 'search_read',
      [[['complete_name', 'like', 'Goods /']]], { fields: ['id', 'name'] }),
  ]);
  const d1 = (await db.prepare('SELECT * FROM rm_products WHERE is_active=1 ORDER BY hn_code').all()).results;
  const byCode = {};
  for (const p of prods) if (p.default_code) byCode[p.default_code] = p;
  const catMap = {};
  for (const c of cats) catMap[c.name] = c.id;
  return { prods, byCode, catMap, d1 };
}

/* --- Audit: read-only analysis of what needs fixing --- */

async function cleanupAudit(apiKey, db) {
  const { byCode, d1 } = await fetchCleanupState(apiKey, db);
  const dupes = [], renames = [], clean = [], missing = [], d1Wrong = [];

  for (const d of d1) {
    const hn = byCode[d.hn_code];
    const old = d.old_code ? byCode[d.old_code] : null;
    const oid = d.odoo_id ? parseInt(d.odoo_id) : null;
    const correct = old?.id || hn?.id;

    if (hn && old)
      dupes.push({ c: d.hn_code, hn_id: hn.id, old: d.old_code, old_id: old.id });
    else if (!hn && old)
      renames.push({ c: d.hn_code, old: d.old_code, id: old.id, cat: old.categ_id?.[1] });
    else if (hn)
      clean.push(d.hn_code);
    else
      missing.push({ c: d.hn_code, old: d.old_code, oid });

    if (correct && oid !== correct)
      d1Wrong.push({ c: d.hn_code, has: oid, need: correct });
  }

  return {
    summary: {
      dupes: dupes.length, renames: renames.length,
      clean: clean.length, missing: missing.length, d1_wrong: d1Wrong.length,
    },
    dupes, renames, missing,
    d1_wrong_sample: d1Wrong.slice(0, 15),
  };
}

/* --- Dupes: archive HN-RM duplicate, rename HE-RM original → HN-RM --- */

async function cleanupDupes(apiKey, db, userName) {
  const { byCode, catMap, d1 } = await fetchCleanupState(apiKey, db);
  const out = { archived: [], renamed: [], d1_fixed: [], errors: [] };

  for (const d of d1) {
    const hn = byCode[d.hn_code];
    const old = d.old_code ? byCode[d.old_code] : null;
    if (!hn || !old) continue;

    try {
      // Archive the duplicate (new HN-RM product created by sync)
      await odoo(apiKey, 'product.product', 'write', [[hn.id], { active: false }]);
      out.archived.push({ code: d.hn_code, id: hn.id });

      // Rename original (HE-RM/old → HN-RM) + recategorize
      const vals = { default_code: d.hn_code };
      if (catMap[d.category]) vals.categ_id = catMap[d.category];
      if (d.name && d.name !== old.name) vals.name = d.name;
      await odoo(apiKey, 'product.product', 'write', [[old.id], vals]);
      out.renamed.push({ from: d.old_code, to: d.hn_code, id: old.id });

      // Fix D1 odoo_id to point to the original product
      if (parseInt(d.odoo_id) !== old.id) {
        await db.prepare("UPDATE rm_products SET odoo_id=?, updated_at=datetime('now') WHERE hn_code=?")
          .bind(old.id, d.hn_code).run();
        out.d1_fixed.push(d.hn_code);
      }

      await logSync(db, 'cleanup_dupe', 'product.product', old.id, d.hn_code,
        { archived: hn.id, from: d.old_code }, userName);
    } catch (e) {
      out.errors.push({ c: d.hn_code, err: e.message });
    }
  }

  return out;
}

/* --- Rename: HE-RM/NCH old codes → HN-RM (batched, re-run until remaining=0) --- */

async function cleanupRename(apiKey, db, userName) {
  const { byCode, catMap, d1 } = await fetchCleanupState(apiKey, db);
  const todo = d1.filter(d => !byCode[d.hn_code] && d.old_code && byCode[d.old_code]);
  const BATCH = 20;
  const batch = todo.slice(0, BATCH);
  const out = { renamed: [], d1_fixed: [], errors: [], remaining: todo.length - batch.length };

  for (const d of batch) {
    const old = byCode[d.old_code];
    try {
      const vals = { default_code: d.hn_code };
      if (catMap[d.category]) vals.categ_id = catMap[d.category];
      if (d.name && d.name !== old.name) vals.name = d.name;
      await odoo(apiKey, 'product.product', 'write', [[old.id], vals]);
      out.renamed.push({ from: d.old_code, to: d.hn_code, id: old.id });

      if (parseInt(d.odoo_id) !== old.id) {
        await db.prepare("UPDATE rm_products SET odoo_id=?, updated_at=datetime('now') WHERE hn_code=?")
          .bind(old.id, d.hn_code).run();
        out.d1_fixed.push(d.hn_code);
      }

      await logSync(db, 'cleanup_rename', 'product.product', old.id, d.hn_code,
        { from: d.old_code }, userName);
    } catch (e) {
      out.errors.push({ c: d.hn_code, err: e.message });
    }
  }

  return out;
}

/* --- Fix D1: sync correct odoo_ids + reset missing products for creation --- */

async function cleanupFixD1(apiKey, db) {
  await odooAuth(apiKey);
  const prods = await odoo(apiKey, 'product.product', 'search_read',
    [[['default_code', 'like', 'HN-RM-']]], { fields: ['id', 'default_code'] });
  const byCode = {};
  for (const p of prods) byCode[p.default_code] = p.id;

  const d1 = (await db.prepare('SELECT hn_code, odoo_id FROM rm_products WHERE is_active=1').all()).results;
  const fixed = [], ok = [], resetForCreate = [];

  for (const d of d1) {
    const cid = byCode[d.hn_code];
    const d1id = d.odoo_id ? parseInt(d.odoo_id) : null;
    if (!cid) {
      // Product doesn't exist in Odoo — reset to CREATE so sync-step/products will create it
      await db.prepare("UPDATE rm_products SET odoo_id=NULL, action='CREATE', updated_at=datetime('now') WHERE hn_code=?")
        .bind(d.hn_code).run();
      resetForCreate.push(d.hn_code);
      continue;
    }
    if (d1id === cid) { ok.push(d.hn_code); continue; }
    await db.prepare("UPDATE rm_products SET odoo_id=?, updated_at=datetime('now') WHERE hn_code=?")
      .bind(cid, d.hn_code).run();
    fixed.push({ c: d.hn_code, was: d1id, now: cid });
  }

  return {
    fixed: fixed.length, ok: ok.length,
    reset_for_create: resetForCreate,
    details: fixed,
    next: resetForCreate.length ? 'Run sync-step/products to create missing items' : null,
  };
}

/* --- Categories: deprecate old HE/NCH Raw Materials categories once empty --- */

async function cleanupCategories(apiKey, db, userName) {
  await odooAuth(apiKey);
  const oldCats = await odoo(apiKey, 'product.category', 'search_read',
    [['|', ['complete_name', 'like', 'HE Raw Materials'], ['complete_name', 'like', 'NCH Raw Materials']]],
    { fields: ['id', 'name', 'complete_name'] });
  if (!oldCats.length) return { message: 'No old categories found' };

  const ids = oldCats.map(c => c.id);
  const activeCount = await odoo(apiKey, 'product.product', 'search_count',
    [[['categ_id', 'in', ids], ['active', '=', true]]]);

  if (activeCount > 0)
    return { error: `${activeCount} active products still in old categories — run rename first`, categories: oldCats };

  const deprecated = [];
  for (const c of oldCats) {
    if (!c.name.startsWith('[DEP')) {
      await odoo(apiKey, 'product.category', 'write', [[c.id], { name: `[DEPRECATED] ${c.name}` }]);
      deprecated.push(c.complete_name);
    }
  }

  await logSync(db, 'cleanup_categories', 'product.category', 0, 'deprecated',
    { count: deprecated.length, ids }, userName);
  return { deprecated: deprecated.length, categories: deprecated };
}

/* ━━━ Main entry ━━━ */

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS')
    return new Response(null, { headers: CORS });

  try {
    const url = new URL(request.url);
    if (request.method === 'GET')  return await handleGet(url, env);
    if (request.method === 'POST') return await handlePost(request, env);
    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('RM Admin error:', err);
    return json({ error: err.message }, 500);
  }
}
