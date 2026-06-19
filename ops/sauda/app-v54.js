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

  var S = { token: null, user: '', role: '', cat: null, brand: 'both', order: [] /* lines */, seq: 0,
            placeDate: defaultPurchaseDateIST(), hist: { date: defaultPurchaseDateIST() },
            hp: { feed: [], win: null, fresh: '', stale: false, picked: {} /* item_key -> 'opened'|'added' */, chosen: {} /* item_key -> picked SKU override */, collapsed: { dearer: true, nomatch: true }, tick: null },
            cmp: { items: [], sources: {}, pick: {} /* item_key -> chosen source */ },
            buy: { qty: {} /* item_key -> qty */, when: defaultNeedWhen() /* today | tomorrow — decides feasible sources */ } };

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
    restoreWork();
    setMode('buy');
    loadCatalog();
    startPersist();
    // deep-link: a link ending ?go=settings (or #settings) opens straight to the Settings
    // price/vendor editor — so the manager can be sent one link + PIN and land there.
    try{ if(/settings/i.test(location.search + location.hash)) setMode('settings'); }catch(e){}
  }

  // ── persist in-progress work so a Safari/iOS reload never loses it ──
  function saveWork(){ try{ localStorage.setItem('sauda_work', JSON.stringify({
    order:S.order, seq:S.seq, placeDate:S.placeDate, histDate:S.hist.date, hpPicked:S.hp.picked, hpChosen:S.hp.chosen, cmpPick:S.cmp.pick, buyQty:S.buy.qty, buyWhen:S.buy.when })); }catch(e){} }
  function restoreWork(){ try{ var w=JSON.parse(localStorage.getItem('sauda_work')||'null'); if(!w) return;
    if(Array.isArray(w.order)) S.order=w.order; if(w.seq) S.seq=w.seq;
    if(w.placeDate) S.placeDate=w.placeDate; if(w.histDate) S.hist.date=w.histDate;
    if(w.hpPicked && typeof w.hpPicked==='object') S.hp.picked=w.hpPicked; if(w.hpChosen && typeof w.hpChosen==='object') S.hp.chosen=w.hpChosen;
    if(w.cmpPick) S.cmp.pick=w.cmpPick; if(w.buyQty) S.buy.qty=w.buyQty; if(w.buyWhen) S.buy.when=w.buyWhen; }catch(e){} }
  var _persist;
  function startPersist(){ if(_persist) return; _persist=setInterval(saveWork,3000);
    window.addEventListener('pagehide', saveWork);
    document.addEventListener('visibilitychange', function(){ if(document.hidden) saveWork(); }); }
  function fmtDate(){ var d=new Date(Date.now()+330*60000); return d.toUTCString().slice(0,11); }
  function ymdIST(offsetDays){ var d=new Date(Date.now()+330*60000+(offsetDays||0)*86400000); return d.toISOString().slice(0,10); }
  function defaultNeedWhen(){ var d=new Date(Date.now()+330*60000); return d.getUTCHours()>=18 ? 'tomorrow' : 'today'; }
  function defaultPurchaseDateIST(){ return ymdIST(defaultNeedWhen()==='tomorrow'?1:0); }
  function addDaysYmd(ymd, delta){
    var p=String(ymd||defaultPurchaseDateIST()).split('-');
    var d=p.length===3 ? new Date(+p[0], +p[1]-1, +p[2]) : new Date();
    d.setDate(d.getDate()+(delta||0));
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function loadCatalog(){
    api('catalog').then(function(res){
      if(!res.ok){ toast(res.j&&res.j.error||'catalog failed','err'); return; }
      S.cat = res.j;
      renderOrder(); renderVendorList();
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
    var hits = S.cat.flat.filter(function(it){ return (it.name+' '+(it.alias||'')).toLowerCase().indexOf(q)>=0 && brandMatch(it.brand); }).slice(0,12);
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
    S.order.push({ id:++S.seq, item:it.name, item_code:it.item_code||'', qty:'', price:(it.price_paise?String(it.price_paise/100):''), unit:it.unit||'', vendorKey:it.vendorKey||'unassigned', vendorName:it.vendorName||'Unassigned', brand:it.brand||'both', live:!!it.live });
    renderOrder(); toast(it.name+' added','info');
  }
  function removeLine(id){ S.order=S.order.filter(function(l){return l.id!==id;}); renderOrder(); }
  function setQty(id,v){ var l=S.order.find(function(x){return x.id===id;}); if(l) l.qty=v; updatePlaceBtn(); }
  function setPrice(id,v){ var l=S.order.find(function(x){return x.id===id;}); if(l) l.price=v; updatePlaceBtn(); }

  function vendorMeta(key){ var v=(S.cat&&S.cat.vendors||[]).find(function(x){return x.key===key;}); return v||{key:key,name:key,fulfilment:'deliver',pay:'per',fulfilmentLabel:'delivers',payLabel:'pay per order'}; }
  function dateTitle(d){
    var today=ymdIST(0), tom=ymdIST(1);
    if(d===today) return "Today's order";
    if(d===tom) return "Tomorrow's order";
    return 'Order · '+d;
  }
  function syncPlaceDate(){
    if(!S.placeDate) S.placeDate=defaultPurchaseDateIST();
    var el=document.getElementById('placeDate'); if(el) el.value=S.placeDate;
    var h1=document.querySelector('.top h1');
    if(h1 && document.querySelector('#modeSeg button[data-m="place"].on')) h1.textContent=dateTitle(S.placeDate);
  }
  function setPlaceDate(d){
    S.placeDate=(d||defaultPurchaseDateIST()).slice(0,10);
    syncPlaceDate();
    saveWork();
  }

  // ── render the baskets ──
  function renderOrder(){
    var host=document.getElementById('baskets');
    var empty=document.getElementById('emptyState');
    empty.classList.add('hide');
    if(!S.order.length){ host.innerHTML=''; renderVendorList(); updatePlaceBtn(); return; }
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
      var sub=0;
      lines.forEach(function(l){
        var qn=parseFloat((String(l.qty).match(/[\d.]+/)||[''])[0])||0, pr=parseFloat(l.price)||0; sub+=qn*pr;
        html+='<div class="line"><div class="lhead"><div class="ln">'+esc(l.item)+(l.brand&&l.brand!=='both'?' <span class="lb">'+esc(l.brand)+'</span>':'')+'</div>'+
          '<button class="x" data-x="'+l.id+'" aria-label="remove">×</button></div>'+
          '<div class="lf"><div class="ff"><label>Qty</label><input inputmode="decimal" value="'+esc(l.qty)+'" data-q="'+l.id+'" placeholder="qty"><span class="u">'+esc(l.unit||'')+'</span></div>'+
          '<div class="ff"><label>₹'+(l.unit?'/'+esc(l.unit):'')+(l.live?' · live':'')+'</label><input inputmode="decimal" value="'+esc(l.price||'')+'" data-p="'+l.id+'" placeholder="'+(l.live?'today’s rate':'rate')+'"></div></div></div>';
      });
      html+='<div class="bsub">basket ₹<b>'+(Math.round(sub).toLocaleString('en-IN'))+'</b></div>';
      html+='</div>';
    });
    host.innerHTML=html;
    host.querySelectorAll('input[data-q]').forEach(function(inp){ inp.addEventListener('input',function(){ setQty(+inp.dataset.q, inp.value); }); });
    host.querySelectorAll('input[data-p]').forEach(function(inp){ inp.addEventListener('input',function(){ setPrice(+inp.dataset.p, inp.value); }); });
    host.querySelectorAll('button[data-x]').forEach(function(b){ b.addEventListener('click',function(){ removeLine(+b.dataset.x); }); });
    renderVendorList();
    updatePlaceBtn();
  }
  function updatePlaceBtn(){
    var btn=document.getElementById('placeBtn');
    var n=S.order.length;
    var vendors=Object.keys(S.order.reduce(function(a,l){a[l.vendorKey]=1;return a;},{})).length;
    var tot=S.order.reduce(function(s,l){ var qn=parseFloat((String(l.qty).match(/[\d.]+/)||[''])[0])||0; return s+qn*(parseFloat(l.price)||0); },0);
    btn.disabled=!n;
    btn.textContent=n?('Place '+vendors+' order'+(vendors>1?'s':'')+(tot>0?' · ₹'+Math.round(tot).toLocaleString('en-IN'):' · '+n+' item'+(n>1?'s':''))):'Place order';
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

  // ── vendor-first: choose a vendor → add all its items in one go ──
  function renderVendorList(){
    var host=document.getElementById('vendorList'); if(!host) return;
    if(!S.cat||!S.cat.vendors){ host.innerHTML=''; return; }
    var vends=S.cat.vendors.filter(function(v){ return v.key!=='unassigned' && brandMatch(v.brand); });
    var counts={}; S.order.forEach(function(l){ counts[l.vendorKey]=(counts[l.vendorKey]||0)+1; });
    var html='<div class="vlist-h">Choose a vendor — add everything you’re buying from them</div>';
    html+=vends.map(function(v){
      var n=counts[v.key]||0;
      return '<div class="vrow'+(n?' has':'')+'" data-vendor="'+esc(v.key)+'">'+
        '<span class="vn">'+esc(v.name)+'</span>'+
        '<span class="tag f">'+esc(v.fulfilmentLabel||v.fulfilment)+'</span>'+
        '<span class="tag p">'+esc(v.payLabel||v.pay)+'</span>'+
        (n?'<span class="vcount">'+n+'</span>':'<span class="chev">›</span>')+'</div>';
    }).join('');
    host.innerHTML=html;
    host.querySelectorAll('.vrow[data-vendor]').forEach(function(r){ r.addEventListener('click',function(){ openVendorSheet(r.dataset.vendor); }); });
  }
  function vLineFor(key,nm){ return S.order.find(function(l){ return l.vendorKey===key && l.item.toLowerCase()===String(nm).toLowerCase(); }); }
  function vSetQty(key,item,qty){
    var l=vLineFor(key,item.name);
    if(qty>0){ if(l){ l.qty=qty; } else { S.order.push({ id:++S.seq, item:item.name, item_code:item.item_code||'', qty:qty, price:(item.price_paise?String(item.price_paise/100):''), unit:item.unit||'', vendorKey:key, vendorName:vendorMeta(key).name, brand:item.brand||S.brand, live:!!item.live }); } }
    else if(l){ S.order=S.order.filter(function(x){return x!==l;}); }
  }
  function openVendorSheet(key){
    var v=(S.cat&&S.cat.vendors||[]).find(function(x){return x.key===key;}); if(!v) return;
    var meta=vendorMeta(key);
    var host=document.getElementById('sheetHost');
    var focusName='';
    function draw(){
      var q=(document.getElementById('vSearch')&&document.getElementById('vSearch').value||'').trim().toLowerCase();
      var items=(v.items||[]).filter(function(it){
        var hay=((it.name||'')+' '+(it.alias||'')+' '+(it.note||'')).toLowerCase();
        return brandMatch(it.brand) && (!q || hay.indexOf(q)>=0);
      });
      var rows=items.map(function(it){
        var l=vLineFor(key,it.name); var inb=!!l; var q=(l&&String(l.qty).trim()!=='')?l.qty:(l?1:'');
        var ctrl = inb
          ? '<div class="step"><button data-vdec="'+esc(it.name)+'">−</button>'+
              '<input inputmode="decimal" data-vq="'+esc(it.name)+'" value="'+esc(String(q))+'"><button data-vinc="'+esc(it.name)+'">+</button></div>'
          : '<button class="add-pill" data-vadd="'+esc(it.name)+'">+</button>';
        return '<div class="vitem"><div class="vinm"><b>'+esc(it.name)+(it.brand&&it.brand!=='both'?' <span class="lb">'+esc(it.brand)+'</span>':'')+'</b>'+(it.unit?'<small>'+esc(it.unit)+'</small>':'')+'</div>'+ctrl+'</div>';
      }).join('');
      var khata = meta.pay==='khata_roll' ? '<div class="khata" style="margin:0 0 10px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg><span>On the trip, clear <b>yesterday’s bill</b>. Today’s items are paid tomorrow.</span></div>' : '';
      var h='<div class="ov" id="ov"><div class="sheet"><h2>'+esc(v.name)+'</h2>'+
        '<div class="skuhint">'+esc(meta.fulfilmentLabel)+' · '+esc(meta.payLabel)+' — tap the items you need today.</div>'+
        '<div class="fld" style="margin:12px 0 10px"><label>Search this vendor’s items</label><input id="vSearch" placeholder="Search items…"></div>'+khata+
        '<div class="vlist-sheet">'+(rows||'<div class="empty" style="padding:20px">No saved items — add one below.</div>')+'</div>'+
        '<div class="vnew"><input id="vNewName" placeholder="Add an item not listed…" autocomplete="off"><button id="vNewAdd">Add</button></div>'+
        '<button class="btn primary" id="vDone" style="width:100%;margin-top:12px">Done</button></div></div>';
      host.innerHTML=h;
      document.getElementById('ov').addEventListener('click',function(e){ if(e.target.id==='ov'){ host.innerHTML=''; renderOrder(); } });
      document.getElementById('vDone').addEventListener('click',function(){ host.innerHTML=''; renderOrder(); });
      var sv=document.getElementById('vSearch');
      if(sv){
        if(q) sv.value=q;
        sv.addEventListener('input',function(){ draw(); });
        if(!focusName) setTimeout(function(){ try{ sv.focus(); }catch(e){} }, 0);
      }
      function byName(nm){ return (v.items||[]).find(function(x){return x.name===nm;})||{name:nm,unit:'',brand:S.brand}; }
      host.querySelectorAll('[data-vadd]').forEach(function(b){ b.addEventListener('click',function(){ focusName=b.dataset.vadd; vSetQty(key, byName(b.dataset.vadd), 1); draw(); }); });
      host.querySelectorAll('[data-vinc]').forEach(function(b){ b.addEventListener('click',function(){ var l=vLineFor(key,b.dataset.vinc); var q=(l&&parseFloat(l.qty))||0; focusName=b.dataset.vinc; vSetQty(key, byName(b.dataset.vinc), Math.round((q+1)*100)/100); draw(); }); });
      host.querySelectorAll('[data-vdec]').forEach(function(b){ b.addEventListener('click',function(){ var l=vLineFor(key,b.dataset.vdec); var q=(l&&parseFloat(l.qty))||0; focusName=b.dataset.vdec; vSetQty(key, byName(b.dataset.vdec), Math.max(0,Math.round((q-1)*100)/100)); draw(); }); });
      host.querySelectorAll('input[data-vq]').forEach(function(inp){ inp.addEventListener('input',function(){ vSetQty(key, byName(inp.dataset.vq), parseFloat(inp.value)||0); }); });
      var na=document.getElementById('vNewAdd'); na.addEventListener('click',function(){ var nm=document.getElementById('vNewName').value.trim(); if(!nm)return; focusName=nm; vSetQty(key,{name:nm,unit:'',brand:S.brand},1); draw(); });
      if(focusName){
        var sel='input[data-vq="'+String(focusName).replace(/"/g,'\\"')+'"]';
        var el=host.querySelector(sel);
        if(el){ try{ el.focus(); el.scrollIntoView({block:'center', behavior:'smooth'}); }catch(e){} focusName=''; }
      }
    }
    draw();
  }

  // ── place ──
  document.getElementById('placeBtn').addEventListener('click', function(){
    if(!S.order.length||busy) return;
    var bad=S.order.filter(function(l){ return String(l.qty).trim()===''; });
    if(bad.length && !confirm(bad.length+' item(s) have no quantity. Place anyway? (vendor will fill)')) return;
    busy=true; var btn=this; btn.disabled=true; btn.textContent='Placing…';
    var lines=S.order.map(function(l){ return { item:l.item, sku:l.item_code||l.item, qty:l.qty, unit:l.unit, vendorKey:l.vendorKey, brand:l.brand, price_paise:Math.round((parseFloat(l.price)||0)*100) }; });
    api('place',{method:'POST',body:{ for_date:S.placeDate||defaultPurchaseDateIST(), lines:lines }}).then(function(res){
      busy=false;
      if(!res.ok||!res.j||!res.j.ok){ toast(res.j&&res.j.error||'Place failed','err'); updatePlaceBtn(); return; }
      var dup=res.j.duplicates||0;
      var msg=res.j.placed>0
        ? ('Placed '+res.j.placed+' vendor order'+(res.j.placed>1?'s':'')+(dup?' · skipped '+dup+' duplicate':''))
        : (dup?'Already placed — duplicate skipped':'No new order placed');
      toast(msg+' · '+(res.j.for_date||S.placeDate),'ok');
      S.order=[]; renderOrder();
    }).catch(function(){ busy=false; toast('No connection','err'); updatePlaceBtn(); });
  });

  // ── brand toggle ──
  document.getElementById('brandSeg').addEventListener('click', function(e){
    var b=e.target.closest('button[data-b]'); if(!b) return;
    S.brand=b.dataset.b;
    this.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on', x===b); });
    onSearch(); renderVendorList();
  });
  var placeDateInput=document.getElementById('placeDate');
  if(placeDateInput) placeDateInput.addEventListener('change', function(){ setPlaceDate(this.value); });
  var placeDateBar=document.getElementById('placeDateBar');
  if(placeDateBar) placeDateBar.addEventListener('click', function(e){
    var b=e.target.closest('button[data-pquick]'); if(!b) return;
    setPlaceDate(b.dataset.pquick==='tomorrow'?ymdIST(1):ymdIST(0));
  });

  // ── mode toggle: Place · To pay · Hyperpure · Compare ──
  function setMode(m){
    var buy=document.getElementById('viewBuy'), place=document.getElementById('viewPlace'), pay=document.getElementById('viewPay'),
        hp=document.getElementById('viewHp'), cmp=document.getElementById('viewCompare'), hist=document.getElementById('viewHistory'),
        vend=document.getElementById('viewVendors'), vset=document.getElementById('viewSettings');
    var buyBar=document.getElementById('buyBar'), placeBar=document.getElementById('placeBar'), cmpBar=document.getElementById('cmpBar');
    var h1=document.querySelector('.top h1');
    document.querySelectorAll('#modeSeg button').forEach(function(b){ b.classList.toggle('on', b.dataset.m===m); });
    var activeMode=document.querySelector('#modeSeg button[data-m="'+m+'"]');
    if(activeMode && activeMode.scrollIntoView) requestAnimationFrame(function(){ activeMode.scrollIntoView({block:'nearest', inline:'center'}); });
    [buy,place,pay,hp,cmp,hist,vend,vset].forEach(function(v){ if(v) v.classList.add('hide'); });
    [buyBar,placeBar,cmpBar].forEach(function(b){ if(b) b.classList.add('hide'); });
    if(m==='pay'){ pay.classList.remove('hide'); if(h1) h1.textContent="To pay"; loadPay(); }
    else if(m==='vendors'){ vend.classList.remove('hide'); if(h1) h1.textContent="Vendor diary"; loadVendors(); }
    else if(m==='settings'){ vset.classList.remove('hide'); if(h1) h1.textContent="Settings"; loadSettings(); }
    else if(m==='hp'){ hp.classList.remove('hide'); if(h1) h1.textContent="Tomorrow · Hyperpure"; loadHp(); }
    else if(m==='cmp'){ cmp.classList.remove('hide'); cmpBar.classList.remove('hide'); if(h1) h1.textContent="Compare prices"; loadCompare(); }
    else if(m==='orders'){ hist.classList.remove('hide'); if(h1) h1.textContent="Purchase diary"; loadHistory(); }
    else if(m==='place'){ place.classList.remove('hide'); placeBar.classList.remove('hide'); syncPlaceDate(); if(h1) h1.textContent=dateTitle(S.placeDate); }
    else { buy.classList.remove('hide'); buyBar.classList.remove('hide'); if(h1) h1.textContent="Buy list"; loadBuy(); }
  }
  document.getElementById('modeSeg').addEventListener('click', function(e){ var b=e.target.closest('button[data-m]'); if(b) setMode(b.dataset.m); });

  function rupees(p){ return (Math.round(+p||0)/100).toLocaleString('en-IN'); }
  function num(v){ return parseFloat(String(v==null?'':v).replace(/,/g,''))||0; }  // strips thousands-commas; "5,500" -> 5500 (not 5)
  function qtyNum(v){ var m=String(v==null?'':v).match(/-?[\d.]+/); return m ? (parseFloat(m[0])||0) : 0; }
  function chickenLine(i){
    var hay=[i&&i.item,i&&i.sku,i&&i.unit].join(' ').toLowerCase();
    return /chicken|broiler|shawarma|kebab|kabab|tandoor|tandoori|tangdi|lollipop|wings/.test(hay);
  }
  function pieceUnit(unit){ return /bird|pc|pcs|piece|pieces/i.test(String(unit||'')); }
  function lineYieldedKg(i){
    return qtyNum(i && (i.yielded_kg!=null ? i.yielded_kg : i.received_qty));
  }
  function lineDeliveredKg(i){
    return qtyNum(i && (i.delivered_kg!=null ? i.delivered_kg : (i.bill_qty!=null ? i.bill_qty : i.live_qty)));
  }
  function lineDailyRatePaise(i){
    var explicit=+(i&&i.daily_rate_paise)||0;
    if(explicit>0) return explicit;
    if(i && (i.bill_qty || i.live_qty) && +i.price_paise>0) return +i.price_paise; // v51 compatibility
    return 0;
  }
  function lineBillingQty(i){
    if(i&&i.delivered_kg!=null&&String(i.delivered_kg).trim()!=='') return qtyNum(i.delivered_kg);
    if(i&&i.bill_qty!=null&&String(i.bill_qty).trim()!=='') return qtyNum(i.bill_qty);
    if(i&&i.billing_qty!=null&&String(i.billing_qty).trim()!=='') return qtyNum(i.billing_qty);
    if(i&&i.live_qty!=null&&String(i.live_qty).trim()!=='') return qtyNum(i.live_qty);
    return qtyNum(i&&i.qty);
  }
  function lineNeedsBill(i){
    if(!i || i.direct || qtyNum(i.qty)<=0) return false;
    if(chickenLine(i)) return lineYieldedKg(i)<=0 || lineDeliveredKg(i)<=0 || lineDailyRatePaise(i)<=0;
    return !(+i.price_paise>0);
  }
  function lineAmount(i){
    if(+i.cost_paise>0) return +i.cost_paise;
    var delivered=lineDeliveredKg(i), daily=lineDailyRatePaise(i);
    if(delivered>0 && daily>0) return Math.round(delivered*daily);
    return Math.round(lineBillingQty(i) * Math.max(0,+i.price_paise||0));
  }
  function lineEffectivePaise(i){
    if(+i.effective_price_paise>0) return +i.effective_price_paise;
    if(+i.price_paise>0 && chickenLine(i)) return +i.price_paise;
    var yielded=lineYieldedKg(i), cost=lineAmount(i);
    return yielded>0 && cost>0 ? Math.round(cost/yielded) : 0;
  }
  function receiptSummary(i){
    var bits=[];
    if(i.received_pieces) bits.push('received '+i.received_pieces+' pc');
    if(lineYieldedKg(i)>0) bits.push('yielded '+lineYieldedKg(i)+' kg');
    if(lineDeliveredKg(i)>0) bits.push('delivered '+lineDeliveredKg(i)+' kg');
    if(lineDailyRatePaise(i)>0) bits.push('daily ₹'+rupees(lineDailyRatePaise(i))+'/kg');
    if(lineEffectivePaise(i)>0) bits.push('effective ₹'+rupees(lineEffectivePaise(i))+'/kg');
    if(i.received_note) bits.push(i.received_note);
    return bits.join(' · ');
  }
  function upiHref(vpa,vn,rs){ return vpa ? ('upi://pay?pa='+encodeURIComponent(vpa)+'&pn='+encodeURIComponent(vn)+(rs>0?'&am='+rs:'')+'&cu=INR&tn='+encodeURIComponent('Sauda')) : '#'; }
  function parseJsonAttr(s){ try{ var o=JSON.parse(s||'{}'); return o&&typeof o==='object'?o:{}; }catch(e){ return {}; } }
  function readFileAsDataUrl(file){
    return new Promise(function(resolve,reject){
      if(!file){ reject(new Error('no file')); return; }
      var reader = new FileReader();
      reader.onload = function(){ resolve(String(reader.result||'')); };
      reader.onerror = function(){ reject(new Error('file read failed')); };
      reader.readAsDataURL(file);
    });
  }
  function bankObj(v){ return (v&&v.bank&&typeof v.bank==='object') ? v.bank : {}; }
  function validBankObj(b){ return !!(b&&b.account_number&&b.ifsc&&(b.account_name||b.name)); }
  function bankLast4(b){ return b&&b.account_number ? String(b.account_number).slice(-4) : (b&&b.account_last4||''); }
  function bankSummary(b){
    if(!b) return '';
    var last=bankLast4(b);
    if(validBankObj(b)) return [(b.bank||'Bank'), last?('a/c '+last):'', b.ifsc].filter(Boolean).join(' · ');
    if(last) return [(b.bank||'Bank'), 'a/c '+last].filter(Boolean).join(' · ');
    return '';
  }
  function paymentRail(v){ return v&&v.vpa ? 'upi' : (validBankObj(bankObj(v)) ? 'bank' : 'manual'); }
  function payMethodForRail(rail){ return rail==='bank' ? 'bank_transfer' : (rail==='upi' ? 'upi' : 'manual_bank'); }
  function businessDateLabel(fd, noun){
    var L=fmtDayLabel(fd), base=L.t&&L.t!=='—'?L.t:(fd||'Dated');
    return base + (noun ? (' '+noun) : '') + (L.sub ? ' · '+L.sub : '');
  }
  function orderNeedsRate(t){
    if(!t || t.event) return false;
    var st=String(t.status||'').toUpperCase();
    if(st==='PAID'||st==='CANCELLED') return false;
    return (t.lines||[]).some(lineNeedsBill);
  }

  function loadPay(){
    var list=document.getElementById('payList'), empty=document.getElementById('payEmpty');
    list.innerHTML='<div class="empty">Loading…</div>'; empty.classList.add('hide');
    api('auto-settle').then(function(){ return api('open'); }).then(function(res){
      var orders=(res.j&&res.j.orders)||[];
      if(!orders.length){ list.innerHTML=''; empty.classList.remove('hide'); return; }
      var html='';
      orders.forEach(function(o){
        var items=[]; try{ items=JSON.parse(o.items_json||'[]'); }catch(e){}
        var rail=o.payRail || paymentRail(o), bank=bankObj(o), bankText=bankSummary(bank);
        var itemsTxt=items.map(function(i){
          var base=esc(i.item)+(i.qty?(' '+esc(i.qty)+(i.unit?' '+esc(i.unit):'')):'');
          var rec=receiptSummary(i);
          return base+(rec?' <span class="recmini">'+esc(rec)+'</span>':'');
        }).join(' · ');
        var amt=o.pay_amount_paise?String(o.pay_amount_paise/100):'';
        var rateItems=items.filter(function(i){ return i && i.order_id && i.line_idx!=null && !i.direct && qtyNum(i.qty)>0; });
        var needsRate=rateItems.some(lineNeedsBill);
        var isChickenReceipt=/broiler|m\.?\s*n/i.test(String(o.vendor_name||'')) || rateItems.some(chickenLine);
        var dayLine = o.for_date ? '<div class="flowhint"><b>'+esc(businessDateLabel(o.for_date,'purchase'))+'</b></div>' : '';
        var rateBox='';
        if(rateItems.length){
          if(isChickenReceipt){
            var dayRate=rateItems.reduce(function(v,i){ return v || lineDailyRatePaise(i); },0);
            rateBox='<div class="ratebox chickenbox" data-ratebox data-chicken-box><div class="ratehead"><b>Receive chicken</b><span>'+esc(o.vendor_name)+'</span></div>'+
              '<div class="ratehint">Same MN chicken engine: yielded kg is usable meat received; delivered kg is the live/raw kg MN billed; one daily rate creates cost and effective usable ₹/kg.</div>'+
              '<div class="dayrate"><span>MN daily rate</span><b>₹</b><input inputmode="decimal" data-day-rate value="'+(dayRate>0?esc(String(dayRate/100)):'')+'" placeholder="rate"><em>/ kg</em></div>'+
              rateItems.map(function(i){
                var line=lineAmount(i), eff=lineEffectivePaise(i), pcs=pieceUnit(i.unit);
                return '<div class="chrow" data-chicken-line data-order="'+esc(i.order_id)+'" data-idx="'+esc(i.line_idx)+'">'+
                  '<div class="chname"><b>'+esc(i.item||'')+'</b><small>ordered '+esc(String(i.qty||''))+(i.unit?' '+esc(i.unit):'')+(line?' · cost ₹'+rupees(line):'')+(eff?' · effective ₹'+rupees(eff)+'/kg':'')+'</small></div>'+
                  '<div class="chgrid">'+
                    (pcs?'<label><span>pcs received</span><input inputmode="decimal" data-rec-pieces value="'+esc(i.received_pieces||'')+'" placeholder="10"></label>':'')+
                    '<label><span>yielded kg</span><input inputmode="decimal" data-yielded-kg value="'+esc(i.yielded_kg||i.received_qty||'')+'" placeholder="7.0"></label>'+
                    '<label><span>delivered kg</span><input inputmode="decimal" data-delivered-kg value="'+esc(i.delivered_kg||i.bill_qty||i.live_qty||'')+'" placeholder="16.1"></label>'+
                  '</div>'+
                  '<input class="chnote" data-rec-note value="'+esc(i.received_note||'')+'" placeholder="split / note, e.g. tandoor 6pc 6.30 + 4pc 3.80">'+
                '</div>';
              }).join('')+
              '<div class="receiptrow"><input data-receipt-ref placeholder="receipt / bill no. optional"><input data-receipt-file type="file" accept="application/pdf,image/*,.pdf"></div>'+
              '<button class="save-receipt" data-save-receipt>Save yielded/delivered kg</button>'+
              '<button class="save-rates" data-save-rates>Save MN daily rate + bill</button></div>';
          } else {
            rateBox='<div class="ratebox" data-ratebox><div class="ratehead"><b>Receipt rates</b><span>'+esc(o.vendor_name)+'</span></div>'+
              '<div class="ratehint">Enter the rates from the vendor receipt. Sauda totals the bill from qty x rate.</div>'+
              rateItems.map(function(i){
                var q=qtyNum(i.qty), p=+i.price_paise||0, line=Math.round(q*p);
                return '<div class="raterow"><div class="ri"><b>'+esc(i.item||'')+'</b><small>'+esc(String(i.qty||''))+(i.unit?' '+esc(i.unit):'')+(line?' · ₹'+rupees(line):'')+'</small></div>'+
                  '<span class="rs">₹</span><input inputmode="decimal" data-rate data-order="'+esc(i.order_id)+'" data-idx="'+esc(i.line_idx)+'" value="'+(p>0?esc(String(p/100)):'')+'" placeholder="rate">'+
                  '<span class="pu">'+(i.unit?('/ '+esc(i.unit)):'')+'</span></div>';
              }).join('')+
              '<div class="receiptrow"><input data-receipt-ref placeholder="receipt / bill no. optional"><input data-receipt-file type="file" accept="application/pdf,image/*,.pdf"></div>'+
              '<button class="save-rates" data-save-rates>Save receipt rates</button></div>';
          }
        }
        var ids=(o.ids||[]).join(',');
        var multi=(o.order_count>1)?'<span class="tag p">'+items.length+' items · '+o.order_count+' orders</span>':'<span class="tag p">'+items.length+' item'+(items.length>1?'s':'')+'</span>';
        var vendorNote=o.cat?'<div class="skuhint" style="margin-bottom:8px">'+esc(o.cat)+'</div>':'';
        var manualHint=rail==='bank'
          ? '<div class="skuhint" style="margin-bottom:9px;color:var(--amber)">Bank transfer saved: '+esc(bankText||'account details')+'. Pay manually, then record it here.</div>'
          : (!o.vpa?'<div class="skuhint" style="margin-bottom:9px;color:var(--amber)">No UPI saved. Pay manually from invoice / bank / Porter, then record it here. Sauda will keep one payable trail.</div>':'');
        var bankAttr=esc(JSON.stringify(bank||{}));
        var payLabel=o.vpa?'Pay':(rail==='bank'?'Bank details':'No rail saved');
        var payClass=o.vpa?'upi':(rail==='bank'?'upi bank':'upi dis');
        html+='<div class="basket"><div class="bh"><span class="bn">'+esc(o.vendor_name)+'</span>'+
          '<span class="tag f">'+esc(o.fulfilmentLabel||'')+'</span><span class="tag p">'+esc(o.payLabel||'')+'</span>'+multi+'</div>'+
          '<div class="pb" data-needs-rate="'+(needsRate?'1':'0')+'">'+dayLine+vendorNote+manualHint+'<div class="its">'+(itemsTxt||'—')+'</div>'+rateBox+
          (o.pay==='khata_roll'?'<div class="khata" style="margin:0 0 9px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg><span>Khata — clear the outstanding balance, not just this order.</span></div>':'')+
          '<div class="pay-row"><span class="rupee">₹</span><input inputmode="decimal" data-amt '+(rateItems.length?'readonly':'')+' value="'+esc(amt)+'" placeholder="'+(rateItems.length?'auto after rates':'one payment for all items')+'"></div>'+
          '<div class="pay-acts">'+
            '<button class="'+payClass+'" data-pay="'+esc(o.vpa||'')+'" data-rail="'+esc(rail)+'" data-bank="'+bankAttr+'" data-vn="'+esc(o.vendor_name)+'">'+payLabel+'</button>'+
            '<button class="done" data-ids="'+ids+'" data-rail="'+esc(rail)+'">'+(o.vpa?'Mark paid':'Record paid')+'</button>'+
          '</div></div></div>';
      });
      list.innerHTML=html;
      function idsOf(el){ return (el.closest('.pb').querySelector('button[data-ids]').dataset.ids||'').split(',').map(Number).filter(Boolean); }
      function chickenLinesFromBox(box, withBill){
        var dailyRate=Math.round(num(box&&box.querySelector('[data-day-rate]')&&box.querySelector('[data-day-rate]').value)*100);
        return [].slice.call(box.querySelectorAll('[data-chicken-line]')).map(function(row){
          var yielded=row.querySelector('[data-yielded-kg]'), delivered=row.querySelector('[data-delivered-kg]'), recPieces=row.querySelector('[data-rec-pieces]'), recNote=row.querySelector('[data-rec-note]');
          var line={ id:+row.dataset.order, line_idx:+row.dataset.idx, yielded_kg:yielded?yielded.value.trim():'', delivered_kg:delivered?delivered.value.trim():'', received_note:recNote?recNote.value.trim():'' };
          if(recPieces) line.received_pieces=recPieces.value.trim();
          if(withBill){
            line.daily_rate_paise=dailyRate;
          }
          return line;
        });
      }
      list.querySelectorAll('[data-save-receipt]').forEach(function(b){
        b.addEventListener('click', function(){
          var box=b.closest('[data-chicken-box]');
          var lines=chickenLinesFromBox(box, false);
          var hasAny=lines.some(function(l){ return l.yielded_kg || l.delivered_kg || l.received_pieces || l.received_note; });
          if(!hasAny){ toast('Enter yielded/delivered kg first','err'); return; }
          if(busy) return; busy=true; b.disabled=true; b.textContent='Saving...';
          api('purchase-receipt',{method:'POST',body:{lines:lines}})
            .then(function(r){ busy=false; if(r&&r.ok&&r.j&&r.j.ok){ toast('Chicken kg saved','ok'); loadPay(); } else { toast((r&&r.j&&r.j.error)||'receipt save failed','err'); b.disabled=false; b.textContent='Save yielded/delivered kg'; } })
            .catch(function(){ busy=false; b.disabled=false; b.textContent='Save yielded/delivered kg'; toast('No connection','err'); });
        });
      });
      list.querySelectorAll('[data-save-rates]').forEach(function(b){
        b.addEventListener('click', function(){
          var pb=b.closest('.pb'), chickenBox=pb.querySelector('[data-chicken-box]');
          var inputs=[].slice.call(pb.querySelectorAll('input[data-rate]'));
          var missing=chickenBox
            ? [].slice.call(chickenBox.querySelectorAll('[data-chicken-line]')).some(function(row){
                var yielded=row.querySelector('[data-yielded-kg]'), delivered=row.querySelector('[data-delivered-kg]'), rate=chickenBox.querySelector('[data-day-rate]');
                return num(yielded&&yielded.value)<=0 || num(delivered&&delivered.value)<=0 || num(rate&&rate.value)<=0;
              })
            : inputs.some(function(inp){ return num(inp.value)<=0; });
          if(missing){ toast(chickenBox?'Enter yielded kg, delivered kg and daily rate first':'Enter every live rate first','err'); return; }
          if(busy) return; busy=true; b.disabled=true; b.textContent='Saving...';
          var lines=chickenBox
            ? chickenLinesFromBox(chickenBox, true)
            : inputs.map(function(inp){ return { id:+inp.dataset.order, line_idx:+inp.dataset.idx, price_paise:Math.round(num(inp.value)*100) }; });
          var body={lines:lines};
          var refEl=pb.querySelector('[data-receipt-ref]');
          var fileEl=pb.querySelector('[data-receipt-file]');
          var ref=(refEl&&refEl.value||'').trim();
          if(ref) body.receipt_ref=ref;
          function sendRates(){
            api('purchase-prices',{method:'POST',body:body})
              .then(function(r){ busy=false; if(r&&r.ok&&r.j&&r.j.ok){ toast(chickenBox?'MN bill saved · amount updated':'Receipt rates saved · bill updated','ok'); loadPay(); } else { toast((r&&r.j&&r.j.error)||'rate save failed','err'); b.disabled=false; b.textContent=chickenBox?'Save MN daily rate + bill':'Save receipt rates'; } })
              .catch(function(){ busy=false; b.disabled=false; b.textContent=chickenBox?'Save MN daily rate + bill':'Save receipt rates'; toast('No connection','err'); });
          }
          var file=fileEl&&fileEl.files&&fileEl.files[0];
          if(file){
            readFileAsDataUrl(file).then(function(dataUrl){
              body.attachment={name:file.name,mimetype:file.type||'application/octet-stream',data_url:dataUrl};
              sendRates();
            }).catch(function(){ busy=false; b.disabled=false; b.textContent=chickenBox?'Save MN daily rate + bill':'Save receipt rates'; toast('Could not read receipt','err'); });
          } else sendRates();
        });
      });
      list.querySelectorAll('button[data-pay]').forEach(function(b){
        b.addEventListener('click', function(){
          if(!b.dataset.pay && b.dataset.rail!=='bank') return;
          var pb=b.closest('.pb'); var rs=num(pb.querySelector('input[data-amt]').value);
          if(pb.dataset.needsRate==='1'){ toast('Save yielded kg, delivered kg and daily rate first','err'); return; }
          if(rs<=0){ toast('Enter the amount first','err'); return; }
          if(b.dataset.pay) openPaySheet(b.dataset.pay, b.dataset.vn, rs, idsOf(b));
          else openManualPaySheet(b.dataset.vn, rs, idsOf(b), 'Transfer to the saved bank account, then record it here.', parseJsonAttr(b.dataset.bank));
        });
      });
      list.querySelectorAll('button[data-ids]').forEach(function(b){
        b.addEventListener('click', function(){
          var ids=idsOf(b); var pb=b.closest('.pb'); var rs=num(pb.querySelector('input[data-amt]').value);
          var payBtn=pb.querySelector('button[data-pay]'); var method=payMethodForRail((payBtn&&payBtn.dataset.rail)||b.dataset.rail||'manual');
          if(pb.dataset.needsRate==='1'){ toast('Save yielded kg, delivered kg and daily rate first','err'); return; }
          if(busy||!ids.length) return; busy=true;
          api('mark-paid',{method:'POST',body:{ids:ids, amount_paise:Math.round(rs*100), method:method}})
             .then(function(r){ busy=false; if(r&&r.ok&&r.j&&r.j.ok){ toast(r.j.reconciled?'✓ Bank-confirmed paid':'Marked paid · bank not seen yet','ok'); loadPay(); } else toast('Failed','err'); })
             .catch(function(){ busy=false; toast('No connection','err'); });
        });
      });
    }).catch(function(){ list.innerHTML=''; toast('No connection','err'); });
  }

  // ── Pay sheet: open the chosen UPI app with the amount filled, + always-on
  //    fallbacks. PhonePe is the default; the generic upi:// is LAST (that's the
  //    one iOS mis-routes to WhatsApp Pay). Amount is shown big — for a normal
  //    vendor VPA it can't be hard-locked, so the owner confirms it himself. ──
  function fmtAm(rs){ return (Math.round(rs*100)/100).toFixed(2); }
  // PAYEE-ONLY intent — deliberately NO amount. A pre-filled `am` makes the PSP treat the
  // payment like a static/gallery QR, which NPCI caps at ₹2,000 to a personal VPA (owner hit
  // exactly this on a ₹5,500 payment: "pay up to ₹2,000 … or pay with mobile number / scan QR").
  // Opening to the payee and letting the owner type the amount IN-APP is the uncapped manual
  // path (up to ₹1,00,000) — same as a direct payment, which works. (We also dropped the old
  // `mam=null`/`tr` junk that earlier tripped "UPI risk policy".)
  function payLink(scheme, vpa, vn){
    var q='pa='+encodeURIComponent(vpa)+'&pn='+encodeURIComponent(vn||'Vendor')+'&cu=INR&tn='+encodeURIComponent('Sauda');
    if(scheme==='phonepe') return 'phonepe://pay?'+q;
    if(scheme==='gpay')    return 'tez://upi/pay?'+q;
    if(scheme==='paytm')   return 'paytmmp://pay?'+q;
    return 'upi://pay?'+q;
  }
  // Verified-merchant VPAs (paytmqr…@ptys, q<digits>@ybl PhonePe-merchant, vyapar.…)
  // take you to the ₹1,00,000 rail with no friction. A personal UPI ID is ALSO fine
  // up to ₹1,00,000 via this redirect — the "₹2,000" PhonePe sometimes shows is a fee
  // note, not a block. (The only real ₹2,000 cap is an un-KYC'd small-merchant QR, or
  // paying by uploading a QR screenshot — which this redirect never does.)
  function upiKind(v){ v=String(v||'').toLowerCase();
    return (/@ptys$|^paytmqr|^q\d|^vyapar\.|@okbizaxis$/.test(v)) ? 'merchant' : 'personal'; }
  function openPaySheet(vpa, vn, rs, ids){
    var tr='SAUDA'+((ids&&ids[0])||'')+'-'+Math.round(Date.now()/1000);
    if(rs>0 && ids && ids.length){ api('request-pay',{method:'POST',body:{ids:ids, amount_paise:Math.round(rs*100)}}); }
    var big='₹'+rupees(Math.round(rs*100));
    var pk=upiKind(vpa);
    var pkHtml=(pk==='merchant')
      ? '<div class="skuhint" style="color:#1a7f37">✓ Verified merchant — you can pay up to ₹1,00,000 in one go.</div>'
      : '<div class="skuhint">Pay up to ₹1,00,000 — just type the amount in PhonePe (we don’t pre-fill it, so there’s no ₹2,000 cap).</div>';
    var host=document.getElementById('sheetHost');
    function app(scheme,label,primary){ return '<a class="payapp'+(primary?' pp':'')+'" href="'+payLink(scheme,vpa,vn,rs)+'">'+esc(label)+'</a>'; }
    host.innerHTML='<div class="ov" id="ov"><div class="sheet"><h2>Pay '+esc(vn)+'</h2>'+
      '<div class="paybig">'+big+'</div>'+
      '<div class="skuhint">Tap below — it <b>copies the UPI ID and opens PhonePe</b> at this vendor. Type ₹'+rupees(Math.round(rs*100))+' and pay. (If PhonePe doesn’t show the vendor, tap <b>Pay to UPI ID</b> and paste — the ID is already copied.) Any amount, no ₹2,000 cap.</div>'+
      pkHtml+
      '<a class="payapp pp" id="ppOpen" href="'+payLink('phonepe',vpa,vn)+'">Copy UPI ID &amp; open PhonePe</a>'+
      '<div class="payrow2">'+app('gpay','Google Pay')+app('paytm','Paytm')+'</div>'+
      '<div class="cpyrow"><button class="cpy" data-cpy="'+esc(vpa)+'">Copy UPI ID</button><button class="cpy" data-cpy="'+esc(String(Math.round(rs)))+'">Copy ₹'+rupees(Math.round(rs*100))+'</button></div>'+
      '<div class="vpa-line">'+esc(vpa)+'</div>'+
      '<button class="btn primary" id="paidBtn" style="width:100%;margin-top:14px">I’ve paid — mark paid</button>'+
      '</div></div>';
    document.getElementById('ov').addEventListener('click',function(e){ if(e.target.id==='ov') host.innerHTML=''; });
    host.querySelectorAll('button[data-cpy]').forEach(function(b){ b.addEventListener('click',function(){ try{ navigator.clipboard.writeText(b.dataset.cpy); toast('Copied','ok'); }catch(e){ toast('Copy failed','err'); } }); });
    // Primary CTA: copy the UPI ID, then let the <a> open PhonePe (custom-scheme nav doesn't
    // unload the page, so the clipboard write completes — ID is ready to paste in PhonePe).
    var ppO=document.getElementById('ppOpen'); if(ppO) ppO.addEventListener('click',function(){ try{ navigator.clipboard.writeText(vpa); }catch(e){} toast('UPI ID copied — opening PhonePe','ok'); });
    document.getElementById('paidBtn').addEventListener('click',function(){
      if(busy) return; busy=true;
      api('mark-paid',{method:'POST',body:{ids:ids, amount_paise:Math.round(rs*100), method:'upi'}})
        .then(function(r){ busy=false; if(r&&r.ok&&r.j&&r.j.ok){ toast(r.j.reconciled?'✓ Bank-confirmed paid':'Marked paid · bank not seen yet','ok'); host.innerHTML=''; loadPay(); } else toast('Failed','err'); })
        .catch(function(){ busy=false; toast('No connection','err'); });
    });
  }
  function openManualPaySheet(vn, rs, ids, note, bank){
    var big='₹'+rupees(Math.round(rs*100));
    bank=bank||{};
    var bankHtml='';
    if(validBankObj(bank)){
      bankHtml='<div class="bankbox">'+
        '<div class="bankline"><b>Name</b><span>'+esc(bank.account_name||vn)+'</span></div>'+
        '<div class="bankline"><b>Account</b><span>'+esc(bank.account_number)+'</span></div>'+
        '<div class="bankline"><b>IFSC</b><span>'+esc(bank.ifsc)+'</span></div>'+
        (bank.branch?'<div class="bankline"><b>Branch</b><span>'+esc(bank.branch)+'</span></div>':'')+
        (bank.qr_ref?'<div class="bankline"><b>QR / ref</b><span>'+esc(bank.qr_ref)+'</span></div>':'')+
      '</div>';
    }
    var host=document.getElementById('sheetHost');
    host.innerHTML='<div class="ov" id="ov"><div class="sheet"><h2>Record '+esc(vn)+'</h2>'+
      '<div class="paybig">'+big+'</div>'+
      '<div class="skuhint">'+esc(note||'Pay manually from the invoice, bank beneficiary, cash, or Porter app. Then tap record paid here. Reopening this same payment will not create a duplicate bill.').replace(/\n/g,'<br>')+'</div>'+
      bankHtml+
      '<div class="cpyrow"><button class="cpy" data-cpy="'+esc(String(Math.round(rs)))+'">Copy ₹'+rupees(Math.round(rs*100))+'</button>'+
      (validBankObj(bank)?'<button class="cpy" data-cpy="'+esc(bank.account_number)+'">Copy account</button>':'')+'</div>'+
      (validBankObj(bank)?'<div class="cpyrow"><button class="cpy" data-cpy="'+esc(bank.ifsc)+'">Copy IFSC</button><button class="cpy" data-cpy="'+esc(bank.account_name||vn)+'">Copy name</button></div>':'')+
      '<button class="btn primary" id="paidBtn" style="width:100%;margin-top:14px">Payment done — record paid</button>'+
      '</div></div>';
    document.getElementById('ov').addEventListener('click',function(e){ if(e.target.id==='ov') host.innerHTML=''; });
    host.querySelectorAll('button[data-cpy]').forEach(function(b){ b.addEventListener('click',function(){ try{ navigator.clipboard.writeText(b.dataset.cpy); toast('Copied','ok'); }catch(e){ toast('Copy failed','err'); } }); });
    document.getElementById('paidBtn').addEventListener('click',function(){
      if(busy) return; busy=true;
      api('mark-paid',{method:'POST',body:{ids:ids, amount_paise:Math.round(rs*100), method:validBankObj(bank)?'bank_transfer':'manual_bank'}})
        .then(function(r){ busy=false; if(r&&r.ok&&r.j&&r.j.ok){ toast('Payment recorded','ok'); host.innerHTML=''; loadPay(); } else toast('Failed','err'); })
        .catch(function(){ busy=false; toast('No connection','err'); });
    });
  }

  // ── Direct pay (Vendors tab). Until RazorpayX activates (~10-12 days), PAYOUT_LIVE stays
  //    false → MANUAL flow (you pay by UPI, then mark paid; recorded in the trail). The day
  //    RazorpayX is live + funded, flip PAYOUT_LIVE → true and Sauda pushes the money itself
  //    via the payout API. SAME button, no rebuild. ──
  var PAYOUT_LIVE = false;
  function openDirectPay(vk, name, vpa, bank){
    bank=bank||{};
    if(PAYOUT_LIVE){ openDirectPayout(vk, name, vpa, bank); return; }
    var railLine=vpa?esc(vpa):(validBankObj(bank)?esc(bankSummary(bank)):'No UPI/bank saved · manual record only');
    var host=document.getElementById('sheetHost');
    var today=ymdIST(0), yesterday=ymdIST(-1);
    host.innerHTML='<div class="ov" id="ov"><div class="sheet"><h2>Invoice + payment</h2>'+
      '<div class="skuhint">Use this for a vendor bill that is not already sitting in To pay. Pick the purchase date so yesterday’s Mountain Dew or any late-entered bill stays under the right business day.</div>'+
      '<div class="fld" style="margin-top:11px"><label>Invoice PDF / photo</label><input id="dpFile" type="file" accept="application/pdf,image/*,.pdf"></div>'+
      '<div class="fld"><label>Purchase date</label><input id="dpDate" type="date" value="'+esc(today)+'"></div>'+
      '<div class="quickdates"><button data-dpdate="'+esc(today)+'">Today</button><button data-dpdate="'+esc(yesterday)+'">Yesterday</button></div>'+
      '<div class="pay-row"><span class="rupee">₹</span><input inputmode="decimal" id="dpAmt" placeholder="invoice amount"></div>'+
      '<div class="fld" style="margin-top:11px"><label>Reference / note</label><input id="dpRef" placeholder="optional"></div>'+
      '<label class="skuhint" style="display:flex;align-items:center;gap:8px;margin-top:10px"><input id="dpPaid" type="checkbox" checked><span>Payment already done</span></label>'+
      '<div class="vpa-line" style="margin:8px 0 0">'+railLine+'</div>'+
      '<button class="btn primary" id="dpGo" style="width:100%;margin-top:14px">Save invoice + payment</button>'+
      '</div></div>';
    document.getElementById('ov').addEventListener('click',function(e){ if(e.target.id==='ov') host.innerHTML=''; });
    host.querySelectorAll('[data-dpdate]').forEach(function(b){ b.addEventListener('click',function(){ var el=document.getElementById('dpDate'); if(el) el.value=b.dataset.dpdate; }); });
    var amtEl=document.getElementById('dpAmt'); if(amtEl) amtEl.focus();
    document.getElementById('dpGo').addEventListener('click',function(){
      var rs=num(document.getElementById('dpAmt').value);
      if(rs<=0){ toast('Enter an amount','err'); return; }
      if(busy) return; busy=true;
      var btn=document.getElementById('dpGo'); btn.disabled=true; btn.textContent='Saving...';
      var ref=(document.getElementById('dpRef').value||'').trim();
      var eventDate=(document.getElementById('dpDate')&&document.getElementById('dpDate').value||today).slice(0,10);
      var note=ref ? ('Invoice '+ref) : '';
      var paid = !!(document.getElementById('dpPaid') && document.getElementById('dpPaid').checked);
      var file = document.getElementById('dpFile') && document.getElementById('dpFile').files && document.getElementById('dpFile').files[0];
      function submit(events){
        api('vendor-event',{method:'POST',body:{vendorKey:vk, events:events}}).then(function(r){
          busy=false;
          if(!r.ok||!r.j||!r.j.ok){ toast((r.j&&r.j.error)||'Failed','err'); btn.disabled=false; btn.textContent='Save invoice + payment'; return; }
          var evs = (r.j && r.j.events) || [];
          var payEvt = evs.find(function(e){ return e.event_type==='payment'; });
          var msg = 'Invoice saved';
          if(paid) msg += (payEvt && payEvt.reconciled) ? ' · payment bank-confirmed' : ' · payment recorded';
          toast(msg,'ok');
          host.innerHTML='';
          loadVendors();
        }).catch(function(){ busy=false; btn.disabled=false; btn.textContent='Save invoice + payment'; toast('No connection','err'); });
      }
      function buildEvents(){
        var events=[{vendorKey:vk, event_type:'bill', event_date:eventDate, amount_paise:Math.round(rs*100), ref:ref, note:note, source:'manual_ui'}];
        if(file){
          readFileAsDataUrl(file).then(function(dataUrl){
            events[0].attachment = { name:file.name, mimetype:file.type||'application/octet-stream', data_url:dataUrl };
            if(paid) events.push({vendorKey:vk, event_type:'payment', amount_paise:Math.round(rs*100), ref:ref, note:note||'Manual payment', source:'manual_ui'});
            submit(events);
          }).catch(function(){ busy=false; btn.disabled=false; btn.textContent='Save invoice + payment'; toast('Could not read invoice file','err'); });
        } else {
          if(paid) events.push({vendorKey:vk, event_type:'payment', amount_paise:Math.round(rs*100), ref:ref, note:note||'Manual payment', source:'manual_ui'});
          submit(events);
        }
      }
      buildEvents();
    });
  }
  // RazorpayX automated payout — used once PAYOUT_LIVE is flipped on (account live + funded).
  function openDirectPayout(vk, name, vpa, bank){
    bank=bank||{};
    var railLine=vpa?esc(vpa):(validBankObj(bank)?esc(bankSummary(bank)):'No payment rail saved');
    var host=document.getElementById('sheetHost');
    host.innerHTML='<div class="ov" id="ov"><div class="sheet"><h2>Pay '+esc(name)+'</h2>'+
      '<div class="skuhint">Sauda sends the money <b>straight to the vendor</b> via RazorpayX — no UPI app. A payout reference comes back instantly.</div>'+
      '<div class="pay-row"><span class="rupee">₹</span><input inputmode="decimal" id="dpAmt" placeholder="amount"></div>'+
      '<div class="vpa-line" style="margin:8px 0 0">'+railLine+'</div>'+
      '<button class="btn primary" id="dpGo" style="width:100%;margin-top:14px">Pay '+esc(name)+'</button>'+
      '</div></div>';
    document.getElementById('ov').addEventListener('click',function(e){ if(e.target.id==='ov') host.innerHTML=''; });
    var amtEl=document.getElementById('dpAmt'); if(amtEl) amtEl.focus();
    document.getElementById('dpGo').addEventListener('click',function(){
      var rs=num(document.getElementById('dpAmt').value);
      if(rs<=0){ toast('Enter an amount','err'); return; }
      if(busy) return; busy=true;
      var btn=document.getElementById('dpGo'); btn.textContent='Sending…'; btn.disabled=true;
      api('payout',{method:'POST',body:{vendorKey:vk, amount_paise:Math.round(rs*100)}}).then(function(r){
        busy=false;
        if(r.ok&&r.j&&r.j.ok){
          var head=(r.j.test?'✓ TEST sent ₹':'✓ Paid ₹')+rupees(Math.round(rs*100))+' → '+name;
          toast(r.j.utr?(head+' · UTR '+r.j.utr):(head+(r.j.status==='processing'?' · processing':'')),'ok');
          host.innerHTML=''; if(typeof loadVendors==='function') loadVendors();
        } else { toast((r.j&&r.j.error)||'Payout failed','err'); btn.textContent='Pay '+name; btn.disabled=false; }
      }).catch(function(){ busy=false; toast('No connection','err'); btn.textContent='Pay '+name; btn.disabled=false; });
    });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // HYPERPURE — tomorrow's planned mandi basket (next-day, ₹1,500 min, 11pm cutoff)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function loadHp(){
    if(S.hp.tick){ clearInterval(S.hp.tick); S.hp.tick=null; }
    var feed=document.getElementById('hpFeed'), empty=document.getElementById('hpEmpty');
    feed.innerHTML=''; empty.classList.add('hide');
    document.getElementById('hpStrip').innerHTML='';
    api('hyperpure-feed').then(function(res){
      if(!res.ok){ toast(res.j&&res.j.error||'feed failed','err'); return; }
      S.hp.feed = res.j.items||[]; S.hp.win = res.j.window||null; S.hp.fresh = res.j.scraped_at||'';
      S.hp.stale = !!res.j.stale;
      renderHpStrip();
      renderHpFeed();
      // live cutoff countdown, ticking each minute
      if(S.hp.win && S.hp.win.open){ S.hp.tick=setInterval(function(){ S.hp.win.mins_to_cutoff=Math.max(0,S.hp.win.mins_to_cutoff-1); renderHpStrip(); }, 60000); }
    }).catch(function(){ toast('No connection','err'); });
  }

  function fmtDay(ymd){ try{ var d=new Date(ymd+'T00:00:00'); return d.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'}); }catch(e){ return ymd; } }
  function relTime(iso){ if(!iso) return ''; var ms=Date.now()-new Date(iso).getTime(); var h=Math.floor(ms/3600000);
    if(h<1) return 'just now'; if(h<24) return h+'h ago'; return Math.floor(h/24)+'d ago'; }
  function isStale(iso){ if(!iso) return true; return (Date.now()-new Date(iso).getTime())>36*3600000; }

  function renderHpStrip(){
    var strip=document.getElementById('hpStrip'); if(!strip) return;
    var w=S.hp.win, pill='';
    var clock='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    if(w){
      if(w.open){
        var hh=Math.floor(w.mins_to_cutoff/60), mm=w.mins_to_cutoff%60;
        var left=hh>0?(hh+'h '+mm+'m'):(mm+'m');
        pill='<span class="hp-pill">'+clock+'Delivers '+esc(fmtDay(w.for_date))+' · order within '+left+'</span>';
      } else {
        pill='<span class="hp-pill warn">'+clock+'Cutoff passed · delivers '+esc(fmtDay(w.for_date))+'</span>';
      }
    }
    var stale=S.hp.stale||isStale(S.hp.fresh);
    var fresh='<span class="hp-fresh'+(stale?' stale':'')+'">prices '+(S.hp.fresh?relTime(S.hp.fresh):'—')+(stale?' · may be old':'')+'</span>';
    var added=0; for(var kk in S.hp.picked){ if(S.hp.picked[kk]==='added') added++; }
    var cnt = added ? '<span class="hp-cnt">✓ '+added+' added</span>' : '';
    var banner = stale ? '<div class="hp-stale">Hyperpure prices may be a day old — cheaper/dearer marks are hidden until tonight’s refresh.</div>' : '';
    strip.innerHTML=pill+fresh+cnt+banner;
  }

  document.getElementById('hpSearch').addEventListener('input', renderHpFeed);

  // Which display group a row falls into. Unverified / stale rows can never assert a
  // cheaper/dearer claim → they land in "couldn't compare" (price shown, no verdict).
  function hpBucket(it){ if(S.hp.stale || !it.verified || !it.verdict) return 'nomatch'; return it.verdict; }
  var HP_GROUPS=[
    {key:'cheaper', title:'Cheaper on Hyperpure', cls:'g-ok'},
    {key:'same',    title:'About the same',       cls:'g-mut'},
    {key:'dearer',  title:'Dearer on Hyperpure',  cls:'g-warn'},
    {key:'nomatch', title:'Couldn’t compare',     cls:'g-mut'},
    {key:'added',   title:'Added',                cls:'g-ok'}
  ];

  function renderHpFeed(){
    var host=document.getElementById('hpFeed'), empty=document.getElementById('hpEmpty');
    if(!S.hp.feed.length){ host.innerHTML=''; empty.classList.remove('hide'); renderHpStrip(); return; }
    empty.classList.add('hide');
    var q=(document.getElementById('hpSearch').value||'').trim().toLowerCase();
    var rows=S.hp.feed.filter(function(it){ return !q || ((it.label||it.name)+' '+(it.matched||'')).toLowerCase().indexOf(q)>=0; });
    var byName=function(a,b){ return String(a.label||a.name).localeCompare(String(b.label||b.name)); };
    var groups, buckets;
    if(S.hp.stale){
      // stale feed: never assert verdicts — one flat list + the Added group
      groups=[{key:'all',title:'All items',cls:'g-mut'},{key:'added',title:'Added',cls:'g-ok'}];
      buckets={all:[],added:[]};
      rows.forEach(function(it){ (S.hp.picked[it.item_key]==='added'?buckets.added:buckets.all).push(it); });
      buckets.all.sort(byName); buckets.added.sort(byName);
    } else {
      groups=HP_GROUPS;
      buckets={cheaper:[],same:[],dearer:[],nomatch:[],added:[]};
      rows.forEach(function(it){ if(S.hp.picked[it.item_key]==='added'){ buckets.added.push(it); return; } buckets[hpBucket(it)].push(it); });
      buckets.cheaper.sort(function(a,b){ return (b.pct||0)-(a.pct||0); });   // biggest saving first
      ['same','dearer','nomatch','added'].forEach(function(g){ buckets[g].sort(byName); });
    }
    host.innerHTML = groups.map(function(g){
      var list=buckets[g.key]||[]; if(!list.length) return '';
      var collapsible=(g.key==='dearer'||g.key==='nomatch');
      var collapsed=(g.key==='dearer'&&S.hp.collapsed.dearer)||(g.key==='nomatch'&&S.hp.collapsed.nomatch);
      var head='<button class="hpgrp '+g.cls+'" data-grp="'+g.key+'">'+esc(g.title)+' <em>'+list.length+'</em>'+
               (collapsible?'<span class="chev">'+(collapsed?'▸':'▾')+'</span>':'')+'</button>';
      return head+(collapsed?'':list.map(hpRow).join(''));
    }).join('');
    host.querySelectorAll('.hpgrp[data-grp]').forEach(function(b){ b.addEventListener('click',function(){
      var g=b.dataset.grp; if(g==='dearer') S.hp.collapsed.dearer=!S.hp.collapsed.dearer; else if(g==='nomatch') S.hp.collapsed.nomatch=!S.hp.collapsed.nomatch; else return; renderHpFeed(); }); });
    host.querySelectorAll('.hp-open[data-open]').forEach(function(a){ a.addEventListener('click',function(){ markOpened(a.dataset.open); }); });
    host.querySelectorAll('[data-tick]').forEach(function(b){ b.addEventListener('click',function(e){ e.stopPropagation(); toggleAdded(b.dataset.tick); }); });
    host.querySelectorAll('.tap[data-sku]').forEach(function(t){ t.addEventListener('click',function(){ openHpSku(t.dataset.sku); }); });
    renderHpStrip();
  }

  // one row of the comparison checklist
  function hpRow(it){
    var k=it.item_key, sku=chosenSku(k);
    var st=S.hp.picked[k]||''; var added=st==='added';
    var title=it.label || cap(it.name);
    var photo='<div class="ph"'+(sku.image?' style="background-image:url('+esc(sku.image)+')"':'')+'>'+(sku.image?'':'<span>'+esc(title.slice(0,1))+'</span>')+'</div>';
    var matched=sku.matched ? '<small class="mt">'+esc(sku.matched)+'</small>' : '';
    var hpUnit=(sku.unit && sku.unit_price_paise) ? '₹'+rupees(sku.unit_price_paise)+'/'+esc(sku.unit) : '₹'+rupees(sku.price_paise);
    var verdict;
    if(it.verified && it.verdict && !S.hp.stale){
      var yours='your ₹'+rupees(it.your_unit_paise)+'/'+esc(it.your_unit||sku.unit);
      if(it.verdict==='cheaper') verdict='<span class="vd ok">'+it.pct+'% cheaper than '+yours+'</span>';
      else if(it.verdict==='dearer') verdict='<span class="vd warn">'+Math.abs(it.pct)+'% dearer than '+yours+'</span>';
      else verdict='<span class="vd mut">about the same as '+yours+'</span>';
    } else {
      verdict='<span class="vd mut">'+esc(it.no_compare_reason||'couldn’t compare')+'</span>';
    }
    var nopt=(it.options&&it.options.length)||1;
    var more=nopt>1 ? '<span class="more">⌄ '+nopt+'</span>' : '';
    var meta='<div class="meta"><span class="uu big">'+hpUnit+'</span><span class="pk2">₹'+rupees(sku.price_paise)+(sku.pack?' · '+esc(sku.pack):'')+'</span>'+more+'</div>';
    var openCtl=added
      ? '<button class="hp-open done" data-tick="'+esc(k)+'">✓ Added</button>'
      : '<a class="hp-open'+(st==='opened'?' op':'')+'" href="'+esc(hpOpenUrl(it.name))+'" target="_blank" rel="noopener" data-open="'+esc(k)+'">'+(st==='opened'?'Opened ↗':'Open ↗')+'</a>'+
        '<button class="hp-tick'+(st==='opened'?' on':'')+'" data-tick="'+esc(k)+'" aria-label="mark added">'+(st==='opened'?'mark added':'✓')+'</button>';
    return '<div class="hpitem'+(added?' added':'')+'">'+
      '<div class="tap" data-sku="'+esc(k)+'">'+photo+'<div class="nm"><b>'+esc(title)+'</b>'+matched+verdict+meta+'</div></div>'+
      '<div class="right">'+openCtl+'</div></div>';
  }

  // 3-state checklist (TO ADD → OPENED → ADDED), persisted so it survives the app-switch to Hyperpure
  function markOpened(k){ if(S.hp.picked[k]!=='added'){ S.hp.picked[k]='opened'; saveWork(); setTimeout(renderHpFeed,0); } }
  function toggleAdded(k){ S.hp.picked[k]=(S.hp.picked[k]==='added')?'opened':'added'; saveWork(); renderHpFeed(); }

  function cap(s){ s=String(s||''); return s.charAt(0).toUpperCase()+s.slice(1); }
  // one-tap jump straight to this item on Hyperpure (search endpoint = never dead-ends,
  // opens in the Hyperpure app via universal link, lands on the pre-filtered product list).
  function hpOpenUrl(q){ q=String(q||'').trim(); var e=encodeURIComponent(q); return 'https://www.hyperpure.com/in/search/'+e+'?query='+e; }
  function feedItem(k){ return S.hp.feed.find(function(x){return x.item_key===k;}); }
  // the SKU shown for an item = the picked override, else the cheapest from the feed
  function chosenSku(k){
    var fi=feedItem(k); if(!fi) return {};
    var v=S.hp.chosen[k], src=v||fi;
    return { item_key:k, name:fi.name, matched:src.matched, price_paise:src.price_paise,
             unit_price_paise:src.unit_price_paise, unit:src.unit, pack:src.pack, brand:src.brand, image:src.image };
  }

  // ── SKU chooser: swap the cheapest match for a related SKU, or search Hyperpure ──
  function chooseSku(k, opt){ S.hp.chosen[k]=opt; renderHpFeed(); }
  function openHpSku(k){
    var fi=feedItem(k); if(!fi) return;
    var opts = (fi.options&&fi.options.length) ? fi.options.slice(0)
      : [{matched:fi.matched,pack:fi.pack,brand:fi.brand,unit:fi.unit,price_paise:fi.price_paise,unit_price_paise:fi.unit_price_paise,image:fi.image}];
    var curName=(S.hp.chosen[k]&&S.hp.chosen[k].matched)||fi.matched;
    var searchUrl=hpOpenUrl(fi.name);
    var rowsHtml=opts.map(function(o,i){
      var ph='<div class="ph sm"'+(o.image?' style="background-image:url('+esc(o.image)+')"':'')+'>'+(o.image?'':'<span>'+esc((o.matched||'?').slice(0,1))+'</span>')+'</div>';
      var pu=(o.unit&&o.unit_price_paise)?' · ₹'+rupees(o.unit_price_paise)+'/'+esc(o.unit):'';
      var bdg=(i===0)?'<span class="bdg">cheapest</span>':'';
      var sel=(o.matched===curName)?' sel':'';
      return '<div class="skurow'+sel+'" data-pick="'+i+'">'+ph+
        '<div class="si"><b>'+esc(o.matched||'—')+'</b><small>'+esc(o.pack||'')+pu+'</small></div>'+
        '<div class="sp">₹'+rupees(o.price_paise)+bdg+'</div></div>';
    }).join('');
    var h='<div class="ov" id="ov"><div class="sheet"><h2>'+esc(cap(fi.label||fi.name))+' · on Hyperpure</h2>'+
      '<div class="skuhint">Cheapest is shown by default — tap another to swap, or search Hyperpure for the exact one.</div>'+
      '<div class="skulist">'+rowsHtml+'</div>'+
      '<a class="hpsearch" href="'+esc(searchUrl)+'" target="_blank" rel="noopener">Search “'+esc(fi.label||fi.name)+'” on Hyperpure ↗</a>'+
      '</div></div>';
    var hostEl=document.getElementById('sheetHost'); hostEl.innerHTML=h;
    document.getElementById('ov').addEventListener('click',function(e){ if(e.target.id==='ov') hostEl.innerHTML=''; });
    hostEl.querySelectorAll('.skurow[data-pick]').forEach(function(r){ r.addEventListener('click',function(){ chooseSku(k, opts[+r.dataset.pick]); hostEl.innerHTML=''; toast('Picked','info'); }); });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // COMPARE — cheapest across platforms, per product (swipe to see each source)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function srcLabel(k){ var s=S.cmp.sources[k]; return (s&&s.label)||cap(k); }
  function loadCompare(){
    var list=document.getElementById('cmpList');
    list.innerHTML='<div class="empty">Loading…</div>'; document.getElementById('cmpEmpty').classList.add('hide');
    api('compare').then(function(res){
      if(!res.ok){ toast(res.j&&res.j.error||'compare failed','err'); return; }
      S.cmp.items=res.j.items||[]; S.cmp.sources=res.j.sources||{};
      renderCompare();
    }).catch(function(){ toast('No connection','err'); });
  }
  function renderCompare(){
    var host=document.getElementById('cmpList'), empty=document.getElementById('cmpEmpty'), head=document.getElementById('cmpHead');
    if(!S.cmp.items.length){ host.innerHTML=''; empty.classList.remove('hide'); renderSummary(); return; }
    empty.classList.add('hide');
    var wins=S.cmp.items.filter(function(it){return it.beats_baseline;}).length;
    head.innerHTML='<span class="ttl">'+S.cmp.items.length+' items · your price vs every platform</span>'+
      (wins?'<span class="fresh" style="color:var(--green)">'+wins+' cheaper online</span>':'');
    host.innerHTML=S.cmp.items.map(function(it){
      var best=it.sources[0];
      var img=(best&&best.image)?' style="background-image:url('+esc(best.image)+')"':'';
      var line;
      if(it.beats_baseline){ line='<span class="src-badge '+esc(it.cheapest_source)+'">'+esc(srcLabel(it.cheapest_source))+'</span><span class="save">save ₹'+rupees(it.save_unit_paise)+'/'+esc(it.unit)+'</span>'; }
      else if(best){ line='<span class="lb" style="font-size:11px;color:var(--mute)">best online ₹'+rupees(best.unit_price_paise)+'/'+esc(it.unit)+' · not cheaper</span>'; }
      else { line='<span class="lb" style="font-size:11px;color:var(--mute)">no online price yet</span>'; }
      return '<div class="cmprow'+(it.beats_baseline?' win':'')+'" data-cmp="'+esc(it.item_key)+'">'+
        '<div class="ph"'+img+'>'+((best&&best.image)?'':'<span>'+esc((it.label||it.item_key).slice(0,1))+'</span>')+'</div>'+
        '<div class="ci"><div class="nm">'+esc(it.label||it.item_key)+'</div><div class="src">'+line+'</div></div>'+
        '<div class="cr"><div class="pu" style="font-size:9.5px">you pay</div><div class="pr">₹'+rupees(it.your_paise)+'</div>'+
          '<div class="pu">'+esc(it.your_pack||'')+'</div><div class="chev">compare ›</div></div></div>';
    }).join('');
    host.querySelectorAll('.cmprow[data-cmp]').forEach(function(r){ r.addEventListener('click',function(){ openCompareSheet(r.dataset.cmp); }); });
    renderSummary();
  }
  function renderSummary(){
    var host=document.getElementById('cmpSummary');
    var wins=S.cmp.items.filter(function(it){return it.beats_baseline;});
    if(!S.cmp.items.length){ host.innerHTML=''; return; }
    if(!wins.length){ host.innerHTML='<div class="pchip ok"><div class="ph-n">Your prices hold</div><div class="ph-s">no platform beats you yet</div></div>'; return; }
    var byp={}; wins.forEach(function(it){ byp[it.cheapest_source]=(byp[it.cheapest_source]||0)+1; });
    host.innerHTML='<div class="pchip ok"><div class="ph-n">'+wins.length+' cheaper online</div>'+
      '<div class="ph-s">'+Object.keys(byp).map(function(k){return srcLabel(k)+' '+byp[k];}).join(' · ')+'</div></div>';
  }
  function openCompareSheet(key){
    var it=S.cmp.items.find(function(x){return x.item_key===key;}); if(!it) return;
    var cards=[];
    // tier 0 — your current price (the bar to beat)
    cards.push('<div class="pcard"><div class="pc-top"><span class="src-badge" style="background:rgba(255,255,255,.08);color:var(--text)">Your price</span></div>'+
      '<div class="pc-ph"><span>₹</span></div>'+
      '<div class="pc-body"><div class="pc-nm">What you pay now</div>'+
      '<div class="pc-meta">'+(it.your_pack?'<span class="pc-pack">'+esc(it.your_pack)+'</span>':'')+(it.your_unit_paise?'<span style="font-size:10.5px;color:var(--mute)">₹'+rupees(it.your_unit_paise)+'/'+esc(it.unit)+'</span>':'')+'</div>'+
      '<div class="pc-price"><b>₹'+rupees(it.your_paise)+'</b><small>current vendor</small></div></div></div>');
    it.sources.forEach(function(s){
      var cfg=S.cmp.sources[s.source]||{}; var win=(s.source===it.cheapest_source && it.beats_baseline);
      var ph=s.image?' style="background-image:url('+esc(s.image)+')"':'';
      var kind=cfg.kind==='next-day'?'next-day':'instant';
      var cmp=(it.your_unit_paise&&s.unit_price_paise)?(s.unit_price_paise<it.your_unit_paise?'<span class="save">₹'+rupees(it.your_unit_paise-s.unit_price_paise)+'/'+esc(it.unit)+' cheaper</span>':'<span style="font-size:10px;color:var(--mute)">dearer than you</span>'):'';
      var buy=s.url?'<a class="pc-buy open" href="'+esc(s.url)+'" target="_blank" rel="noopener">Open on '+esc(srcLabel(s.source))+' ↗</a>':'';
      cards.push('<div class="pcard'+(win?' best':'')+'">'+
        '<div class="pc-top"><span class="src-badge '+esc(s.source)+'">'+esc(srcLabel(s.source))+'</span><span class="sb"></span>'+
          (win?'<span class="src-badge" style="background:var(--green-soft);color:var(--green)">cheapest</span>':'')+'</div>'+
        '<div class="pc-ph"'+ph+'>'+(s.image?'':'<span>'+esc((it.label||key).slice(0,1))+'</span>')+'</div>'+
        '<div class="pc-body"><div class="pc-nm">'+esc(s.matched||it.label)+'</div>'+
          '<div class="pc-meta">'+(s.pack?'<span class="pc-pack">'+esc(s.pack)+'</span>':'')+
            (s.unit&&s.unit_price_paise?'<span style="font-size:10.5px;color:var(--mute)">₹'+rupees(s.unit_price_paise)+'/'+esc(s.unit)+'</span>':'')+'</div>'+
          '<div class="pc-price"><b>₹'+rupees(s.price_paise)+'</b><small>'+esc(kind)+'</small></div>'+cmp+buy+'</div></div>');
    });
    if(!it.sources.length){ cards.push('<div class="pcard"><div class="pc-body" style="padding:34px 13px;text-align:center;color:var(--mute)">No online price scraped yet —<br>the scout checks tonight.</div></div>'); }
    var h='<div class="ov" id="ov"><div class="sheet"><h2>'+esc(it.label||key)+'</h2>'+
      '<div class="skuhint">Your price vs each platform — swipe. Green means cheaper than you pay now.</div>'+
      '<div class="pcards">'+cards.join('')+'</div></div></div>';
    var host=document.getElementById('sheetHost'); host.innerHTML=h;
    document.getElementById('ov').addEventListener('click',function(e){ if(e.target.id==='ov') host.innerHTML=''; });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // BUY LIST — need-first. Add what to buy for tomorrow (item + qty). The engine
  // (v1: Claude, manually from the box) routes each line to its cheapest workable
  // source. Reuses Compare data: your price + cheapest source already computed.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function syncWhenSeg(){ document.querySelectorAll('#whenSeg button').forEach(function(x){ x.classList.toggle('on', x.dataset.w===(S.buy.when||'today')); }); }
  function loadBuy(){
    syncWhenSeg();
    if(S.cmp.items.length){ renderBuy(); return; }
    document.getElementById('buyEmpty').textContent='Loading items…';
    api('compare').then(function(res){
      if(!res.ok){ toast(res.j&&res.j.error||'load failed','err'); return; }
      S.cmp.items=res.j.items||[]; S.cmp.sources=res.j.sources||{};
      renderBuy();
    }).catch(function(){ toast('No connection','err'); });
  }
  document.getElementById('buySearch').addEventListener('input', renderBuy);
  document.getElementById('whenSeg').addEventListener('click', function(e){
    var b=e.target.closest('button[data-w]'); if(!b) return;
    S.buy.when=b.dataset.w; syncWhenSeg(); renderBuy();
  });
  function renderBuy(){
    var host=document.getElementById('buyFeed'), empty=document.getElementById('buyEmpty'), hint=document.getElementById('buyHint');
    var q=(document.getElementById('buySearch').value||'').trim().toLowerCase();
    if(!S.cmp.items.length){ host.innerHTML=''; empty.textContent='No items yet.'; empty.classList.remove('hide'); updateBuyBar(); return; }
    empty.classList.add('hide');
    var whenTxt = S.buy.when==='tomorrow'
      ? 'For tomorrow — adds Hyperpure’s cheaper next-day rates'
      : 'For today — instant delivery + your morning market trip';
    hint.innerHTML='<span class="hp-pill">'+esc(whenTxt)+'</span>';
    var rows=S.cmp.items.filter(function(it){ return !q || (it.label||it.item_key).toLowerCase().indexOf(q)>=0; });
    host.innerHTML=rows.map(function(it){
      var k=it.item_key, best=it.sources&&it.sources[0];
      var img=(best&&best.image)?' style="background-image:url('+esc(best.image)+')"':'';
      var qv=S.buy.qty[k]||0, inb=qv>0;
      var ctrl = inb
        ? '<div class="step"><button data-bdec="'+esc(k)+'">−</button><input inputmode="decimal" data-bq="'+esc(k)+'" value="'+esc(String(qv))+'"><button data-binc="'+esc(k)+'">+</button></div>'
        : '<button class="add-pill" data-badd="'+esc(k)+'" aria-label="add">+</button>';
      var photo='<div class="ph"'+img+'>'+((best&&best.image)?'':'<span>'+esc((it.label||k).slice(0,1))+'</span>')+'</div>';
      // pure input — no prices here; photo + name + pack for clarity only
      return '<div class="hpitem'+(inb?' in':'')+'">'+
        '<div class="tap" style="cursor:default">'+photo+'<div class="nm"><b>'+esc(it.label||k)+'</b>'+
          (it.your_pack?'<div class="meta"><span class="pk">'+esc(it.your_pack)+'</span></div>':'')+'</div></div>'+
        '<div class="right">'+ctrl+'</div></div>';
    }).join('');
    host.querySelectorAll('[data-badd]').forEach(function(b){ b.addEventListener('click',function(){ setBuyQty(b.dataset.badd,1); }); });
    host.querySelectorAll('[data-binc]').forEach(function(b){ b.addEventListener('click',function(){ bumpBuy(b.dataset.binc,1); }); });
    host.querySelectorAll('[data-bdec]').forEach(function(b){ b.addEventListener('click',function(){ bumpBuy(b.dataset.bdec,-1); }); });
    host.querySelectorAll('input[data-bq]').forEach(function(inp){ inp.addEventListener('input',function(){ setBuyQty(inp.dataset.bq, parseFloat(inp.value)||0, true); }); });
    updateBuyBar();
  }
  function setBuyQty(k,qty,fromInput){ if(qty>0) S.buy.qty[k]=qty; else delete S.buy.qty[k]; if(!fromInput) renderBuy(); else updateBuyBar(); }
  function bumpBuy(k,d){ var nq=(S.buy.qty[k]||0)+d; if(nq<0)nq=0; setBuyQty(k, Math.round(nq*100)/100); }
  function buyKeys(){ return Object.keys(S.buy.qty).filter(function(k){ return S.buy.qty[k]>0; }); }
  function updateBuyBar(){
    var keys=buyKeys(), tot=document.getElementById('buyTot'), btn=document.getElementById('buySendBtn');
    var wl = S.buy.when==='tomorrow' ? 'tomorrow' : 'today';
    if(!keys.length){ tot.textContent=''; btn.disabled=true; btn.textContent='Add items for '+wl; return; }
    tot.innerHTML=keys.length+' item'+(keys.length>1?'s':'')+' to buy '+wl;
    btn.disabled=false; btn.textContent='Send '+wl+'’s list · '+keys.length+' item'+(keys.length>1?'s':'');
  }
  document.getElementById('buySendBtn').addEventListener('click', function(){
    if(busy) return; var keys=buyKeys(); if(!keys.length) return;
    var items=keys.map(function(k){ return { item_key:k, qty:S.buy.qty[k] }; });
    busy=true; var btn=this; btn.disabled=true; btn.textContent='Sending…';
    api('requisition',{method:'POST',body:{ items:items, need_by:S.buy.when }}).then(function(res){
      busy=false;
      if(!res.ok||!res.j||!res.j.ok){ toast((res.j&&res.j.error)||'Send failed','err'); updateBuyBar(); return; }
      toast('Sent '+res.j.count+' items for '+(res.j.for_date||'tomorrow')+' — finding cheapest','ok');
      S.buy.qty={}; renderBuy();
    }).catch(function(){ busy=false; toast('No connection','err'); updateBuyBar(); });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PASTE & DECODE — paste the staff's WhatsApp dump (or a screenshot); Claude
  // decodes it to a clean PO; review/edit; confirm → saved to the PO trail.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var decOrders=[], decNotes=[], decBrand='HE';
  document.getElementById('pasteBtn').addEventListener('click', openPasteSheet);
  function openPasteSheet(){
    var host=document.getElementById('sheetHost');
    host.innerHTML='<div class="ov" id="ov"><div class="sheet"><h2>Paste the WhatsApp order</h2>'+
      '<div class="seg" id="decBrandSeg" style="margin:0 0 11px"><button data-db="HE"'+(decBrand==='HE'?' class="on"':'')+'>Hamza Express</button><button data-db="NCH"'+(decBrand==='NCH'?' class="on"':'')+'>Nawabi Chai House</button></div>'+
      '<div class="skuhint">Pick the brand, then paste the items from WhatsApp — the names and times are NOT needed. I’ll clean and structure it. Or attach a screenshot.</div>'+
      '<textarea class="dec-ta" id="decTa" placeholder="Oil box&#10;Sunflower oil 4 letar&#10;Amul cream 1ltr&#10;Haldi powder 1kg&#10;…"></textarea>'+
      '<label class="dec-file">📷 or attach a screenshot<input type="file" id="decFile" accept="image/*" style="display:block;margin-top:5px"></label>'+
      '<button class="btn primary" id="decGo" style="width:100%;margin-top:12px">Decode</button></div></div>';
    document.getElementById('ov').addEventListener('click',function(e){ if(e.target.id==='ov') host.innerHTML=''; });
    document.getElementById('decBrandSeg').addEventListener('click',function(e){ var b=e.target.closest('button[data-db]'); if(!b)return; decBrand=b.dataset.db; this.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b);}); });
    document.getElementById('decGo').addEventListener('click', doDecode);
  }
  function doDecode(){
    if(busy) return;
    var ta=document.getElementById('decTa'), fileInp=document.getElementById('decFile');
    var text=((ta&&ta.value)||'').trim();
    var file=fileInp&&fileInp.files&&fileInp.files[0];
    if(!text && !file){ toast('Paste the text or attach a screenshot','err'); return; }
    var btn=document.getElementById('decGo'); busy=true; btn.disabled=true; btn.textContent='Decoding… (a few seconds)';
    function send(body){
      body.brand=decBrand;
      api('decode',{method:'POST',body:body}).then(function(res){
        busy=false;
        if(!res.ok||!res.j||!res.j.ok){ toast((res.j&&(res.j.detail||res.j.error))||'Decode failed','err'); btn.disabled=false; btn.textContent='Decode'; return; }
        renderDecodeReview(res.j.orders||[], res.j.notes||[]);
      }).catch(function(){ busy=false; toast('No connection','err'); btn.disabled=false; btn.textContent='Decode'; });
    }
    if(file){ var fr=new FileReader(); fr.onload=function(){ send(text?{image:fr.result,text:text}:{image:fr.result}); }; fr.readAsDataURL(file); }
    else { send({text:text}); }
  }
  function renderDecodeReview(orders, notes){
    decOrders=orders; decNotes=notes;
    var host=document.getElementById('sheetHost');
    var noteHtml=(notes&&notes.length)? notes.map(function(n){return '<div class="dec-note">⚠ '+esc(n)+'</div>';}).join('') : '';
    var body=orders.map(function(o,oi){
      var rows=(o.items||[]).map(function(it,ii){
        var sub=[(it.raw&&it.raw.toLowerCase()!==String(it.item||'').toLowerCase())?'from “'+esc(it.raw)+'”':'', it.category?esc(it.category):''].filter(Boolean).join(' · ');
        return '<div class="dec-it"><div class="di"><b>'+esc(it.item||'')+'</b>'+(sub?'<small>'+sub+'</small>':'')+(it.flag?'<span class="fl">⚠ '+esc(it.flag)+'</span>':'')+'</div>'+
          '<input inputmode="decimal" data-o="'+oi+'" data-i="'+ii+'" value="'+esc(it.qty||'')+'" placeholder="qty"><span class="du">'+esc(it.unit||'')+'</span>'+
          '<button class="dx" data-rmo="'+oi+'" data-rmi="'+ii+'" aria-label="remove">×</button></div>';
      }).join('');
      return '<div class="dec-order"><div class="dec-oh"><b>'+esc(o.brand||'')+'</b>'+(o.sender?'<span class="bdg">'+esc(o.sender)+'</span>':'')+'<span style="margin-left:auto;font-size:11px;color:var(--dim)">'+(o.items||[]).length+' items</span></div>'+rows+'</div>';
    }).join('');
    host.innerHTML='<div class="ov" id="ov"><div class="sheet"><h2>Review the order</h2>'+
      '<div class="skuhint">Cleaned and split by brand. Fix a quantity, drop a line with ×, then confirm. Amber means it needs your eye.</div>'+
      noteHtml+'<div style="max-height:52vh;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-bottom:12px">'+(body||'<div class="empty" style="padding:20px">Nothing decoded.</div>')+'</div>'+
      '<button class="btn primary" id="decConfirm" style="width:100%">Confirm &amp; save</button></div></div>';
    document.getElementById('ov').addEventListener('click',function(e){ if(e.target.id==='ov') host.innerHTML=''; });
    host.querySelectorAll('input[data-o]').forEach(function(inp){ inp.addEventListener('input',function(){ var o=decOrders[+inp.dataset.o]; if(o&&o.items[+inp.dataset.i]) o.items[+inp.dataset.i].qty=inp.value; }); });
    host.querySelectorAll('[data-rmo]').forEach(function(b){ b.addEventListener('click',function(){ var o=decOrders[+b.dataset.rmo]; if(o){ o.items.splice(+b.dataset.rmi,1); renderDecodeReview(decOrders, decNotes); } }); });
    document.getElementById('decConfirm').addEventListener('click', confirmDecode);
  }
  function confirmDecode(){
    if(busy) return;
    var orders=decOrders.filter(function(o){return o.items&&o.items.length;});
    if(!orders.length){ toast('Nothing to save','err'); return; }
    var btn=document.getElementById('decConfirm'); busy=true; btn.disabled=true; btn.textContent='Saving…';
    api('save-po',{method:'POST',body:{ orders:orders, need_by:S.buy.when }}).then(function(res){
      busy=false;
      if(!res.ok||!res.j||!res.j.ok){ toast((res.j&&res.j.error)||'Save failed','err'); btn.disabled=false; btn.textContent='Confirm & save'; return; }
      toast('Recorded '+res.j.items+' items · '+res.j.orders+' order'+(res.j.orders>1?'s':'')+' for '+(res.j.for_date||'tomorrow'),'ok');
      document.getElementById('sheetHost').innerHTML='';
    }).catch(function(){ busy=false; toast('No connection','err'); btn.disabled=false; btn.textContent='Confirm & save'; });
  }

  // ── Purchase diary: selected business date, PO inputs + placed vendor orders ──
  function fmtDayLabel(fd){
    if(!fd){ return {t:'—', sub:'', c:'dim'}; }
    var p=String(fd).split('-'); if(p.length<3){ return {t:fd, sub:'', c:'dim'}; }
    var d=new Date(+p[0], +p[1]-1, +p[2]);
    var n=new Date(); var t0=new Date(n.getFullYear(), n.getMonth(), n.getDate());
    var diff=Math.round((d - t0)/86400000);
    var WD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var pretty=WD[d.getDay()]+' '+(+p[2])+' '+MO[d.getMonth()];
    if(diff===0) return {t:'Today', sub:pretty, c:'today'};
    if(diff===1) return {t:'Tomorrow', sub:pretty, c:'tom'};
    if(diff===-1) return {t:'Yesterday', sub:pretty, c:'dim'};
    return {t:pretty, sub:'', c:'dim'};
  }
  function syncHistoryDate(){
    if(!S.hist.date) S.hist.date=defaultPurchaseDateIST();
    var el=document.getElementById('histDate'); if(el) el.value=S.hist.date;
  }
  function setHistoryDate(d, reload){
    S.hist.date=(d||defaultPurchaseDateIST()).slice(0,10);
    syncHistoryDate();
    saveWork();
    if(reload!==false) loadHistory();
  }
  function orderLineText(it){
    var q=(((it.qty||'')+' '+(it.unit||'')).trim())||'—';
    return '<div class="hline"><div class="hi"><b>'+esc(it.item||it.name||'')+'</b>'+
      ((it.raw&&it.raw!==it.item)?'<small>from '+esc(it.raw)+'</small>':'')+
      (it.flag?'<small style="color:var(--amber)">⚠ '+esc(it.flag)+'</small>':'')+
      (it.sku&&it.sku!==it.item?'<small>'+esc(it.sku)+'</small>':'')+'</div><span class="hq">'+esc(q)+'</span></div>';
  }
  function renderPoCard(o){
    var items=o.items||[];
    return '<div class="hist-card"><div class="hhd"><b>'+esc(o.brand||'')+'</b>'+
      (o.sender?'<small>'+esc(o.sender)+'</small>':'')+
      '<small style="margin-left:auto">'+items.length+' item'+(items.length===1?'':'s')+'</small></div>'+
      items.map(orderLineText).join('')+'</div>';
  }
  function renderPlacedCard(o){
    var items=o.items||[], amt=+o.expected_amount_paise||0;
    var note=/ashrafiya/i.test(o.vendor_name||'') ? '<div class="hist-note">Ashrafiya is one combined HE+NCH khata. This vendor can contain both brands, but settlement is one payment.</div>' : '';
    return '<div class="hist-card"><div class="hhd"><b>'+esc(o.vendor_name||'')+'</b>'+
      '<span class="tag f">'+esc(o.fulfilmentLabel||o.fulfilment||'')+'</span><span class="tag p">'+esc(o.payLabel||o.pay_timing||'')+'</span>'+
      '<small>'+esc(o.status||'')+'</small>'+(amt?'<span class="hamt">₹'+rupees(amt)+'</span>':'')+'</div>'+
      note+items.map(orderLineText).join('')+'</div>';
  }
  function loadHistory(){
    var list=document.getElementById('histList'), empty=document.getElementById('histEmpty'), head=document.getElementById('histHead');
    syncHistoryDate();
    var fd=S.hist.date||defaultPurchaseDateIST();
    list.innerHTML='<div class="empty">Loading…</div>'; empty.classList.add('hide'); head.innerHTML='';
    api('purchase-day&for_date='+encodeURIComponent(fd)).then(function(res){
      if(!res.ok||!res.j||!res.j.ok){ list.innerHTML=''; toast('Load failed','err'); return; }
      var po=res.j.po_orders||[], placed=res.j.placed_orders||[], s=res.j.summary||{};
      var L=fmtDayLabel(res.j.for_date||fd);
      head.innerHTML='<span class="ttl">'+esc(L.t)+(L.sub?' · '+esc(L.sub):'')+'</span>'+
        '<span class="fresh">'+(s.po_items||0)+' input item'+((s.po_items||0)===1?'':'s')+' · '+(s.placed_orders||0)+' vendor order'+((s.placed_orders||0)===1?'':'s')+'</span>';
      if(!po.length && !placed.length){ list.innerHTML=''; empty.classList.remove('hide'); return; }
      var html='<div class="hist-summary">'+
        '<div class="hist-box"><b>'+esc(String(s.po_items||0))+'</b><span>items entered</span></div>'+
        '<div class="hist-box"><b>'+esc(String(s.placed_orders||0))+'</b><span>vendor orders placed</span></div>'+
        '<div class="hist-box"><b>₹'+rupees(s.expected_amount_paise||0)+'</b><span>placed bill basis</span></div>'+
        '</div>';
      if(po.length) html+='<div class="hist-section">Purchase inputs</div>'+po.map(renderPoCard).join('');
      if(placed.length) html+='<div class="hist-section">Vendor orders placed</div>'+placed.map(renderPlacedCard).join('');
      list.innerHTML=html;
    }).catch(function(){ list.innerHTML=''; toast('No connection','err'); });
  }
  var histDateInput=document.getElementById('histDate');
  if(histDateInput) histDateInput.addEventListener('change', function(){ setHistoryDate(this.value); });
  var histDateBar=document.getElementById('histDateBar');
  if(histDateBar) histDateBar.addEventListener('click', function(e){
    var b=e.target.closest('button[data-hshift]'); if(!b) return;
    setHistoryDate(addDaysYmd(S.hist.date||defaultPurchaseDateIST(), parseInt(b.dataset.hshift,10)||0));
  });
  var histQuick=document.querySelector('.diary-quick');
  if(histQuick) histQuick.addEventListener('click', function(e){
    var b=e.target.closest('button[data-hquick]'); if(!b) return;
    setHistoryDate(b.dataset.hquick==='tomorrow'?ymdIST(1):ymdIST(0));
  });

  // ── Vendor diary — per-vendor records: paid / outstanding / full trail ──
  function fmtTs(s){ if(!s) return ''; try{ return String(s).slice(0,16).replace('T',' '); }catch(e){ return s; } }
  var VDIARY={q:'',filter:'all'};
  function lineBrief(lines, pendingRate){
    if(!Array.isArray(lines)||!lines.length) return '';
    return lines.slice(0,5).map(function(i){
      var q=[i.qty||'', i.unit||''].filter(Boolean).join(' ');
      var r=receiptSummary(i);
      var p=+i.price_paise>0 ? (' · bill ₹'+rupees(lineAmount(i))) : (pendingRate&&!i.direct?' · receipt/bill pending':'');
      return [i.item||i.name||'', q].filter(Boolean).join(' ') + (r?' · '+r:'') + p;
    }).filter(Boolean).join(' · ') + (lines.length>5 ? ' · +' +(lines.length-5)+' more' : '');
  }
  function diaryStage(t, signed){
    var st=String(t&&t.status||'').toUpperCase();
    var date=t&&t.for_date||'';
    if(t&&t.event){
      if(st==='OPENING') return {badge:'OPEN', tone:'amber', title:'Opening balance', noun:'balance'};
      if(st==='BILL') return {badge:'BILL', tone:'amber', title:businessDateLabel(date,'bill'), noun:'bill'};
      if(st==='PAYMENT') return {badge:'PAID', tone:'ok', title:businessDateLabel(date,'payment'), noun:'payment'};
      if(st==='RECEIPT') return {badge:'RCPT', tone:'amber', title:businessDateLabel(date,'receipt'), noun:'receipt'};
      return {badge:st||'EVENT', tone:signed<0?'ok':'dim', title:businessDateLabel(date,'entry'), noun:'entry'};
    }
    if(orderNeedsRate(t)) return {badge:'RCPT DUE', tone:'amber', title:businessDateLabel(date,'purchase')+' · receipt/rate pending', noun:'purchase'};
    if(st==='ORDERED') return {badge:'BILL READY', tone:(+t.amount_paise>0?'amber':'dim'), title:businessDateLabel(date,'purchase')+' · bill ready', noun:'purchase'};
    if(st==='REQUESTED') return {badge:'TO PAY', tone:'amber', title:businessDateLabel(date,'purchase')+' · payment pending', noun:'purchase'};
    if(st==='PAID') return {badge:'PAID', tone:'ok', title:businessDateLabel(date,'purchase')+' · paid', noun:'purchase'};
    return {badge:st||'ORDER', tone:'dim', title:businessDateLabel(date,'purchase'), noun:'purchase'};
  }
  function vendorHay(v){
    var trail=(v.trail||[]).map(function(t){
      return [t.status,t.for_date,t.ref,t.bank_ref,t.note,diaryStage(t,+t.signed_amount_paise||0).title,lineBrief(t.lines,orderNeedsRate(t)),(t.attachments||[]).map(function(a){return a.filename;}).join(' ')].join(' ');
    }).join(' ');
    return [v.vendorKey,v.vendor_name,v.cat,v.vpa,v.bankLabel,v.bank&&v.bank.account_name,v.bank&&v.bank.account_number,v.bank&&v.bank.ifsc,trail].join(' ').toLowerCase();
  }
  function renderVendorDiaryChips(vs){
    var ch=document.getElementById('venChips'); if(!ch) return;
    var due=vs.filter(function(v){return v.outstanding_paise>0;}).length;
    var paid=vs.filter(function(v){return v.entry_count>0 && v.outstanding_paise<=0;}).length;
    var withTrail=vs.filter(function(v){return v.entry_count>0;}).length;
    function chip(key,label,am){ return '<button class="fchip'+(am?' am':'')+(VDIARY.filter===key?' on':'')+'" data-vf="'+key+'">'+label+'</button>'; }
    ch.innerHTML=chip('all','All '+vs.length)+chip('due','Due '+due,true)+chip('trail','With trail '+withTrail)+chip('paid','Clear '+paid)+chip('afeefa','Afeefa');
  }
  function applyVendorDiaryFilter(vs){
    var q=(VDIARY.q||'').toLowerCase();
    return vs.filter(function(v){
      if(VDIARY.filter==='due' && !(v.outstanding_paise>0)) return false;
      if(VDIARY.filter==='paid' && !(v.entry_count>0 && v.outstanding_paise<=0)) return false;
      if(VDIARY.filter==='trail' && !(v.entry_count>0)) return false;
      if(VDIARY.filter==='afeefa' && !/afeefa|afifa/.test([v.vendorKey,v.vendor_name].join(' ').toLowerCase())) return false;
      return !q || vendorHay(v).indexOf(q)>=0;
    });
  }
  function openVendorMedia(id){
    if(!id) return;
    var win=null; try{ win=window.open('about:blank','_blank'); }catch(e){}
    fetch('/api/sauda?action=vendor-media&id='+encodeURIComponent(id), { headers: S.token ? { 'x-darbar-token': S.token } : {} })
      .then(function(r){ if(!r.ok) throw new Error('open failed'); return r.blob(); })
      .then(function(blob){
        var u=URL.createObjectURL(blob);
        if(win) win.location.href=u; else window.location.href=u;
        setTimeout(function(){ try{ URL.revokeObjectURL(u); }catch(e){} }, 60000);
      })
      .catch(function(){ if(win) win.close(); toast('Could not open invoice','err'); });
  }
  function loadVendors(){
    var list=document.getElementById('venList'), empty=document.getElementById('venEmpty'), head=document.getElementById('venHead');
    list.innerHTML='<div class="empty">Loading…</div>'; empty.classList.add('hide'); if(head) head.innerHTML='';
    api('vendor-ledger').then(function(res){
      if(!res.ok||!res.j||!res.j.ok){ list.innerHTML=''; toast('Load failed','err'); return; }
      var vs=res.j.vendors||[];
      if(!vs.length){ list.innerHTML=''; empty.classList.remove('hide'); return; }
      renderVendorDiaryChips(vs);
      var dueTotal=vs.reduce(function(s,v){return s+(+v.outstanding_paise||0);},0);
      var billedTotal=vs.reduce(function(s,v){return s+(+v.billed_paise||0);},0);
      var paidTotal=vs.reduce(function(s,v){return s+(+v.paid_paise||0);},0);
      if(head) head.innerHTML='<span class="ttl">'+vs.length+' vendors · billed ₹'+rupees(billedTotal)+' · paid ₹'+rupees(paidTotal)+'</span>'+
        (dueTotal?'<span class="fresh" style="color:var(--amber)">due ₹'+rupees(dueTotal)+'</span>':'<span class="fresh" style="color:var(--green)">all clear</span>');
      var rows=applyVendorDiaryFilter(vs);
      if(!rows.length){ list.innerHTML='<div class="empty">No matching vendor trail.</div>'; return; }
      list.innerHTML=rows.map(function(v,vi){
        var rail=v.payRail || paymentRail(v), bank=bankObj(v), bankText=bankSummary(bank);
        var pendingRates=(v.trail||[]).filter(orderNeedsRate).length;
        var trail=(v.trail||[]).map(function(t){
          var signed = (typeof t.signed_amount_paise==='number') ? t.signed_amount_paise : (+t.amount_paise||0);
          var amtText = (signed<0?'-':'')+'₹'+rupees(Math.abs(signed));
          var isEvent = !!t.event;
          var stage=diaryStage(t, signed);
          var itemLine = isEvent ? '' : lineBrief(t.lines, orderNeedsRate(t));
          var atts = Array.isArray(t.attachments) ? t.attachments : [];
          var attHtml = atts.length ? '<span class="attrow">'+atts.map(function(a){
            return '<button class="attbtn" data-att="'+esc(a.id)+'">'+esc(a.kind||'invoice')+(a.filename?' · '+esc(a.filename):'')+'</button>';
          }).join('')+'</span>' : '';
          var detail = isEvent
            ? [t.ref||t.bank_ref||'', t.note||'', t.attachment_count ? ('📎 '+t.attachment_count+' invoice'+(t.attachment_count>1?'s':'')) : ''].filter(Boolean).join(' · ')
            : (itemLine || (t.items+' item'+(t.items!==1?'s':'')));
          var when = isEvent
            ? ((t.method||'ledger')+' · '+(t.for_date||'')+(t.reconciled?' · ✓ bank':'' )).replace(/\s+·\s+$/,'')
            : (t.paid_at?('paid '+fmtTs(t.paid_at)+(t.method?' · '+esc(t.method):'')+(t.reconciled?' · ✓ bank':'')) : (t.pay_requested_at?('asked '+fmtTs(t.pay_requested_at)) : ('placed '+fmtTs(t.ordered_at))));
          return '<div class="tr"><span class="ts '+stage.tone+'">'+esc(stage.badge)+'</span>'+
            '<span class="ti"><b>'+esc(stage.title)+'</b>'+(detail?'<small>'+esc(detail)+'</small>':'')+'</span>'+
            '<span class="ta '+(signed<0?'neg':'')+'">'+esc(amtText)+'</span>'+
            '<span class="tw">'+esc(when)+'</span>'+attHtml+'</div>';
        }).join('');
        var right = v.outstanding_paise>0 ? '<span class="due">₹'+rupees(v.outstanding_paise)+' due</span>'
                  : (v.entry_count>0 ? '<span class="clr">clear</span>' : '');
        var meta = v.entry_count>0
          ? '<span>'+v.order_count+' order'+(v.order_count!==1?'s':'')+'</span>'+(pendingRates?'<span style="color:var(--amber)">receipt/rate pending '+pendingRates+'</span>':'')+'<span>billed ₹'+rupees(v.billed_paise||0)+'</span><span>paid ₹'+rupees(v.paid_paise)+'</span>'+(v.last_paid_at?'<span>last '+esc(fmtTs(v.last_paid_at))+'</span>':'')
          : '<span>'+esc(v.cat||'no orders in 30 days')+'</span>';
        var railText=v.vpa?esc(v.vpa):(bankText?esc(bankText):'manual only'+(v.cat?' · '+esc(v.cat):''));
        var buttonText=pendingRates?'Enter receipt / rates':'Save invoice + payment';
        return '<div class="ven"><div class="vhd" data-vi="'+vi+'">'+
          '<div class="vleft"><span class="bn">'+esc(v.vendor_name)+'</span>'+
            '<span class="tag f">'+esc(v.fulfilmentLabel||'')+'</span><span class="tag p">'+esc(v.payLabel||'')+'</span></div>'+
          '<div class="vright">'+right+'</div></div>'+
          '<div class="vpay"><span class="vid">'+railText+'</span>'+
            '<button class="paynow'+(pendingRates?' receipt':'')+(v.vpa?'':' manual')+'" data-act="'+(pendingRates?'rates':'invoice')+'" data-vk="'+esc(v.vendorKey)+'" data-vn="'+esc(v.vendor_name)+'" data-vpa="'+esc(v.vpa||'')+'" data-bank="'+esc(JSON.stringify(bank||{}))+'">'+buttonText+'</button></div>'+
          '<div class="vmeta">'+meta+'</div>'+
          '<div class="vtrail hide" id="vt'+vi+'">'+(trail||'<div style="padding:8px;color:var(--mute)">No orders in the last 30 days.</div>')+'</div></div>';
      }).join('');
      list.querySelectorAll('.vhd[data-vi]').forEach(function(h){ h.addEventListener('click',function(){ var el=document.getElementById('vt'+h.dataset.vi); if(el) el.classList.toggle('hide'); }); });
      list.querySelectorAll('.paynow').forEach(function(b){ b.addEventListener('click',function(e){ e.stopPropagation(); if(b.dataset.act==='rates'){ setMode('pay'); toast('Open the vendor card in To pay and enter receipt rates','info'); return; } openDirectPay(b.dataset.vk, b.dataset.vn, b.dataset.vpa, parseJsonAttr(b.dataset.bank)); }); });
      list.querySelectorAll('[data-att]').forEach(function(b){ b.addEventListener('click',function(e){ e.stopPropagation(); openVendorMedia(b.dataset.att); }); });
    }).catch(function(){ list.innerHTML=''; toast('No connection','err'); });
  }
  var venSearch=document.getElementById('venSearch');
  if(venSearch) venSearch.addEventListener('input', function(){ VDIARY.q=(this.value||'').trim().toLowerCase(); loadVendors(); });
  var venChips=document.getElementById('venChips');
  if(venChips) venChips.addEventListener('click', function(e){ var b=e.target.closest('button[data-vf]'); if(!b) return; VDIARY.filter=b.dataset.vf; loadVendors(); });

  // ── Settings: the item + vendor master (price · unit · vendor · fixed/live · phones/UPIs) ──
  var SET={items:[],vendors:[],tab:'items',q:'',needOnly:false,chip:'all'};
  var SET_UNITS=['kg','g','L','ml','pc','birds','crate','bunch','katta','bora','bag','cylinder','case','box','bundle','packet','bottle','trip'];
  var SET_FUL=['deliver','collect','standing','porter','bus'], SET_PAY=['per','khata_roll','khata_periodic'], SET_BRANDS=['both','NCH','HE'];
  function loadSettings(){
    var list=document.getElementById('setList'), empty=document.getElementById('setEmpty');
    empty.classList.remove('hide'); empty.textContent='Loading…'; list.innerHTML='';
    api('settings').then(function(res){
      if(!res.j||!res.j.ok){ empty.textContent='Load failed'; return; }
      SET.items=res.j.items||[]; SET.vendors=res.j.vendors||[]; renderSettings();
    }).catch(function(){ empty.textContent='No connection'; });
  }
  function vendorOpts(sel){ return '<option value="">— vendor —</option>'+SET.vendors.map(function(v){return '<option value="'+esc(v.vendor_key)+'"'+(v.vendor_key===sel?' selected':'')+'>'+esc(v.name)+'</option>';}).join(''); }
  function unitOpts(sel){ return '<option value="">unit</option>'+SET_UNITS.map(function(u){return '<option'+(u===sel?' selected':'')+'>'+u+'</option>';}).join(''); }
  function renderSettings(){
    var list=document.getElementById('setList'); document.getElementById('setEmpty').classList.add('hide');
    document.querySelectorAll('#setSeg button').forEach(function(b){ b.classList.toggle('on', b.dataset.s===SET.tab); });
    if(SET.tab==='items') renderSetItems(list); else renderSetVendors(list);
  }
  function itemMissing(i){ var m=[]; if(i.price_mode!=='live' && !(i.price_paise>0))m.push('price'); if(!i.unit)m.push('unit'); if(!i.default_vendor)m.push('vendor'); if(i.form==='defined'){ if(!i.brand)m.push('brand'); if(!i.pack_label)m.push('pack'); } return m; }
  function renderSetItems(list){
    var q=SET.q, chip=SET.chip||'all';
    function attn(i){ return i.flagged || itemMissing(i).length; }
    var pricedN=SET.items.filter(function(i){return !i.flagged && i.price_mode!=='live' && i.price_paise>0;}).length;
    var confirmN=SET.items.filter(function(i){return i.flagged;}).length;
    var noPriceN=SET.items.filter(function(i){return !i.flagged && i.price_mode!=='live' && !(i.price_paise>0);}).length;
    var liveN=SET.items.filter(function(i){return i.price_mode==='live';}).length;
    var noVenN=SET.items.filter(function(i){return !i.default_vendor;}).length;
    var vcount={}; SET.items.forEach(function(i){ if(i.default_vendor) vcount[i.default_vendor]=(vcount[i.default_vendor]||0)+1; });
    function vname(k){ var v=SET.vendors.find(function(x){return x.vendor_key===k;}); return v?v.name:k; }
    // ── filter chips: by VENDOR + by state, so it isn't one dead scroll ──
    function ch(key,label,am){ return '<button class="fchip'+(am?' am':'')+(chip===key?' on':'')+'" data-chip="'+esc(key)+'">'+label+'</button>'; }
    var chipsEl=document.getElementById('setChips');
    if(chipsEl){
      var vchips=Object.keys(vcount).sort(function(a,b){return vcount[b]-vcount[a];}).map(function(k){return ch('v:'+k, esc(vname(k))+' '+vcount[k]);}).join('');
      chipsEl.innerHTML=ch('all','All '+SET.items.length)+ch('novendor','◇ No vendor '+noVenN,true)+ch('noprice','○ No price '+noPriceN)+ch('confirm','⚠ Confirm '+confirmN,true)+ch('live','⏱ Live '+liveN)+vchips;
      chipsEl.classList.remove('hide');
      chipsEl.querySelectorAll('[data-chip]').forEach(function(b){ b.addEventListener('click',function(){ SET.chip=b.dataset.chip; renderSettings(); }); });
    }
    function pass(i){
      if(chip==='novendor') return !i.default_vendor;
      if(chip==='noprice') return !i.flagged && i.price_mode!=='live' && !(i.price_paise>0);
      if(chip==='confirm') return i.flagged;
      if(chip==='live') return i.price_mode==='live';
      if(chip==='attn') return attn(i);
      if(chip.indexOf('v:')===0) return i.default_vendor===chip.slice(2);
      return true;
    }
    var rows=SET.items.filter(function(i){ if(!pass(i)) return false; return !q || (i.label+' '+(i.aliases||[]).join(' ')).toLowerCase().indexOf(q)>=0; });
    var html='<div class="setcount">'+rows.length+' shown · <b style="color:var(--green)">'+pricedN+' priced</b> · <b style="color:var(--amber)">'+confirmN+' confirm</b> · <b style="color:var(--dim)">'+noPriceN+' no price</b> · <b style="color:var(--amber)">'+noVenN+' no vendor</b></div>';
    html+=rows.map(function(i){
      var live=i.price_mode==='live', def=i.form==='defined';
      var price=live
        ? '<button class="modet live" data-mode="'+esc(i.item_code)+'">LIVE</button>'
        : '<span class="rs">₹</span><input class="spin" data-sp="'+esc(i.item_code)+'" inputmode="decimal" value="'+(i.price_paise>0?(i.price_paise/100):'')+'" placeholder="'+(def?'pack ₹':'₹/'+(i.unit||'unit'))+'"><button class="modet" data-mode="'+esc(i.item_code)+'">fix</button>';
      var miss=itemMissing(i); var nc=(i.flagged||miss.length)?' need':'';
      var sub = i.flagged
        ? '<span style="color:var(--amber)">⚠ confirm: '+esc(i.note||'check this')+'</span>'
        : (miss.length?('<span style="color:var(--amber)">⚠ needs '+miss.join(' / ')+'</span>'):esc((i.aliases||[]).slice(0,5).join(', ')));
      var confirmBtn = i.flagged ? '<button class="modet" data-confirm="'+esc(i.item_code)+'" style="background:var(--green-soft);color:var(--green)">✓ ok</button>' : '';
      var skuline='<div class="skuline"><button class="formt'+(def?' sku':'')+'" data-form="'+esc(i.item_code)+'">'+(def?'SKU':'Loose')+'</button>'+
        (def
          ? '<input class="brin" data-sbr="'+esc(i.item_code)+'" value="'+esc(i.brand||'')+'" placeholder="brand"><input class="pkin" data-spk="'+esc(i.item_code)+'" value="'+esc(i.pack_label||'')+'" placeholder="pack e.g. 500 g">'
          : '<span class="loosehint">loose · price is per '+esc(i.unit||'unit')+'</span>')+'</div>';
      return '<div class="srow col'+nc+'"><div class="top"><div class="sl"><b>'+esc(i.label)+(i.flagged?' <span style="color:var(--amber)">⚠</span>':'')+'</b><small>'+sub+'</small></div>'+
        '<div class="sf"><div class="r1">'+price+confirmBtn+'</div><div class="r2"><select data-su="'+esc(i.item_code)+'">'+unitOpts(i.unit)+'</select>'+
        '<select data-sv="'+esc(i.item_code)+'">'+vendorOpts(i.default_vendor)+'</select></div></div></div>'+skuline+'</div>';
    }).join('');
    html+='<button class="add" onclick="openAddItem()" style="margin-top:8px">+ add an item</button>';
    list.innerHTML=html;
    list.querySelectorAll('input[data-sp]').forEach(function(p){ p.addEventListener('change',function(){ var it=SET.items.find(function(x){return x.item_code===p.dataset.sp;}); var f={price_paise:Math.round((parseFloat(p.value)||0)*100)}; if(it&&it.flagged) f.flagged=0; saveItem(p.dataset.sp,f, !!(it&&it.flagged)); }); });
    list.querySelectorAll('[data-confirm]').forEach(function(b){ b.addEventListener('click',function(){ saveItem(b.dataset.confirm,{flagged:0},true); }); });
    list.querySelectorAll('select[data-su]').forEach(function(s){ s.addEventListener('change',function(){ saveItem(s.dataset.su,{unit:s.value}); }); });
    list.querySelectorAll('select[data-sv]').forEach(function(s){ s.addEventListener('change',function(){ saveItem(s.dataset.sv,{default_vendor:s.value}); }); });
    list.querySelectorAll('[data-mode]').forEach(function(b){ b.addEventListener('click',function(){ var it=SET.items.find(function(x){return x.item_code===b.dataset.mode;}); saveItem(b.dataset.mode,{price_mode:(it&&it.price_mode==='live')?'fixed':'live'},true); }); });
    list.querySelectorAll('[data-form]').forEach(function(b){ b.addEventListener('click',function(){ var it=SET.items.find(function(x){return x.item_code===b.dataset.form;}); saveItem(b.dataset.form,{form:(it&&it.form==='defined')?'loose':'defined'},true); }); });
    list.querySelectorAll('input[data-sbr]').forEach(function(p){ p.addEventListener('change',function(){ saveItem(p.dataset.sbr,{brand:p.value}); }); });
    list.querySelectorAll('input[data-spk]').forEach(function(p){ p.addEventListener('change',function(){ saveItem(p.dataset.spk,{pack_label:p.value}); }); });
  }
  function vendorMissing(v){ var m=[]; if(!v.phone)m.push('phone'); if(!(v.vpas&&v.vpas.length) && !validBankObj(bankObj(v)))m.push('payment rail'); return m; }
  function renderSetVendors(list){
    var q=SET.q;
    var ce=document.getElementById('setChips'); if(ce) ce.classList.add('hide');
    var inc=SET.vendors.filter(function(v){return vendorMissing(v).length;});
    var itemCount={}, itemIssues={};
    SET.items.forEach(function(i){
      if(!i.default_vendor) return;
      itemCount[i.default_vendor]=(itemCount[i.default_vendor]||0)+1;
      if(i.flagged||itemMissing(i).length) itemIssues[i.default_vendor]=(itemIssues[i.default_vendor]||0)+1;
    });
    var rows=SET.vendors.filter(function(v){ if(SET.chip==='attn' && !vendorMissing(v).length) return false; return !q || (v.name+' '+(v.aliases||[]).join(' ')).toLowerCase().indexOf(q)>=0; });
    function opts(arr,sel,lab){ return arr.map(function(x){return '<option value="'+esc(x)+'"'+(x===sel?' selected':'')+'>'+esc(lab?lab(x):x)+'</option>';}).join(''); }
    list.innerHTML='<div class="setcount">'+rows.length+' vendors · <b style="color:var(--amber)">'+inc.length+' to fill</b> · phone + UPI or bank rail required</div>'+
      '<button class="setadd" onclick="openAddVendor()">+ add vendor</button>'+rows.map(function(v){
      var vpa=(v.vpas&&v.vpas[0])||''; var miss=vendorMissing(v); var nc=miss.length?' need':'';
      var bank=bankObj(v), rail=vpa?'UPI':(validBankObj(bank)?'bank':'no rail');
      var cnt=itemCount[v.vendor_key]||0, iss=itemIssues[v.vendor_key]||0;
      var meta=(miss.length?'<span style="color:var(--amber)">⚠ add '+miss.join(' / ')+'</span>':esc(v.vendor_key)+' · '+esc(rail))+
        ' · '+cnt+' item'+(cnt===1?'':'s')+(iss?' · <span style="color:var(--amber)">'+iss+' item issue'+(iss===1?'':'s')+'</span>':'');
      return '<div class="srow col'+nc+'" data-vrow="'+esc(v.vendor_key)+'"><div class="top"><div class="sl"><b>'+esc(v.name)+'</b><small>'+meta+'</small></div></div>'+
        '<div class="vendor-edit">'+
          '<input data-vph="'+esc(v.vendor_key)+'" inputmode="tel" value="'+esc(v.phone||'')+'" placeholder="phone required">'+
          '<input data-vpa="'+esc(v.vendor_key)+'" value="'+esc(vpa)+'" placeholder="UPI ID">'+
          '<input class="wide" data-vcat="'+esc(v.vendor_key)+'" value="'+esc(v.cat||'')+'" placeholder="supplies e.g. tissues / packaging">'+
          '<input class="wide" data-vban="'+esc(v.vendor_key)+'" value="'+esc(bank.account_name||'')+'" placeholder="bank account name">'+
          '<input data-vbac="'+esc(v.vendor_key)+'" inputmode="numeric" value="'+esc(bank.account_number||'')+'" placeholder="bank account number">'+
          '<input data-vbif="'+esc(v.vendor_key)+'" value="'+esc(bank.ifsc||'')+'" placeholder="IFSC">'+
          '<input data-vbbank="'+esc(v.vendor_key)+'" value="'+esc(bank.bank||'')+'" placeholder="bank name">'+
          '<input data-vbbr="'+esc(v.vendor_key)+'" value="'+esc(bank.branch||'')+'" placeholder="branch">'+
          '<input data-vbqr="'+esc(v.vendor_key)+'" value="'+esc(bank.qr_ref||'')+'" placeholder="QR / reference">'+
          '<input data-vodoo="'+esc(v.vendor_key)+'" inputmode="numeric" value="'+esc(v.odoo_partner_id||'')+'" placeholder="Odoo vendor id">'+
          '<select data-vbrand="'+esc(v.vendor_key)+'">'+opts(SET_BRANDS,v.brand||'both')+'</select>'+
          '<select data-vf="'+esc(v.vendor_key)+'">'+opts(SET_FUL,v.fulfilment||'deliver')+'</select>'+
          '<select data-vpy="'+esc(v.vendor_key)+'">'+opts(SET_PAY,v.pay||'per',function(p){return p.replace('khata_','khata ');})+'</select>'+
          '<div class="vendor-actions"><button class="vitemadd" data-vadditem="'+esc(v.vendor_key)+'">+ item for vendor</button><button class="vsave" data-vsave="'+esc(v.vendor_key)+'">Save vendor</button></div>'+
        '</div></div>';
    }).join('');
    list.querySelectorAll('[data-vsave]').forEach(function(b){ b.addEventListener('click',function(){ saveVendorFromRow(b.dataset.vsave); }); });
    list.querySelectorAll('[data-vadditem]').forEach(function(b){ b.addEventListener('click',function(){ openAddItem(b.dataset.vadditem); }); });
  }
  function saveItem(code,fields,rerender){
    var it=SET.items.find(function(x){return x.item_code===code;}); if(it) for(var k in fields) it[k]=fields[k];
    api('settings-item',{method:'POST',body:Object.assign({item_code:code},fields)}).then(function(r){ var ok=r&&r.j&&r.j.ok; toast(ok?'saved ✓':'save failed',ok?'ok':'err'); if(rerender&&ok) renderSettings(); });
  }
  function fieldVal(sel){ var el=document.querySelector(sel); return el ? el.value.trim() : ''; }
  function validPhoneText(x){ return String(x||'').replace(/\D/g,'').length>=10; }
  function validVpaText(x){ return /@/.test(String(x||'')); }
  function saveVendorFromRow(key){
    var bank={
      account_name:fieldVal('[data-vban="'+key+'"]'),
      account_number:fieldVal('[data-vbac="'+key+'"]').replace(/\s+/g,''),
      ifsc:fieldVal('[data-vbif="'+key+'"]').toUpperCase().replace(/\s+/g,''),
      bank:fieldVal('[data-vbbank="'+key+'"]'),
      branch:fieldVal('[data-vbbr="'+key+'"]'),
      qr_ref:fieldVal('[data-vbqr="'+key+'"]')
    };
    var fields={
      phone:fieldVal('[data-vph="'+key+'"]'),
      vpas:[fieldVal('[data-vpa="'+key+'"]')].filter(Boolean),
      bank:bank,
      odoo_partner_id:fieldVal('[data-vodoo="'+key+'"]'),
      cat:fieldVal('[data-vcat="'+key+'"]'),
      brand:fieldVal('[data-vbrand="'+key+'"]')||'both',
      fulfilment:fieldVal('[data-vf="'+key+'"]')||'deliver',
      pay:fieldVal('[data-vpy="'+key+'"]')||'per'
    };
    if(!validPhoneText(fields.phone) && !validBankObj(bank)){ toast('phone required unless bank transfer vendor','err'); return; }
    if((!fields.vpas.length||!validVpaText(fields.vpas[0])) && !validBankObj(bank)){ toast('UPI or bank account required','err'); return; }
    saveVendor(key,fields,true);
  }
  function saveVendor(key,fields,reload){
    var v=SET.vendors.find(function(x){return x.vendor_key===key;});
    if(v){ if('phone' in fields)v.phone=fields.phone; if('vpas' in fields)v.vpas=fields.vpas; if('bank' in fields)v.bank=fields.bank; if('odoo_partner_id' in fields)v.odoo_partner_id=fields.odoo_partner_id; if('fulfilment' in fields)v.fulfilment=fields.fulfilment; if('pay' in fields)v.pay=fields.pay; if('cat' in fields)v.cat=fields.cat; if('brand' in fields)v.brand=fields.brand; }
    api('settings-vendor',{method:'POST',body:Object.assign({vendor_key:key},fields)}).then(function(r){ var ok=r&&r.j&&r.j.ok; toast(ok?'saved ✓':((r&&r.j&&r.j.error)||'save failed'),ok?'ok':'err'); if(ok&&reload) loadSettings(); });
  }
  function simpleOpts(arr,sel,lab){ return arr.map(function(x){return '<option value="'+esc(x)+'"'+(x===sel?' selected':'')+'>'+esc(lab?lab(x):x)+'</option>';}).join(''); }
  window.openAddVendor=function(){
    var host=document.getElementById('sheetHost');
    host.innerHTML='<div class="ov" id="ov"><div class="sheet"><h2>Add vendor</h2>'+
      '<div class="fld"><label>Vendor name</label><input id="av_name" placeholder="shop / person name"></div>'+
      '<div class="fld"><label>Phone required</label><input id="av_phone" inputmode="tel" placeholder="10 digit mobile"></div>'+
      '<div class="fld"><label>UPI ID required</label><input id="av_vpa" placeholder="name@bank"></div>'+
      '<div class="fld"><label>Supplies</label><input id="av_cat" placeholder="tissues / packaging"></div>'+
      '<div class="fld"><label>Brand</label><select id="av_brand">'+simpleOpts(SET_BRANDS,'both')+'</select></div>'+
      '<div class="fld"><label>Fulfilment</label><select id="av_ful">'+simpleOpts(SET_FUL,'deliver')+'</select></div>'+
      '<div class="fld"><label>Payment rule</label><select id="av_pay">'+simpleOpts(SET_PAY,'per',function(p){return p.replace('khata_','khata ');})+'</select></div>'+
      '<div class="fld"><label>First item to map (optional)</label><input id="av_item" placeholder="Tissue"></div>'+
      '<div class="fld"><label>Unit</label><select id="av_unit">'+unitOpts('')+'</select></div>'+
      '<div class="fld"><label>Price ₹ (optional)</label><input id="av_price" inputmode="decimal" placeholder="per unit"></div>'+
      '<button class="btn primary" id="av_go" style="width:100%">Add vendor</button></div></div>';
    document.getElementById('ov').addEventListener('click',function(e){ if(e.target.id==='ov') host.innerHTML=''; });
    document.getElementById('av_go').addEventListener('click',function(){
      var name=fieldVal('#av_name'), phone=fieldVal('#av_phone'), vpa=fieldVal('#av_vpa');
      if(!name){ toast('vendor name required','err'); return; }
      if(!validPhoneText(phone)){ toast('phone required','err'); return; }
      if(!validVpaText(vpa)){ toast('UPI ID required','err'); return; }
      var btn=document.getElementById('av_go'); btn.disabled=true; btn.textContent='Adding...';
      var body={vendor_key:'NEW',name:name,phone:phone,vpas:[vpa],cat:fieldVal('#av_cat'),brand:fieldVal('#av_brand')||'both',fulfilment:fieldVal('#av_ful')||'deliver',pay:fieldVal('#av_pay')||'per'};
      api('settings-vendor',{method:'POST',body:body}).then(function(r){
        if(!r||!r.j||!r.j.ok){ toast((r&&r.j&&r.j.error)||'vendor failed','err'); btn.disabled=false; btn.textContent='Add vendor'; return; }
        var key=r.j.vendor_key, item=fieldVal('#av_item'), price=parseFloat(fieldVal('#av_price'))||0;
        if(!item){ toast('vendor added ✓','ok'); host.innerHTML=''; loadSettings(); return; }
        api('settings-item',{method:'POST',body:{item_code:'NEW',label:item,form:'loose',unit:fieldVal('#av_unit'),price_paise:Math.round(price*100),price_mode:price>0?'fixed':'live',default_vendor:key,category:fieldVal('#av_cat')}})
          .then(function(ir){ if(ir&&ir.j&&ir.j.ok){ toast('vendor + item added ✓','ok'); SET.tab='items'; } else toast('vendor added, item failed','err'); host.innerHTML=''; loadSettings(); });
      }).catch(function(){ toast('No connection','err'); btn.disabled=false; btn.textContent='Add vendor'; });
    });
  };
  window.openAddItem=function(prefVendor){
    var host=document.getElementById('sheetHost');
    host.innerHTML='<div class="ov" id="ov"><div class="sheet"><h2>Add an item</h2>'+
      '<div class="fld"><label>Name</label><input id="ai_label"></div>'+
      '<div class="fld"><label>Form</label><select id="ai_form"><option value="loose">Loose (by weight)</option><option value="defined">Defined SKU (brand + pack)</option></select></div>'+
      '<div class="fld"><label>Brand (if SKU)</label><input id="ai_brand" placeholder="e.g. Aashirvaad"></div>'+
      '<div class="fld"><label>Pack (if SKU)</label><input id="ai_pack" placeholder="e.g. 500 g"></div>'+
      '<div class="fld"><label>Unit</label><select id="ai_unit">'+unitOpts('')+'</select></div>'+
      '<div class="fld"><label>Price ₹ (leave blank if live-priced)</label><input id="ai_price" inputmode="decimal"></div>'+
      '<div class="fld"><label>Vendor</label><select id="ai_vendor">'+vendorOpts(prefVendor||'')+'</select></div>'+
      '<button class="btn primary" id="ai_go" style="width:100%">Add to master</button></div></div>';
    document.getElementById('ov').addEventListener('click',function(e){ if(e.target.id==='ov') host.innerHTML=''; });
    document.getElementById('ai_go').addEventListener('click',function(){
      var label=document.getElementById('ai_label').value.trim(); if(!label){ toast('item name?','err'); return; }
      var price=parseFloat(document.getElementById('ai_price').value)||0;
      api('settings-item',{method:'POST',body:{item_code:'NEW',label:label,form:document.getElementById('ai_form').value,brand:document.getElementById('ai_brand').value,pack_label:document.getElementById('ai_pack').value,unit:document.getElementById('ai_unit').value,price_paise:Math.round(price*100),price_mode:price>0?'fixed':'live',default_vendor:document.getElementById('ai_vendor').value}})
        .then(function(r){ if(r&&r.j&&r.j.ok){ toast('added ✓','ok'); host.innerHTML=''; loadSettings(); } else toast('failed','err'); });
    });
  };
  document.getElementById('gear').addEventListener('click', function(){ setMode('settings'); });
  document.getElementById('setSeg').addEventListener('click', function(e){ var b=e.target.closest('button[data-s]'); if(b){ SET.tab=b.dataset.s; renderSettings(); } });
  document.getElementById('setSearch').addEventListener('input', function(){ SET.q=(this.value||'').trim().toLowerCase(); renderSettings(); });
  document.getElementById('setNeed').addEventListener('click', function(){ SET.chip=(SET.chip==='attn'?'all':'attn'); this.classList.toggle('on',SET.chip==='attn'); renderSettings(); });
  document.getElementById('setPdf').addEventListener('click', exportSettingsPDF);
  // Clean, read-only A4 audit of the master. The manager prints/saves this,
  // marks missing rates/units/vendors by hand, then updates the same Settings grid.
  function exportSettingsPDF(){
    if(!SET.items.length){ toast('Load settings first','err'); return; }
    function vendorFor(k){ return SET.vendors.find(function(x){return x.vendor_key===k;}) || null; }
    function vendorName(k){ if(!k) return 'UNASSIGNED'; var v=vendorFor(k); return v?v.name:k; }
    function firstVpa(v){ return (v&&v.vpas&&v.vpas[0]) ? v.vpas[0] : ''; }
    function paymentSummary(v){
      if(!v) return 'MISSING';
      if(firstVpa(v)) return 'UPI: '+firstVpa(v);
      var b=bankObj(v);
      if(validBankObj(b)) return 'Bank: '+(b.bank||'Bank')+' / a/c '+bankLast4(b)+' / '+b.ifsc;
      return 'MISSING';
    }
    function payLabel(p){ return String(p||'per').replace('khata_','khata '); }
    function statusOf(i){ var m=itemMissing(i); if(i.flagged) m.unshift('confirm'); if(i.price_mode==='live') m=m.filter(function(x){return x!=='price';}); return m.length?m.join(', '):(i.price_mode==='live'?'daily rate':'ready'); }
    function priceOf(i){
      if(i.price_mode==='live') return 'daily rate';
      if(i.price_paise>0) return 'Rs '+(Math.round(i.price_paise)/100).toLocaleString('en-IN')+(i.form==='defined'&&i.pack_label?' / '+i.pack_label:(i.unit?' / '+i.unit:''));
      return '';
    }
    function billBasis(i){
      if(i.price_mode==='live') return 'enter today rate x qty';
      if(i.form==='defined'&&i.pack_label) return 'qty packs x rate';
      if(i.unit) return 'qty '+i.unit+' x rate';
      return 'qty x rate';
    }
    var by={}; SET.items.forEach(function(i){ var k=i.default_vendor||''; (by[k]=by[k]||[]).push(i); });
    SET.vendors.forEach(function(v){ if(!by[v.vendor_key]) by[v.vendor_key]=[]; });
    var keys=Object.keys(by).sort(function(a,b){
      if(!a) return -1; if(!b) return 1;
      var va=vendorName(a).toLowerCase(), vb=vendorName(b).toLowerCase();
      return va<vb?-1:(va>vb?1:0);
    });
    var vendorBad=SET.vendors.filter(function(v){return vendorMissing(v).length;});
    var itemBad=SET.items.filter(function(i){return i.flagged||itemMissing(i).length;});
    var noVendor=SET.items.filter(function(i){return !i.default_vendor;}).length;
    var noUnit=SET.items.filter(function(i){return !i.unit;}).length;
    var noPrice=SET.items.filter(function(i){return i.price_mode!=='live'&&!(i.price_paise>0);}).length;
    var live=SET.items.filter(function(i){return i.price_mode==='live';}).length;
    var ready=SET.items.length-itemBad.length;
    var today=new Date().toLocaleString('en-IN');
    var fixRows='';
    vendorBad.forEach(function(v){
      fixRows+='<tr class="bad"><td>Vendor</td><td>'+esc(v.name)+'</td><td colspan="4">'+esc(vendorMissing(v).join(', '))+'</td><td></td></tr>';
    });
    itemBad.slice(0,80).forEach(function(i){
      fixRows+='<tr class="bad"><td>Item</td><td>'+esc(i.label)+'</td><td>'+esc(vendorName(i.default_vendor||''))+'</td><td>'+esc(i.unit||'')+'</td><td>'+esc(priceOf(i))+'</td><td>'+esc(statusOf(i))+'</td><td></td></tr>';
    });
    if(itemBad.length>80) fixRows+='<tr class="bad"><td colspan="7">'+(itemBad.length-80)+' more item issue(s) shown in vendor sections below.</td></tr>';
    var body='';
    keys.forEach(function(k){
      var v=vendorFor(k), vm=v?vendorMissing(v):['vendor'];
      var vmeta=v
        ? '<b>Phone:</b> '+esc(v.phone||'MISSING')+' &nbsp; <b>Payment:</b> '+esc(paymentSummary(v))+' &nbsp; <b>Supplies:</b> '+esc(v.cat||'')+' &nbsp; <b>Pay:</b> '+esc(payLabel(v.pay))+' &nbsp; <b>Fulfilment:</b> '+esc(v.fulfilment||'')
        : 'Items below do not have a vendor mapped yet.';
      body+='<section><h2>'+esc(vendorName(k))+' <span class="n">'+by[k].length+' item'+(by[k].length===1?'':'s')+'</span></h2>'+
        '<div class="vmeta '+((v&&vm.length)||!v?'warn':'')+'">'+vmeta+'</div>'+
        '<table><tr><th>Item</th><th>Unit / pack</th><th>Current rate</th><th>Bill basis</th><th>Status / missing</th><th>Today qty</th><th>Bill Rs / correction</th></tr>';
      by[k].sort(function(a,b){return a.label.localeCompare(b.label);}).forEach(function(i){
        var miss=itemMissing(i), bad=i.flagged||miss.length;
        var cls=bad?' class="bad"':(i.price_mode==='live'?' class="live"':'');
        var pack=i.form==='defined' ? [('SKU'), i.brand, i.pack_label].filter(Boolean).join(' · ') : 'loose';
        var up=[i.unit||'NO UNIT', pack].filter(Boolean).join(' / ');
        body+='<tr'+cls+'><td>'+esc(i.label)+'</td><td>'+esc(up)+'</td><td>'+esc(priceOf(i)||'NO PRICE')+'</td><td>'+esc(billBasis(i))+'</td><td>'+esc(statusOf(i))+'</td><td></td><td></td></tr>';
      });
      body+='</table></section>';
    });
    var html='<!doctype html><html><head><meta charset="utf-8"><title>Sauda · Vendor Price List</title>'+
      '<style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;margin:22px;color:#1a1a1a}'+
      '@page{size:A4 landscape;margin:9mm}h1{font-size:20px;margin:0 0 3px}.sub{color:#666;font-size:11.5px;margin-bottom:10px}'+
      '.printbar{position:sticky;top:0;background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px;margin-bottom:10px;display:flex;gap:8px;align-items:center}.printbar button{padding:7px 12px;border:0;border-radius:7px;background:#581810;color:#fff;font-weight:700}.printbar span{font-size:12px;color:#555}'+
      '.summary{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin:8px 0 10px}.box{border:1px solid #ddd;border-radius:6px;padding:6px}.box b{display:block;font-size:16px}.box span{font-size:10.5px;color:#666;text-transform:uppercase;letter-spacing:.03em}'+
      'h2{font-size:13.5px;margin:13px 0 4px;color:#581810;border-bottom:2px solid #581810;padding-bottom:3px;break-after:avoid}h2 .n{color:#999;font-weight:400}'+
      '.vmeta{font-size:10.5px;color:#444;margin:0 0 5px}.vmeta.warn{color:#b00020;font-weight:600}section{break-inside:avoid}'+
      'table{width:100%;border-collapse:collapse;font-size:10.2px;margin-bottom:7px}th{text-align:left;background:#f3efe8;padding:4px 5px;border:1px solid #d7d1c7}td{padding:4px 5px;border:1px solid #e3e3e3;vertical-align:top}'+
      'tr.bad td{background:#fff1dd;color:#7a2200;font-weight:600}tr.live td{background:#eef6ff}.fix h2{color:#7a2200;border-color:#7a2200}.blank{height:18px}'+
      '@media print{body{margin:0}.printbar{display:none}h2{break-after:avoid}section{break-inside:avoid}.summary{break-after:avoid}}</style></head><body>'+
      '<div class="printbar"><button onclick="window.print()">Print / Save PDF</button><span>A4 landscape · use this to fill missing unit, rate, vendor, and today bill amount.</span></div>'+
      '<h1>Sauda — Vendor Item Price Audit</h1><div class="sub">Generated '+esc(today)+' · payment must be built from item quantity x item rate, not a loose number.</div>'+
      '<div class="summary"><div class="box"><b>'+SET.vendors.length+'</b><span>vendors</span></div><div class="box"><b>'+vendorBad.length+'</b><span>vendor gaps</span></div><div class="box"><b>'+SET.items.length+'</b><span>items</span></div><div class="box"><b>'+ready+'</b><span>ready</span></div><div class="box"><b>'+noVendor+'</b><span>no vendor</span></div><div class="box"><b>'+noUnit+'</b><span>no unit</span></div><div class="box"><b>'+noPrice+'</b><span>no price</span></div></div>'+
      '<section class="fix"><h2>Fix Before Payment <span class="n">'+(vendorBad.length+itemBad.length)+' issue'+((vendorBad.length+itemBad.length)===1?'':'s')+' · '+live+' daily-rate item'+(live===1?'':'s')+'</span></h2>'+
      '<table><tr><th>Type</th><th>Name</th><th>Vendor</th><th>Unit</th><th>Rate</th><th>Missing / status</th><th>Correction</th></tr>'+(fixRows||'<tr><td colspan="7">No master-data gaps found.</td></tr>')+'</table></section>'+
      body+'</body></html>';
    var w=window.open('','_blank');
    if(!w){ toast('Allow pop-ups to export the PDF','err'); return; }
    w.document.write(html); w.document.close();
    setTimeout(function(){ try{ w.focus(); w.print(); }catch(e){} }, 500);
  }

  // ── misc ──
  function lock(){ try{ sessionStorage.removeItem(SKEY); }catch(e){} if(S.hp&&S.hp.tick) clearInterval(S.hp.tick);
    try{ localStorage.removeItem('sauda_work'); }catch(e){}
    S={token:null,user:'',role:'',cat:null,brand:'both',order:[],seq:0,hp:{feed:[],win:null,fresh:'',stale:false,picked:{},chosen:{},collapsed:{dearer:true,nomatch:true},tick:null},cmp:{items:[],sources:{},pick:{}},buy:{qty:{},when:'today'}};
    pin=''; renderDots(); app.classList.add('hide'); gate.classList.remove('hide'); }
  document.getElementById('lock').addEventListener('click', lock);
  function toast(msg,kind){ var h=document.getElementById('toastHost'); h.innerHTML='<div class="toast '+(kind||'info')+'">'+esc(msg)+'</div>'; setTimeout(function(){h.innerHTML='';},2200); }
  function esc(s){ return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  document.getElementById('keypad').addEventListener('click', function(e){ var b=e.target.closest('button[data-k]'); if(b) press(b.getAttribute('data-k')); });
  document.addEventListener('keydown', function(e){ if(!app.classList.contains('hide')) return; if(e.key>='0'&&e.key<='9') press(e.key); else if(e.key==='Backspace') press('del'); });

  // register the service worker (relative path → works on sauda.hnhotels.in root AND /ops/sauda/)
  if('serviceWorker' in navigator){ try{ navigator.serviceWorker.register('sw.js'); }catch(e){} }

  var existing=loadSession();
  if(existing){ S.token=existing.token; S.user=existing.user; S.role=existing.role; enter(); } else renderDots();
})();
