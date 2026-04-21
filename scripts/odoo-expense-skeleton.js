#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// HN Hotels — Odoo Expense Master Skeleton Executor
// ═══════════════════════════════════════════════════════════════════════════
// Idempotent. Run: node scripts/odoo-expense-skeleton.js [--dry]
//
// Phases:
//   A. Discovery        — inspect current hr.expense / product.product state
//   B. Archive demo     — hide Odoo demo expense records + demo products
//   C. Build tree       — 14 product.category parents + ~85 product.product
//   D. Custom fields    — 4 x_ fields on hr.expense via ir.model.fields
//   E. Verify           — create one test hr.expense, read back, archive
//
// Target: ops.hamzahotel.com (Admin UID=2 yash@gmail.com)
// Auth  : admin API key. Every RPC must pass through `odoo()`.
// ═══════════════════════════════════════════════════════════════════════════

const ODOO_URL = 'https://ops.hamzahotel.com/jsonrpc';
const ODOO_DB  = 'main';
const ODOO_UID = 2;
const ODOO_KEY = '88eb49c5e7e5e3695d467ed086f3517c10a2251c';
const DRY      = process.argv.includes('--dry');

// Paint helpers
const c = { g:s=>`\x1b[32m${s}\x1b[0m`, y:s=>`\x1b[33m${s}\x1b[0m`, r:s=>`\x1b[31m${s}\x1b[0m`,
            b:s=>`\x1b[1m${s}\x1b[0m`, d:s=>`\x1b[2m${s}\x1b[0m` };
const log  = (...a)=>console.log(...a);
const head = t=>log('\n'+c.b(`━━━ ${t} ${'━'.repeat(Math.max(0,72-t.length))}`));

async function odoo(model, method, args=[], kwargs={}) {
  const r = await fetch(ODOO_URL, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      jsonrpc:'2.0', method:'call',
      params:{ service:'object', method:'execute_kw',
               args:[ODOO_DB, ODOO_UID, ODOO_KEY, model, method, args, kwargs] }
    })
  });
  const j = await r.json();
  if (j.error) { console.error(c.r(`RPC ERROR ${model}.${method}:`), j.error.data?.message||j.error.message); throw new Error(j.error.message); }
  return j.result;
}

// ─── PHASE A: DISCOVERY ────────────────────────────────────────────────────
async function discover() {
  head('PHASE A — DISCOVERY');

  // Odoo version + modules
  const [accInstalled] = await odoo('ir.module.module','search_read',
    [[['name','=','account']]], {fields:['name','state','shortdesc']});
  log(`  account module: ${c.g(accInstalled?.state||'?')}  (${accInstalled?.shortdesc||''})`);

  // hr.expense current records
  const exp = await odoo('hr.expense','search_read', [[]],
    {fields:['id','name','employee_id','product_id','total_amount','state','company_id'], limit:100});
  log(`  hr.expense rows: ${c.y(exp.length)}`);
  exp.slice(0,5).forEach(e=>log(c.d(`    #${e.id}  "${e.name}"  ₹${e.total_amount}  state=${e.state}  emp=${e.employee_id?.[1]}`)));
  if (exp.length>5) log(c.d(`    ... +${exp.length-5} more`));

  // Products currently flagged can_be_expensed
  const expProducts = await odoo('product.product','search_read',
    [[['can_be_expensed','=',true]]], {fields:['id','name','default_code','categ_id'], limit:200});
  log(`  can_be_expensed products: ${c.y(expProducts.length)}`);
  expProducts.slice(0,5).forEach(p=>log(c.d(`    #${p.id}  "${p.name}"  categ=${p.categ_id?.[1]}`)));
  if (expProducts.length>5) log(c.d(`    ... +${expProducts.length-5} more`));

  // Unit UoM id — try multiple names Odoo uses across versions/locales
  let unitUom = null;
  for (const n of ['Units','Unit','Piece(s)','Unit(s)','Each']) {
    const [found] = await odoo('uom.uom','search_read',[[['name','=',n]]],{fields:['id','name'],limit:1});
    if (found) { unitUom = found; break; }
  }
  if (!unitUom) {
    // Fall back: first reference-type UoM (uom_type='reference' in Unit category)
    [unitUom] = await odoo('uom.uom','search_read',
      [[['uom_type','=','reference']]], {fields:['id','name'],limit:1});
  }
  log(`  Unit UoM: ${c.g('#'+unitUom?.id)}  name="${unitUom?.name}"`);

  // hr.expense model id
  const [hrExpModel] = await odoo('ir.model','search_read',
    [[['model','=','hr.expense']]], {fields:['id','model','name'],limit:1});
  log(`  hr.expense model id: ${c.g(hrExpModel?.id)}`);

  // Companies
  const companies = await odoo('res.company','search_read',[[]], {fields:['id','name','currency_id']});
  log(`  Companies:`);
  companies.forEach(co=>log(c.d(`    #${co.id}  ${co.name}  currency=${co.currency_id?.[1]}`)));

  // Existing HN Hotels root category
  const existingRoot = await odoo('product.category','search_read',
    [[['name','=','HN Hotels Expenses']]], {fields:['id','name','parent_id'], limit:1});
  log(`  Existing HN Hotels Expenses root: ${existingRoot.length ? c.g('#'+existingRoot[0].id) : c.y('(not yet)')}`);

  // Any INR currency?
  const [inr] = await odoo('res.currency','search_read', [[['name','=','INR']]], {fields:['id','name','symbol'],limit:1});
  log(`  INR currency id: ${c.g(inr?.id)}  symbol=${inr?.symbol}`);

  return { exp, expProducts, unitUom, hrExpModel, companies, inr, existingRoot:existingRoot[0] };
}

