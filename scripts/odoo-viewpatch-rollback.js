#!/usr/bin/env node
// Rollback: deactivate view #2616 so hr.expense form renders again.
// x_* fields remain writable via RPC from the HN /ops/finance dashboard.
// Admins edit x_ fields via Odoo Studio form editor later if desired.

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
  await odoo('ir.ui.view','write',[[2616],{active: false}]);
  const v = await odoo('ir.ui.view','read',[[2616],['active','name']]);
  console.log('✓ view #2616 active=', v[0].active, '— native form restored');
  console.log('  x_* fields remain writable via RPC from dashboard');
  console.log('  Travel & Accommodation archive intact');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
