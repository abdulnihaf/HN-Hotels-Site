#!/usr/bin/env node
// Check view #2584 (primary form that inherits from #2583). It's highest priority
// so it's likely the actual rendered form. My extension targets #2583 which means
// it may not apply cleanly to #2584 if #2584 removes payment_mode.

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
  const v = await odoo('ir.ui.view','read',
    [[2584],['name','arch','mode','inherit_id','priority']]);
  console.log('── view #2584 ──');
  console.log('name:', v[0].name, 'mode:', v[0].mode, 'priority:', v[0].priority);
  console.log('inherit_id:', v[0].inherit_id);
  console.log('ARCH:');
  console.log(v[0].arch);

  // Also get_view for the primary form — this is what the client actually uses
  console.log('\n── get_view(view_type=\'form\') — combined arch Odoo actually renders ──');
  try {
    const gv = await odoo('hr.expense','get_view',[],{view_type:'form'});
    // write first 5000 chars of arch
    const a = gv.arch || '';
    console.log('combined arch length:', a.length);
    console.log('payment_mode present?', a.includes("name=\"payment_mode\""));
    console.log('x_payment_method present?', a.includes("x_payment_method"));
    console.log('x_pool present?', a.includes("x_pool"));
    // Show surrounding context if x_ is present
    const idx = a.indexOf('x_payment_method');
    if (idx >= 0) {
      console.log('context around x_payment_method:');
      console.log(a.slice(Math.max(0, idx-200), idx+400));
    } else {
      console.log('x_payment_method NOT FOUND in combined arch — inheritance did NOT apply');
    }
  } catch(e) {
    console.log('get_view error:', e.message);
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