// ─── PHASE B: ARCHIVE DEMO ─────────────────────────────────────────────────
async function archiveDemo(state) {
  head('PHASE B — ARCHIVE DEMO DATA');

  // Delete demo hr.expense rows — any row whose name suggests sample data
  const demoExpIds = state.exp.filter(e=>{
    const n = (e.name||'');
    if (/^REF00\d+$/.test(n)) return true;            // REF0001..REF0010
    if (/^Sample Receipt/i.test(n)) return true;      // "Sample Receipt: External training"
    return false;
  }).map(e=>e.id);

  if (demoExpIds.length) {
    log(`  hr.expense to unlink: ${c.y(demoExpIds.length)}  ${c.d(JSON.stringify(demoExpIds))}`);
    if (!DRY) {
      await odoo('hr.expense','unlink',[demoExpIds]);
      log(c.g(`  ✓ unlinked ${demoExpIds.length} demo expense rows`));
    } else log(c.d('  (dry-run — skipped)'));
  } else log(c.d('  no demo hr.expense rows found'));

  // Archive Odoo's 6 default English expense products + any lorem-ipsum demos.
  // These are generic ("Communication"/"Meals"/"Gifts") and conflict with our
  // structured taxonomy. Safe to archive — they can be restored by un-archiving.
  const demoProductNames = [
    'Communication','Expenses','Meals','Gifts','Mileage','Hotel Nights',
    'Viverra nam','Integer vitae','Volutpat blandit','In massa'
  ];
  const demoProdIds = state.expProducts
    .filter(p=>demoProductNames.includes(p.name))
    .map(p=>p.id);
  if (demoProdIds.length) {
    log(`  product.product to archive: ${c.y(demoProdIds.length)}  ${c.d(JSON.stringify(demoProdIds))}`);
    if (!DRY) {
      await odoo('product.product','write',[demoProdIds,{active:false}]);
      log(c.g(`  ✓ archived ${demoProdIds.length} generic/demo products`));
    } else log(c.d('  (dry-run — skipped)'));
  } else log(c.d('  no demo products found'));
}

