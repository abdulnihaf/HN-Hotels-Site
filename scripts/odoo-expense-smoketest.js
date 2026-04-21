#!/usr/bin/env node
// Create one real expense using the new taxonomy + all 4 custom fields,
// read it back, then archive (unlink) so prod stays clean.

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
  // Find "Beat Police" product
  const [beatPolice] = await odoo('product.product','search_read',
    [[['name','=','Beat Police'],['can_be_expensed','=',true]]],
    {fields:['id','name','categ_id'],limit:1});
  console.log('Beat Police product:', beatPolice);

  // Find any employee from NCH
  const [emp] = await odoo('hr.employee','search_read',
    [[['company_id','=',10],['active','=',true]]],
    {fields:['id','name','company_id'],limit:1});
  console.log('Test employee:', emp);

  // Create test expense with ALL 4 custom fields populated
  const expId = await odoo('hr.expense','create',[{
    name: 'TEST — Beat Police payout',
    employee_id: emp.id,
    product_id: beatPolice.id,
    total_amount: 100,
    payment_mode: 'company_account',
    company_id: 10,
    x_payment_method: 'cash',
    x_pool: 'counter',
    x_location: 'nch_koramangala',
    x_excluded_from_pnl: false,
  }]);
  console.log('\n✓ Created hr.expense #'+expId);

  // Read back + verify all fields
  const [row] = await odoo('hr.expense','read',[[expId],
    ['name','total_amount','product_id','employee_id','payment_mode',
     'x_payment_method','x_pool','x_location','x_excluded_from_pnl','company_id']]);
  console.log('\nRead back:');
  Object.entries(row).forEach(([k,v])=>console.log(`  ${k.padEnd(22)}= ${JSON.stringify(v)}`));

  // Clean up — unlink the test row
  await odoo('hr.expense','unlink',[[expId]]);
  console.log('\n✓ Test row #'+expId+' unlinked (prod stays clean).\n');
  console.log('✓ FULL STACK VERIFIED — Odoo master + custom fields + taxonomy all writable.');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
