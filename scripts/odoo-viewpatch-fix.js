#!/usr/bin/env node
// Fix view #2616: x_ fields got inserted INSIDE div#payment_mode (no labels rendered).
// Re-anchor to insert AFTER the whole div#payment_mode wrapper instead. Also wrap in
// an explicit group so they get proper 2-col label/input layout.

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
  // Anchor on the div that wraps payment_mode (Odoo uses <div id="payment_mode">...</div>
  // inside an outer group). Inserting AFTER that div keeps our fields in the same group
  // with proper label + input layout.
  const arch = `<?xml version="1.0"?>
<data>
  <xpath expr="//div[@id='payment_mode']" position="after">
    <label for="x_payment_method"/>
    <div><field name="x_payment_method"/></div>
    <label for="x_pool"/>
    <div><field name="x_pool"/></div>
    <label for="x_location"/>
    <div><field name="x_location"/></div>
    <label for="x_excluded_from_pnl"/>
    <div><field name="x_excluded_from_pnl"/></div>
    <label for="x_submitted_by"/>
    <div><field name="x_submitted_by" readonly="1"/></div>
  </xpath>
</data>`;

  await odoo('ir.ui.view','write',[[2616],{arch_base: arch, active: true}]);
  console.log('✓ updated view #2616 arch to anchor outside div#payment_mode');

  // Verify combined arch from server
  const gv = await odoo('hr.expense','get_view',[],{view_type:'form'});
  const a = gv.arch || '';
  const idx = a.indexOf('x_payment_method');
  if (idx < 0) { console.log('✗ x_payment_method NOT in combined arch'); process.exit(1); }
  console.log('✓ x_payment_method found in combined arch');
  console.log('context:');
  console.log(a.slice(Math.max(0, idx-160), idx+500));
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
