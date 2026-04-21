#!/usr/bin/env node
// Find ALL hr.expense form views — the /odoo/expenses/new page may be rendering
// a different form than view #2583. Also check for /odoo/expenses action defs.

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
  console.log('── ALL hr.expense FORM views (any inherit level) ──');
  const forms = await odoo('ir.ui.view','search_read',
    [[['model','=','hr.expense'],['type','=','form']]],
    {fields:['id','name','inherit_id','active','priority','xml_id','mode'],
     order:'priority,id'});
  for (const f of forms) {
    const parent = f.inherit_id ? `(inherit of #${f.inherit_id[0]} "${f.inherit_id[1]}")` : '(ROOT)';
    console.log(`  #${f.id} p=${f.priority} active=${f.active} mode=${f.mode || '-'} "${f.name}" ${parent}`);
  }

  console.log('\n── ir.actions.act_window for hr.expense ──');
  const acts = await odoo('ir.actions.act_window','search_read',
    [[['res_model','=','hr.expense']]],
    {fields:['id','name','view_mode','view_id','views'], limit:20});
  for (const a of acts) {
    console.log(`  act #${a.id} "${a.name}" view_mode=${a.view_mode} view_id=${JSON.stringify(a.view_id)} views=${JSON.stringify(a.views)}`);
  }

  console.log('\n── menu items pointing at hr.expense ──');
  const menus = await odoo('ir.ui.menu','search_read',
    [[['action','like','hr.expense']]],
    {fields:['id','name','action','parent_id'], limit:20});
  for (const m of menus) {
    console.log(`  menu #${m.id} "${m.name}" action=${m.action} parent=${JSON.stringify(m.parent_id)}`);
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