// ─── TAXONOMY ──────────────────────────────────────────────────────────────
const TAXONOMY = {
  '01 · Raw Materials':          { note:'(handled via Purchase, no hr.expense needed)', items:[] },
  '02 · Salaries': { items: [
    'Monthly Salary Payout','Salary Advance','Bonus / Incentive','Overtime / Extra Shift',
    'PF Contribution','ESI Contribution']},
  '03 · Rent': { items: [
    'Rent — NCH Koramangala','Rent — HE Koramangala','Rent Deposit','Rent — Other']},
  '04 · Utilities': { items: [
    'BESCOM Electricity','BWSSB Water','Gas (formal)','Internet / Broadband',
    'Mobile Recharge','DTH / Cable']},
  '05 · Police & Compliance': { items: [
    'Beat Police','Cheta Police','Hoysala','ASI','Sub-Inspector (SI)',
    'Circle Police','Weekly Police','Festival / Bandobast']},
  '06 · Operations (Petty)': { items: [
    'Milk Purchase (Emergency)','Gas Cylinder (Petty)','Kitchen Supplies','Cleaning Materials',
    'Staff Food','Transport / Auto','Minor Repair (<₹2000)','Packaging (bags/paper/foil)',
    'Emergency (Catch-All)']},
  '07 · Maintenance & Repairs': { items: [
    'Equipment Repair — Grinder','Equipment Repair — Stove','Equipment Repair — Fridge',
    'Equipment Repair — Espresso','Plumbing','Electrical','Carpentry / Civil',
    'Pest Control','AMC / Service Contract']},
  '08 · Marketing & Promotion': { items: [
    'Meta / Facebook Ads','Google Ads','Zomato Promoted','Swiggy Promoted',
    'Offline Printing','Photography / Videography','Influencer / Blogger',
    'Promotional Samples / Gifts']},
  '09 · Technology': { items: [
    'Odoo Subscription','Cloudflare Workers / Pages','Domain Renewal','WABA Credits',
    'Razorpay MDR','Other SaaS']},
  '10 · Compliance & Legal': { items: [
    'GST Consultant','FSSAI','Shops & Establishment','Trade License',
    'Fire Safety NOC','Audit / Accountant Fees','Legal Consultation']},
  '11 · Transport & Logistics': { items: [
    'Raw-Material Transport','Inter-Branch Transport','Courier / Parcel',
    'Vehicle Fuel','Vehicle Maintenance']},
  '12 · Staff Welfare': { items: [
    'Staff Uniform','Staff Accommodation','Medical / First-Aid','Festival Gifts',
    'Training','Staff Travel']},
  '13 · Complementary': { items: [
    'Complementary Chai','Complementary Food Samples','Delivery Fee Waiver',
    'Influencer Visits']},
  '14 · One-Time Capex': { items: [
    'Kitchen Equipment','Furniture','POS Hardware','Signage / Branding',
    'Renovation / Interior','IT Hardware']},
  '15 · Owner Drawings (Excl. P&L)': { items: [
    'Proprietor Cash Drawing','Proprietor Card Drawing','Proprietor Bank Transfer']},
};

// ─── PHASE C: BUILD TREE ───────────────────────────────────────────────────
async function buildTree(state) {
  head('PHASE C — BUILD MASTER TAXONOMY');

  // 1. Root category
  let rootId = state.existingRoot?.id;
  if (!rootId) {
    if (DRY) { log(c.d('  (dry) would create root "HN Hotels Expenses"')); rootId = -1; }
    else {
      rootId = await odoo('product.category','create',[{name:'HN Hotels Expenses'}]);
      log(c.g(`  ✓ created root #${rootId}  "HN Hotels Expenses"`));
    }
  } else log(c.d(`  root already exists: #${rootId}`));

  // 2. Level-1 parent categories
  const catIds = {};
  for (const parentName of Object.keys(TAXONOMY)) {
    const existing = await odoo('product.category','search',
      [[['name','=',parentName],['parent_id','=',rootId]]], {limit:1});
    let cid;
    if (existing.length) {
      cid = existing[0];
      log(c.d(`  • ${parentName.padEnd(42)} exists #${cid}`));
    } else if (DRY) {
      log(c.y(`  + ${parentName.padEnd(42)} (dry) would create`));
      cid = -1;
    } else {
      cid = await odoo('product.category','create',[{name:parentName, parent_id:rootId}]);
      log(c.g(`  ✓ ${parentName.padEnd(42)} created #${cid}`));
    }
    catIds[parentName] = cid;
  }

  // 3. product.product records
  let created=0, skipped=0;
  for (const [parentName, {items=[]}] of Object.entries(TAXONOMY)) {
    const categ = catIds[parentName];
    for (const itemName of items) {
      // Unique by (name, categ_id). Archived counts as exists-skip.
      const existing = await odoo('product.product','search_read',
        [[['name','=',itemName],['categ_id','=',categ]]],
        {fields:['id','active'], limit:1, context:{active_test:false}});
      if (existing.length) {
        skipped++;
        // Re-activate if archived
        if (!existing[0].active && !DRY) {
          await odoo('product.product','write',[[existing[0].id],{active:true}]);
        }
        continue;
      }
      if (DRY) { created++; continue; }
      await odoo('product.product','create',[{
        name: itemName,
        categ_id: categ,
        type: 'service',
        can_be_expensed: true,
        purchase_ok: false,
        sale_ok: false,
        list_price: 0,
        uom_id: state.unitUom.id,
      }]);
      created++;
    }
  }
  log(`  products: ${c.g('created '+created)}  ${c.d('skipped(existing) '+skipped)}`);
  return { rootId, catIds };
}

