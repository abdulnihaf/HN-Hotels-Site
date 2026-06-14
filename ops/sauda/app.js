/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * SAUDA — the placing screen.
 * Blank every morning. Zoya searches items → each drops into its vendor basket
 * (the catalog already knows the vendor + fulfilment + pay). She sets qty, hits
 * Place → one order per vendor is written. Nothing is pre-loaded.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
(function () {
  'use strict';
  var SKEY = 'sauda_session';
  var gate = document.getElementById('gate'),
      app = document.getElementById('app'),
      dots = document.querySelectorAll('#pinDots span'),
      errEl = document.getElementById('pinErr');
  var pin = '', busy = false;

  var S = { token: null, user: '', role: '', cat: null, brand: 'both', order: [] /* lines */, seq: 0 };

  // ── token / session ──
  function tokenExp(t){ try{ var b=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(b.length%4)b+='='; return (JSON.parse(atob(b)).exp||0)*1000; }catch(e){ return 0; } }
  function loadSession(){ try{ var s=JSON.parse(sessionStorage.getItem(SKEY)||'null'); if(s&&s.token&&tokenExp(s.token)>Date.now()) return s; }catch(e){} return null; }
  function api(action, opts){
    opts = opts || {};
    var headers = { 'content-type':'application/json' };
    if (S.token) headers['x-darbar-token'] = S.token;
    return fetch('/api/sauda?action='+action, { method: opts.method||'GET', headers: headers, body: opts.body?JSON.stringify(opts.body):undefined })
      .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); });
  }

  // ── PIN gate ──
  function renderDots(){ for(var i=0;i<dots.length;i++) dots[i].classList.toggle('on', i<pin.length); }
  function fail(m){ errEl.textContent=m||'Wrong code'; gate.classList.add('shake'); setTimeout(function(){gate.classList.remove('shake');},440); pin=''; renderDots(); }
  function press(k){
    if(busy) return; errEl.textContent='';
    if(k==='del'){ pin=pin.slice(0,-1); renderDots(); return; }
    if(pin.length>=4) return;
    pin+=k; renderDots();
    if(pin.length===4) submitPin();
  }
  function submitPin(){
    busy=true; var code=pin;
    api('auth',{method:'POST',body:{pin:code}}).then(function(res){
      busy=false;
      if(!res.ok||!res.j||!res.j.token){ fail(res.j&&res.j.error==='invalid PIN'?'Code not recognised':'Try again'); return; }
      S.token=res.j.token; S.user=res.j.user; S.role=res.j.role;
      try{ sessionStorage.setItem(SKEY, JSON.stringify({token:S.token,user:S.user,role:S.role})); }catch(e){}
      enter();
    }).catch(function(){ busy=false; fail('No connection'); });
  }

  // ── enter app ──
  function enter(){
    gate.classList.add('hide'); app.classList.remove('hide');
    document.getElementById('topSub').textContent = S.user + ' · ' + fmtDate();
    loadCatalog();
  }
  function fmtDate(){ var d=new Date(Date.now()+330*60000); return d.toUTCString().slice(0,11); }

  function loadCatalog(){
    api('catalog').then(function(res){
      if(!res.ok){ toast(res.j&&res.j.error||'catalog failed','err'); return; }
      S.cat = res.j;
      renderOrder();
    }).catch(function(){ toast('No connection','err'); });
  }

  // ── search ──
  var searchInput = document.getElementById('searchInput');
  var suggEl = document.getElementById('sugg');
  searchInput.addEventListener('input', onSearch);
  searchInput.addEventListener('focus', onSearch);
  document.addEventListener('click', function(e){ if(!e.target.closest('.search')) hideSugg(); });

  function brandMatch(b){ return S.brand==='both' || !b || b==='both' || b===S.brand; }
  function onSearch(){
    var q=(searchInput.value||'').trim().toLowerCase();
    if(!S.cat){ hideSugg(); return; }
    if(!q){ hideSugg(); return; }
    var hits = S.cat.flat.filter(function(it){ return it.name.toLowerCase().indexOf(q)>=0 && brandMatch(it.brand); }).slice(0,12);
    var html = hits.map(function(it){
      return '<div class="s" data-add=\''+esc(JSON.stringify(it))+'\'><span class="nm">'+esc(it.name)+'</span><span class="vn">'+esc(it.vendorName||'')+'</span></div>';
    }).join('');
    // always offer add-new
    html += '<div class="s add" data-new="'+esc(searchInput.value.trim())+'"><span class="nm">+ Add "'+esc(searchInput.value.trim())+'" as a new item</span></div>';
    suggEl.innerHTML = html; suggEl.classList.remove('hide');
  }
  function hideSugg(){ suggEl.classList.add('hide'); }
  suggEl.addEventListener('click', function(e){
    var s=e.target.closest('.s'); if(!s) return;
    if(s.dataset.add){ var it=JSON.parse(s.dataset.add); addLine(it); }
    else if(typeof s.dataset.new==='string'){ openAddNew(s.dataset.new); }
    searchInput.value=''; hideSugg(); searchInput.blur();
  });

  // ── order model ──
  function addLine(it){
    S.order.push({ id:++S.seq, item:it.name, qty:'', unit:it.unit||'', vendorKey:it.vendorKey||'unassigned', vendorName:it.vendorName||'Unassigned', brand:it.brand||'both' });
    renderOrder(); toast(it.name+' added','info');
  }
  function removeLine(id){ S.order=S.order.filter(function(l){return l.id!==id;}); renderOrder(); }
  function setQty(id,v){ var l=S.order.find(function(x){return x.id===id;}); if(l) l.qty=v; updatePlaceBtn(); }

  function vendorMeta(key){ var v=(S.cat&&S.cat.vendors||[]).find(function(x){return x.key===key;}); return v||{key:key,name:key,fulfilment:'deliver',pay:'per',fulfilmentLabel:'delivers',payLabel:'pay per order'}; }

  // ── render the baskets ──
  function renderOrder(){
    var host=document.getElementById('baskets');
    var empty=document.getElementById('emptyState');
    if(!S.order.length){ host.innerHTML=''; empty.classList.remove('hide'); updatePlaceBtn(); return; }
    empty.classList.add('hide');
    // group by vendor
    var groups={};
    S.order.forEach(function(l){ (groups[l.vendorKey]=groups[l.vendorKey]||[]).push(l); });
    var html='';
    Object.keys(groups).forEach(function(vk){
      var v=vendorMeta(vk); var lines=groups[vk];
      html+='<div class="basket"><div class="bh"><span class="bn">'+esc(v.name)+'</span>'+
        '<span class="tag f">'+esc(v.fulfilmentLabel||v.fulfilment)+'</span>'+
        '<span class="tag p">'+esc(v.payLabel||v.pay)+'</span></div>';
      if(v.pay==='khata_roll'){
        html+='<div class="khata"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>'+
          '<span>On this trip, clear <b>yesterday’s bill</b>. Today’s items are paid tomorrow.</span></div>';
      }
      lines.forEach(function(l){
        html+='<div class="line"><div class="ln">'+esc(l.item)+(l.brand&&l.brand!=='both'?' <span class="lb">'+esc(l.brand)+'</span>':'')+'</div>'+
          '<div class="qty"><input inputmode="decimal" value="'+esc(l.qty)+'" data-q="'+l.id+'" placeholder="qty"><span class="u">'+esc(l.unit||'')+'</span></div>'+
          '<button class="x" data-x="'+l.id+'" aria-label="remove">×</button></div>';
      });
      html+='</div>';
    });
    host.innerHTML=html;
    host.querySelectorAll('input[data-q]').forEach(function(inp){ inp.addEventListener('input',function(){ setQty(+inp.dataset.q, inp.value); }); });
    host.querySelectorAll('button[data-x]').forEach(function(b){ b.addEventListener('click',function(){ removeLine(+b.dataset.x); }); });
    updatePlaceBtn();
  }
  function updatePlaceBtn(){
    var btn=document.getElementById('placeBtn');
    var n=S.order.length;
    var vendors=Object.keys(S.order.reduce(function(a,l){a[l.vendorKey]=1;return a;},{})).length;
    btn.disabled=!n; btn.textContent=n?('Place '+vendors+' vendor order'+(vendors>1?'s':'')+' · '+n+' item'+(n>1?'s':'')):'Place order';
  }

  // ── add-new-item sheet ──
  function openAddNew(name){
    var vlist=(S.cat&&S.cat.vendors||[]).filter(function(v){return v.key!=='unassigned';});
    var opts=vlist.map(function(v){return '<option value="'+esc(v.key)+'">'+esc(v.name)+'</option>';}).join('');
    var h='<div class="ov" id="ov"><div class="sheet"><h2>Add a new item</h2>'+
      '<div class="fld"><label>Item</label><input id="anName" value="'+esc(name)+'"></div>'+
      '<div class="fld"><label>Vendor</label><select id="anVendor">'+opts+'<option value="unassigned">— not sure / decide later</option></select></div>'+
      '<div class="fld"><label>Unit</label><input id="anUnit" placeholder="kg, pc, bora, packet…"></div>'+
      '<button class="btn primary" id="anAdd" style="width:100%">Add to order</button></div></div>';
    var host=document.getElementById('sheetHost'); host.innerHTML=h;
    document.getElementById('ov').addEventListener('click',function(e){ if(e.target.id==='ov') host.innerHTML=''; });
    document.getElementById('anAdd').addEventListener('click',function(){
      var nm=document.getElementById('anName').value.trim(); if(!nm){return;}
      var vk=document.getElementById('anVendor').value; var v=vendorMeta(vk);
      addLine({ name:nm, unit:document.getElementById('anUnit').value.trim(), vendorKey:vk, vendorName:v.name, brand:S.brand });
      host.innerHTML='';
    });
  }

  // ── place ──
  document.getElementById('placeBtn').addEventListener('click', function(){
    if(!S.order.length||busy) return;
    var bad=S.order.filter(function(l){ return String(l.qty).trim()===''; });
    if(bad.length && !confirm(bad.length+' item(s) have no quantity. Place anyway? (vendor will fill)')) return;
    busy=true; var btn=this; btn.disabled=true; btn.textContent='Placing…';
    var lines=S.order.map(function(l){ return { item:l.item, qty:l.qty, unit:l.unit, vendorKey:l.vendorKey, brand:l.brand }; });
    api('place',{method:'POST',body:{ lines:lines }}).then(function(res){
      busy=false;
      if(!res.ok||!res.j||!res.j.ok){ toast(res.j&&res.j.error||'Place failed','err'); updatePlaceBtn(); return; }
      toast('Placed '+res.j.placed+' vendor order'+(res.j.placed>1?'s':''),'ok');
      S.order=[]; renderOrder();
    }).catch(function(){ busy=false; toast('No connection','err'); updatePlaceBtn(); });
  });

  // ── brand toggle ──
  document.getElementById('brandSeg').addEventListener('click', function(e){
    var b=e.target.closest('button[data-b]'); if(!b) return;
    S.brand=b.dataset.b;
    this.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on', x===b); });
    onSearch();
  });

  // ── misc ──
  function lock(){ try{ sessionStorage.removeItem(SKEY); }catch(e){} S={token:null,user:'',role:'',cat:null,brand:'both',order:[],seq:0}; pin=''; renderDots(); app.classList.add('hide'); gate.classList.remove('hide'); }
  document.getElementById('lock').addEventListener('click', lock);
  function toast(msg,kind){ var h=document.getElementById('toastHost'); h.innerHTML='<div class="toast '+(kind||'info')+'">'+esc(msg)+'</div>'; setTimeout(function(){h.innerHTML='';},2200); }
  function esc(s){ return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  document.getElementById('keypad').addEventListener('click', function(e){ var b=e.target.closest('button[data-k]'); if(b) press(b.getAttribute('data-k')); });
  document.addEventListener('keydown', function(e){ if(!app.classList.contains('hide')) return; if(e.key>='0'&&e.key<='9') press(e.key); else if(e.key==='Backspace') press('del'); });

  var existing=loadSession();
  if(existing){ S.token=existing.token; S.user=existing.user; S.role=existing.role; enter(); } else renderDots();
})();
