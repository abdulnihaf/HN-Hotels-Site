#!/usr/bin/env node
// Diagnose why view #2616 (hn.hr.expense.form.custom.fields) isn't rendering x_ fields.
// Steps:
//   1. Read view #2616 to confirm arch parsed and what fields exist
//   2. Read parent view #2583 arch to find the REAL anchor we can use
//   3. Check available hr.expense fields so we pick a real anchor name

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
  console.log('── inherited view #2616 ──');
  const child = await odoo('ir.ui.view','read',
    [[2616],['name','arch','arch_base','active','inherit_id','model','priority']]);
  console.log(JSON.stringify(child[0], null, 2));

  console.log('\n── parent view #2583 arch (search for payment_mode / total_amount / group anchors) ──');
  const parent = await odoo('ir.ui.view','read',
    [[2583],['name','arch','model']]);
  const arch = parent[0].arch || '';
  // Extract field names to find a real anchor
  const fieldNames = [...arch.matchAll(/<field\s+name="([^"]+)"/g)].map(m=>m[1]);
  console.log('fields declared in parent arch (first 30):', fieldNames.slice(0,30));
  console.log('payment_mode present?', fieldNames.includes('payment_mode'));
  console.log('total_amount present?', fieldNames.includes('total_amount'));
  console.log('employee_id present?', fieldNames.includes('employee_id'));
  console.log('product_id present?', fieldNames.includes('product_id'));

  console.log('\n── hr.expense model fields (filtered for x_ and candidates) ──');
  const fields = await odoo('hr.expense','fields_get',[],{attributes:['string','type']});
  const xs = Object.keys(fields).filter(k=>k.startsWith('x_'));
  console.log('x_ fields on model:', xs);
  const candidates = ['payment_mode','total_amount','employee_id','product_id','name'];
  for (const c of candidates) {
    if (fields[c]) console.log(`  ${c}: ${fields[c].type} — "${fields[c].string}"`);
    else console.log(`  ${c}: MISSING from model`);
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