// ─── PHASE D: CUSTOM FIELDS ────────────────────────────────────────────────
async function customFields(state) {
  head('PHASE D — CUSTOM FIELDS ON hr.expense');

  const modelId = state.hrExpModel.id;
  const fields = [
    { name:'x_payment_method', ttype:'selection',
      selection:"[('cash','Cash'),('hdfc_bank','HDFC Bank'),('federal_bank','Federal Bank'),('paytm_upi','Paytm UPI'),('razorpay','Razorpay'),('petty_pool','Petty Pool'),('counter_pool','Counter Pool')]",
      field_description:'Payment Method' },
    { name:'x_pool', ttype:'selection',
      selection:"[('counter','Counter (police)'),('petty','Petty (kitchen)'),('formal','Formal (>₹2000)'),('capex','Capex'),('owner_drawing','Owner Drawing')]",
      field_description:'Approval Pool' },
    { name:'x_location', ttype:'selection',
      selection:"[('he_koramangala','HE Koramangala'),('nch_koramangala','NCH Koramangala'),('hq','HQ'),('other','Other')]",
      field_description:'Location' },
    { name:'x_excluded_from_pnl', ttype:'boolean',
      field_description:'Excluded from P&L (Owner Drawings)' },
  ];

  for (const f of fields) {
    const existing = await odoo('ir.model.fields','search',
      [[['model','=','hr.expense'],['name','=',f.name]]], {limit:1});
    if (existing.length) { log(c.d(`  • ${f.name.padEnd(22)} exists #${existing[0]}`)); continue; }
    if (DRY) { log(c.y(`  + ${f.name.padEnd(22)} (dry) would create`)); continue; }
    const payload = {
      name: f.name,
      model_id: modelId,
      ttype: f.ttype,
      state: 'manual',
      field_description: f.field_description,
      store: true,
    };
    if (f.selection) payload.selection = f.selection;
    const fid = await odoo('ir.model.fields','create',[payload]);
    log(c.g(`  ✓ ${f.name.padEnd(22)} created #${fid}  (${f.ttype})`));
  }
}

// ─── PHASE E: VERIFY ───────────────────────────────────────────────────────
async function verify() {
  head('PHASE E — VERIFY');
  if (DRY) { log(c.d('  (dry-run — skipped; no records to verify)')); return; }

  // Read back the tree
  const root = await odoo('product.category','search_read',
    [[['name','=','HN Hotels Expenses']]], {fields:['id','name','complete_name','child_id'],limit:1});
  if (!root.length) { log(c.r('  root not found — something went wrong')); return; }
  log(`  Root: ${c.g(JSON.stringify(root[0]))}`);

  const children = await odoo('product.category','search_read',
    [[['parent_id','=',root[0].id]]], {fields:['id','name']});
  log(`  Level-1 children: ${c.g(children.length)}`);
  children.forEach(ch=>log(c.d(`    #${ch.id}  ${ch.name}`)));

  const products = await odoo('product.product','search_count',
    [[['can_be_expensed','=',true],['categ_id','child_of',root[0].id]]]);
  log(`  Expensable products under root: ${c.g(products)}`);

  // Read back custom fields
  const customFields = await odoo('ir.model.fields','search_read',
    [[['model','=','hr.expense'],['name','like','x_']]], {fields:['name','ttype','field_description']});
  log(`  Custom fields on hr.expense: ${c.g(customFields.length)}`);
  customFields.forEach(f=>log(c.d(`    ${f.name.padEnd(22)} ${f.ttype.padEnd(12)} "${f.field_description}"`)));
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
(async () => {
  console.log(c.b(`\n╔════════════════════════════════════════════════════════════════════════╗`));
  console.log(c.b(`║  HN Hotels — Odoo Expense Master Skeleton ${(DRY?'(DRY-RUN)':'(LIVE)').padEnd(30)}║`));
  console.log(c.b(`║  Target: ${ODOO_URL}  DB: ${ODOO_DB}  UID: ${ODOO_UID}                  ║`));
  console.log(c.b(`╚════════════════════════════════════════════════════════════════════════╝`));

  try {
    const state = await discover();
    await archiveDemo(state);
    await buildTree(state);
    await customFields(state);
    await verify();
    console.log('\n'+c.g(c.b('✓ ALL PHASES COMPLETE.'))+'\n');
  } catch (err) {
    console.error('\n'+c.r(c.b('✗ FAILED:'))+' '+err.message);
    process.exit(1);
  }
})();
