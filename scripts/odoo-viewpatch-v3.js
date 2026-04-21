#!/usr/bin/env node
// Try a safe arch shape: add a NEW <group> sibling AFTER the inner group that
// holds payment_mode. Use the parent <group> as anchor via xpath position=after.
// If this still breaks the form, deactivate view #2616 so rendering restores.

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

// Find where to anchor — we need a known structural element. Use the OUTER
// group that contains payment_mode. We'll anchor "inside position=inside" on
// the enclosing <sheet> with a brand new group tag.
const arch = `<?xml version="1.0"?>
<data>
  <xpath expr="//sheet" position="inside">
    <group string="HN Custom Fields">
      <field name="x_payment_method"/>
      <field name="x_pool"/>
      <field name="x_location"/>
      <field name="x_excluded_from_pnl"/>
      <field name="x_submitted_by" readonly="1"/>
    </group>
  </xpath>
</data>`;

(async () => {
  try {
    await odoo('ir.ui.view','write',[[2616],{arch_base: arch, active: true}]);
    console.log('✓ updated view #2616 with sheet-inside pattern');
    // Validate combined arch
    const gv = await odoo('hr.expense','get_view',[],{view_type:'form'});
    const a = gv.arch || '';
    const ok = a.includes('x_payment_method') && a.includes('x_pool');
    if (!ok) throw new Error('x_ fields missing from combined arch');
    console.log('✓ x_ fields present in combined arch — form should now render them in a new group inside the sheet');
  } catch (e) {
    console.error('✗ view write failed:', e.message);
    console.error('  deactivating view #2616 so form rendering recovers');
    await odoo('ir.ui.view','write',[[2616],{active: false}]);
    console.log('✓ view #2616 deactivated — form UI restored, x_ fields editable via dashboard only');
    process.exit(1);
  }
})();
