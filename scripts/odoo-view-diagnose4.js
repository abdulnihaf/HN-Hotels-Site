#!/usr/bin/env node
// Inheritance IS working server-side (get_view confirms x_ fields in combined arch).
// Browser is showing stale UI — bust view cache + check x_ field types / selection values.

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
  const fields = await odoo('ir.model.fields','search_read',
    [[['model','=','hr.expense'],['name','like','x_']]],
    {fields:['id','name','ttype','selection','field_description','required','readonly','store']});
  console.log('── x_ fields on hr.expense ──');
  for (const f of fields) {
    console.log(`  #${f.id} ${f.name} type=${f.ttype} store=${f.store} label="${f.field_description}"`);
    if (f.ttype === 'selection') console.log(`    selection=${f.selection}`);
  }

  // Bump view priority to force cache bust
  console.log('\n── bumping view #2616 priority to force cache bust ──');
  await odoo('ir.ui.view','write',[[2616],{priority:100}]);
  const after = await odoo('ir.ui.view','read',[[2616],['priority']]);
  console.log('  new priority:', after[0].priority);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
