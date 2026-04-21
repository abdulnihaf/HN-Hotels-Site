#!/usr/bin/env node
// Two cleanups in one pass:
//   1. Archive the legacy "Travel & Accommodation" expense product (Odoo stock demo)
//   2. Patch hr.expense form view via ir.ui.view inheritance so the 5 custom x_ fields
//      (x_payment_method, x_pool, x_location, x_excluded_from_pnl, x_submitted_by)
//      are visible + editable in the native Odoo UI for Yash/Zoya/admin.
// Idempotent: both steps check for existing state first.

const URL='https://ops.hamzahotel.com/jsonrpc', DB='main', UID=2,
      KEY='88eb49c5e7e5e3695d467ed086f3517c10a2251c';

async function odoo(model, method, args=[], kwargs={}) {
  const r = await fetch(URL,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',method:'call',
      params:{service:'object',method:'execute_kw',
              args:[DB,UID,KEY,model,method,args,kwargs]}})});
  const j = await r.json();
  if (j.error) throw new Error(j.error.data?.message||j.error.message);
  return j.result;
}

(async () => {
  console.log('════════════════════════════════════════');
  console.log(' STEP 1: Archive Travel & Accommodation');
  console.log('════════════════════════════════════════');
  const ta = await odoo('product.product','search_read',
    [[['name','=','Travel & Accommodation']]],
    {fields:['id','name','active','can_be_expensed'], limit:5});
  if (!ta.length) {
    console.log('  (not found — already gone)');
  } else {
    for (const p of ta) {
      if (!p.active) { console.log(`  #${p.id} ${p.name} already inactive`); continue; }
      await odoo('product.product','write',[[p.id],{active:false}]);
      console.log(`  ✓ archived product.product #${p.id} "${p.name}"`);
    }
  }

  console.log('\n════════════════════════════════════════');
  console.log(' STEP 2: Inherit hr.expense form to show x_* fields');
  console.log('════════════════════════════════════════');

  const VIEW_NAME = 'hn.hr.expense.form.custom.fields';
  const existing = await odoo('ir.ui.view','search_read',
    [[['name','=',VIEW_NAME]]], {fields:['id','name','active'], limit:1});

  if (existing.length) {
    console.log(`  view "${VIEW_NAME}" already exists (id=${existing[0].id}) — updating arch`);
  }

  // Look up parent hr.expense form view
  const parents = await odoo('ir.ui.view','search_read',
    [[['model','=','hr.expense'],['type','=','form'],['inherit_id','=',false]]],
    {fields:['id','name','arch','type'], limit:5});
  if (!parents.length) throw new Error('Could not locate native hr.expense form view to inherit from');
  const parent = parents[0];
  console.log(`  parent form view: #${parent.id} "${parent.name}"`);

  // XPath inheritance: add a new group after the "Paid By" radio, showing our 5 fields.
  // Odoo's hr.expense form has a field named "payment_mode" — anchor after it so the
  // new fields appear right below the existing Paid By choice.
  const arch = `<?xml version="1.0"?>
<data>
  <xpath expr="//field[@name='payment_mode']" position="after">
    <field name="x_payment_method" string="Payment Method"/>
    <field name="x_pool" string="Pool"/>
    <field name="x_location" string="Location"/>
    <field name="x_excluded_from_pnl" string="Exclude from P&amp;L"/>
    <field name="x_submitted_by" string="Submitted By" readonly="1"/>
  </xpath>
</data>`;

  let viewId;
  if (existing.length) {
    await odoo('ir.ui.view','write',[[existing[0].id],{
      arch_base: arch, active: true,
    }]);
    viewId = existing[0].id;
    console.log(`  ✓ updated inherited view #${viewId}`);
  } else {
    viewId = await odoo('ir.ui.view','create',[{
      name: VIEW_NAME,
      model: 'hr.expense',
      inherit_id: parent.id,
      arch_base: arch,
      type: 'form',
      priority: 99,
      active: true,
    }]);
    console.log(`  ✓ created inherited view #${viewId}`);
  }

  // Verify fields resolve
  const check = await odoo('ir.ui.view','read',[[viewId],['name','inherit_id','active','arch']]);
  console.log(`  active=${check[0].active}  inherit_id=${JSON.stringify(check[0].inherit_id)}`);

  console.log('\n✓ Both cleanups applied. Refresh Odoo browser tab to see x_* fields on the expense form.');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
