#!/usr/bin/env node
// Idempotent: add x_submitted_by (char) to hr.expense so dashboards can stamp
// the real human who logged the expense, even when admin key writes it.

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
  const [hrExpenseModel] = await odoo('ir.model','search_read',
    [[['model','=','hr.expense']]], {fields:['id','name'], limit:1});
  console.log('hr.expense ir.model id =', hrExpenseModel.id);

  const existing = await odoo('ir.model.fields','search_read',
    [[['model','=','hr.expense'],['name','=','x_submitted_by']]],
    {fields:['id','name','ttype','state']});

  if (existing.length) {
    console.log('✓ x_submitted_by already exists (id='+existing[0].id+') — no-op.');
    return;
  }

  const fid = await odoo('ir.model.fields','create',[{
    name: 'x_submitted_by',
    field_description: 'Submitted By (dashboard)',
    model_id: hrExpenseModel.id,
    model: 'hr.expense',
    ttype: 'char',
    state: 'manual',
    store: true,
    help: 'Human who logged this expense in the HN ops dashboard (e.g. "yash", "zoya", "faheem"). Written by the Worker even though the admin API key performs the create.',
  }]);
  console.log('✓ Created x_submitted_by field id='+fid);

  // Verify end-to-end with a throwaway expense
  const [beatPolice] = await odoo('product.product','search_read',
    [[['name','=','Beat Police']]], {fields:['id'], limit:1});
  const [emp] = await odoo('hr.employee','search_read',
    [[['company_id','=',10]]], {fields:['id'], limit:1});

  const expId = await odoo('hr.expense','create',[{
    name: 'TEST — x_submitted_by smoke',
    employee_id: emp.id, product_id: beatPolice.id,
    total_amount: 1, payment_mode: 'company_account', company_id: 10,
    x_submitted_by: 'yash',
  }]);
  const [row] = await odoo('hr.expense','read',[[expId],['name','x_submitted_by']]);
  console.log('  smoke row:', row);
  await odoo('hr.expense','unlink',[[expId]]);
  console.log('✓ Round-trip OK, test row unlinked.');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
