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
            hp: { feed: [], win: null, mov: 150000, del: 9900, fresh: '', basket: {} /* item_key -> {it, qty} */, chosen: {} /* item_key -> picked SKU override */, tick: null },
            cmp: { items: [], sources: {}, pick: {} /* item_key -> chosen source */ },
            buy: { qty: {} /* item_key -> qty */, when: 'today' /* today | tomorrow — decides feasible sources */ } };

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
  }

  // ── persist in-progress work so a Safari/iOS reload never loses it ──
  function saveWork(){ try{ localStorage.setItem('sauda_work', JSON.stringify({
    order:S.order, seq:S.seq, hpBasket:S.hp.basket, hpChosen:S.hp.chosen, cmpPick:S.cmp.pick, buyQty:S.buy.qty, buyWhen:S.buy.when })); }catch(e){} }
  function restoreWork(){ try{ var w=JSON.parse(localStorage.getItem('sauda_work')||'null'); if(!w) return;
    if(Array.isArray(w.order)) S.order=w.order; if(w.seq) S.seq=w.seq;
    if(w.hpBasket) S.hp.basket=w.hpBasket; if(w.hpChosen) S.hp.chosen=w.hpChosen;
    if(w.cmpPick) S.cmp.pick=w.cmpPick; if(w.buyQty) S.buy.qty=w.buyQty; if(w.buyWhen) S.buy.when=w.buyWhen; }catch(e){} }
  var _persist;
  function startPersist(){ if(_persist) return; _persist=setInterval(saveWork,3000);
    window.addEventListener('pagehide', saveWork);
    document.addEventListener('visibilitychange', function(){ if(document.hidden) saveWork(); }); }
  function fmtDate(){ var d=new Date(Date.now()+330*60000); return d.toUTCString().slice(0,11); }

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
    S.order.push({ id:++S.seq, item:it.name, qty:'', price:'', unit:it.unit||'', vendorKey:it.vendorKey||'unassigned', vendorName:it.vendorName||'Unassigned', brand:it.brand||'both' });
    renderOrder(); toast(it.name+' added','info');
  }
  function removeLine(id){ S.order=S.order.filter(function(l){return l.id!==id;}); renderOrder(); }
  function setQty(id,v){ var l=S.order.find(function(x){return x.id===id;}); if(l) l.qty=v; updatePlaceBtn(); }
  function setPrice(id,v){ var l=S.order.find(function(x){return x.id===id;}); if(l) l.price=v; updatePlaceBtn(); }

  function vendorMeta(key){ var v=(S.cat&&S.cat.vendors||[]).find(function(x){return x.key===key;}); return v||{key:key,name:key,fulfilment:'deliver',pay:'per',fulfilmentLabel:'delivers',payLabel:'pay per order'}; }

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
          '<div class="ff"><label>₹'+(l.unit?'/'+esc(l.unit):'')+'</label><input inputmode="decimal" value="'+esc(l.price||'')+'" data-p="'+l.id+'" placeholder="rate"></div></div></div>';
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
    if(qty>0){ if(l){ l.qty=qty; } else { S.order.push({ id:++S.seq, item:item.name, qty:qty, price:'', unit:item.unit||'', vendorKey:key, vendorName:vendorMeta(key).name, brand:item.brand||S.brand }); } }
    else if(l){ S.order=S.order.filter(function(x){return x!==l;}); }
  }
  function openVendorSheet(key){
    var v=(S.cat&&S.cat.vendors||[]).find(function(x){return x.key===key;}); if(!v) return;
    var meta=vendorMeta(key);
    var host=document.getElementById('sheetHost');
    function draw(){
      var items=(v.items||[]).filter(function(it){ return brandMatch(it.brand); });
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
        '<div class="skuhint">'+esc(meta.fulfilmentLabel)+' · '+esc(meta.payLabel)+' — tap the items you need today.</div>'+khata+
        '<div class="vlist-sheet">'+(rows||'<div class="empty" style="padding:20px">No saved items — add one below.</div>')+'</div>'+
        '<div class="vnew"><input id="vNewName" placeholder="Add an item not listed…" autocomplete="off"><button id="vNewAdd">Add</button></div>'+
        '<button class="btn primary" id="vDone" style="width:100%;margin-top:12px">Done</button></div></div>';
      host.innerHTML=h;
      document.getElementById('ov').addEventListener('click',function(e){ if(e.target.id==='ov'){ host.innerHTML=''; renderOrder(); } });
      document.getElementById('vDone').addEventListener('click',function(){ host.innerHTML=''; renderOrder(); });
      function byName(nm){ return (v.items||[]).find(function(x){return x.name===nm;})||{name:nm,unit:'',brand:S.brand}; }
      host.querySelectorAll('[data-vadd]').forEach(function(b){ b.addEventListener('click',function(){ vSetQty(key, byName(b.dataset.vadd), 1); draw(); }); });
      host.querySelectorAll('[data-vinc]').forEach(function(b){ b.addEventListener('click',function(){ var l=vLineFor(key,b.dataset.vinc); var q=(l&&parseFloat(l.qty))||0; vSetQty(key, byName(b.dataset.vinc), Math.round((q+1)*100)/100); draw(); }); });
      host.querySelectorAll('[data-vdec]').forEach(function(b){ b.addEventListener('click',function(){ var l=vLineFor(key,b.dataset.vdec); var q=(l&&parseFloat(l.qty))||0; vSetQty(key, byName(b.dataset.vdec), Math.max(0,Math.round((q-1)*100)/100)); draw(); }); });
      host.querySelectorAll('input[data-vq]').forEach(function(inp){ inp.addEventListener('input',function(){ vSetQty(key, byName(inp.dataset.vq), parseFloat(inp.value)||0); }); });
      var na=document.getElementById('vNewAdd'); na.addEventListener('click',function(){ var nm=document.getElementById('vNewName').value.trim(); if(!nm)return; vSetQty(key,{name:nm,unit:'',brand:S.brand},1); draw(); });
    }
    draw();
  }

  // ── place ──
  document.getElementById('placeBtn').addEventListener('click', function(){
    if(!S.order.length||busy) return;
    var bad=S.order.filter(function(l){ return String(l.qty).trim()===''; });
    if(bad.length && !confirm(bad.length+' item(s) have no quantity. Place anyway? (vendor will fill)')) return;
    busy=true; var btn=this; btn.disabled=true; btn.textContent='Placing…';
    var lines=S.order.map(function(l){ return { item:l.item, sku:l.item, qty:l.qty, unit:l.unit, vendorKey:l.vendorKey, brand:l.brand, price_paise:Math.round((parseFloat(l.price)||0)*100) }; });
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
    onSearch(); renderVendorList();
  });

  // ── mode toggle: Place · To pay · Hyperpure · Compare ──
  function setMode(m){
    var buy=document.getElementById('viewBuy'), place=document.getElementById('viewPlace'), pay=document.getElementById('viewPay'),
        hp=document.getElementById('viewHp'), cmp=document.getElementById('viewCompare'), hist=document.getElementById('viewHistory'),
        vend=document.getElementById('viewVendors');
    var buyBar=document.getElementById('buyBar'), placeBar=document.getElementById('placeBar'), hpBar=document.getElementById('hpBar'), cmpBar=document.getElementById('cmpBar');
    var h1=document.querySelector('.top h1');
    document.querySelectorAll('#modeSeg button').forEach(function(b){ b.classList.toggle('on', b.dataset.m===m); });
    [buy,place,pay,hp,cmp,hist,vend].forEach(function(v){ if(v) v.classList.add('hide'); });
    [buyBar,placeBar,hpBar,cmpBar].forEach(function(b){ b.classList.add('hide'); });
    if(m==='pay'){ pay.classList.remove('hide'); if(h1) h1.textContent="To pay"; loadPay(); }
    else if(m==='vendors'){ vend.classList.remove('hide'); if(h1) h1.textContent="Vendors"; loadVendors(); }
    else if(m==='hp'){ hp.classList.remove('hide'); hpBar.classList.remove('hide'); if(h1) h1.textContent="Tomorrow · Hyperpure"; loadHp(); }
    else if(m==='cmp'){ cmp.classList.remove('hide'); cmpBar.classList.remove('hide'); if(h1) h1.textContent="Compare prices"; loadCompare(); }
    else if(m==='saved'){ hist.classList.remove('hide'); if(h1) h1.textContent="Saved orders"; loadHistory(); }
    else if(m==='place'){ place.classList.remove('hide'); placeBar.classList.remove('hide'); if(h1) h1.textContent="Today's order"; }
    else { buy.classList.remove('hide'); buyBar.classList.remove('hide'); if(h1) h1.textContent="Buy list"; loadBuy(); }
  }
  document.getElementById('modeSeg').addEventListener('click', function(e){ var b=e.target.closest('button[data-m]'); if(b) setMode(b.dataset.m); });

  function rupees(p){ return (Math.round(+p||0)/100).toLocaleString('en-IN'); }
  function upiHref(vpa,vn,rs){ return vpa ? ('upi://pay?pa='+encodeURIComponent(vpa)+'&pn='+encodeURIComponent(vn)+(rs>0?'&am='+rs:'')+'&cu=INR&tn='+encodeURIComponent('Sauda')) : '#'; }

  function loadPay(){
    var list=document.getElementById('payList'), empty=document.getElementById('payEmpty');
    list.innerHTML='<div class="empty">Loading…</div>'; empty.classList.add('hide');
    api('open').then(function(res){
      var orders=(res.j&&res.j.orders)||[];
      if(!orders.length){ list.innerHTML=''; empty.classList.remove('hide'); return; }
      var html='';
      orders.forEach(function(o){
        var items=[]; try{ items=JSON.parse(o.items_json||'[]'); }catch(e){}
        var itemsTxt=items.map(function(i){ return esc(i.item)+(i.qty?(' '+esc(i.qty)+(i.unit?' '+esc(i.unit):'')):''); }).join(' · ');
        var amt=o.pay_amount_paise?rupees(o.pay_amount_paise):'';
        var ids=(o.ids||[]).join(',');
        var multi=(o.order_count>1)?'<span class="tag p">'+items.length+' items · '+o.order_count+' orders</span>':'<span class="tag p">'+items.length+' item'+(items.length>1?'s':'')+'</span>';
        html+='<div class="basket"><div class="bh"><span class="bn">'+esc(o.vendor_name)+'</span>'+
          '<span class="tag f">'+esc(o.fulfilmentLabel||'')+'</span><span class="tag p">'+esc(o.payLabel||'')+'</span>'+multi+'</div>'+
          '<div class="pb"><div class="its">'+(itemsTxt||'—')+'</div>'+
          (o.pay==='khata_roll'?'<div class="khata" style="margin:0 0 9px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg><span>Khata — clear the outstanding balance, not just this order.</span></div>':'')+
          '<div class="pay-row"><span class="rupee">₹</span><input inputmode="decimal" data-amt value="'+esc(amt)+'" placeholder="one payment for all items"></div>'+
          '<div class="pay-acts">'+
            '<a class="upi'+(o.vpa?'':' dis')+'" data-vpa="'+esc(o.vpa)+'" data-vn="'+esc(o.vendor_name)+'" href="'+upiHref(o.vpa,o.vendor_name,parseFloat(amt)||0)+'">'+(o.vpa?'Pay via UPI':'No UPI saved')+'</a>'+
            '<button class="done" data-ids="'+ids+'">Mark paid</button>'+
          '</div></div></div>';
      });
      list.innerHTML=html;
      function idsOf(el){ return (el.closest('.pb').querySelector('button[data-ids]').dataset.ids||'').split(',').map(Number).filter(Boolean); }
      list.querySelectorAll('input[data-amt]').forEach(function(inp){
        inp.addEventListener('input', function(){
          var a=inp.closest('.pb').querySelector('a[data-vpa]'); var rs=parseFloat(inp.value||'0')||0;
          a.href=upiHref(a.dataset.vpa, a.dataset.vn, rs);
        });
      });
      list.querySelectorAll('a[data-vpa]').forEach(function(a){
        a.addEventListener('click', function(){
          if(!a.dataset.vpa) return;
          var pb=a.closest('.pb'); var rs=parseFloat(pb.querySelector('input[data-amt]').value||'0')||0;
          if(rs>0) api('request-pay',{method:'POST',body:{ids:idsOf(a), amount_paise:Math.round(rs*100)}});
        });
      });
      list.querySelectorAll('button[data-ids]').forEach(function(b){
        b.addEventListener('click', function(){
          var ids=idsOf(b); var pb=b.closest('.pb'); var rs=parseFloat(pb.querySelector('input[data-amt]').value||'0')||0;
          if(busy||!ids.length) return; busy=true;
          api('mark-paid',{method:'POST',body:{ids:ids, amount_paise:Math.round(rs*100), method:'upi'}})
             .then(function(r){ busy=false; if(r&&r.ok&&r.j&&r.j.ok){ toast('Marked paid','ok'); loadPay(); } else toast('Failed','err'); })
             .catch(function(){ busy=false; toast('No connection','err'); });
        });
      });
    }).catch(function(){ list.innerHTML=''; toast('No connection','err'); });
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
      S.hp.mov = res.j.mov_paise||150000; S.hp.del = res.j.delivery_paise||9900;
      document.getElementById('movRight').textContent = 'of ₹'+rupees(S.hp.mov)+' minimum';
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
    var w=S.hp.win; if(!w){ return; }
    var strip=document.getElementById('hpStrip'); var pill='';
    var clock='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    if(w.open){
      var hh=Math.floor(w.mins_to_cutoff/60), mm=w.mins_to_cutoff%60;
      var left=hh>0?(hh+'h '+mm+'m'):(mm+'m');
      pill='<span class="hp-pill">'+clock+'Delivers '+esc(fmtDay(w.for_date))+' · order within '+left+'</span>';
    } else {
      pill='<span class="hp-pill warn">'+clock+'Cutoff passed · delivers '+esc(fmtDay(w.for_date))+'</span>';
    }
    var stale=isStale(S.hp.fresh);
    var fresh='<span class="hp-fresh'+(stale?' stale':'')+'">prices '+(S.hp.fresh?relTime(S.hp.fresh):'—')+(stale?' · stale':'')+'</span>';
    strip.innerHTML=pill+fresh;
  }

  document.getElementById('hpSearch').addEventListener('input', renderHpFeed);

  function renderHpFeed(){
    var host=document.getElementById('hpFeed'), empty=document.getElementById('hpEmpty');
    var q=(document.getElementById('hpSearch').value||'').trim().toLowerCase();
    if(!S.hp.feed.length){ host.innerHTML=''; empty.classList.remove('hide'); updateMov(); return; }
    empty.classList.add('hide');
    var rows=S.hp.feed.filter(function(it){ return !q || (it.name+' '+(it.matched||'')).toLowerCase().indexOf(q)>=0; });
    host.innerHTML = rows.map(function(it){
      var k=it.item_key, sku=chosenSku(k);
      var b=S.hp.basket[k]; var inb=b&&b.qty>0;
      var title = sku.matched || cap(it.name);
      var ctrl = inb
        ? '<div class="step"><button data-dec="'+esc(k)+'">−</button>'+
            '<input inputmode="decimal" data-q="'+esc(k)+'" value="'+esc(String(b.qty))+'">'+
            '<button data-inc="'+esc(k)+'">+</button></div>'
        : '<button class="add-pill" data-addhp="'+esc(k)+'" aria-label="add">+</button>';
      var photo = '<div class="ph"'+(sku.image?' style="background-image:url('+esc(sku.image)+')"':'')+'>'+
                  (sku.image?'':'<span>'+esc(title.slice(0,1))+'</span>')+'</div>';
      var perUnit = (sku.unit && sku.unit_price_paise) ? '<span class="uu">₹'+rupees(sku.unit_price_paise)+'/'+esc(sku.unit)+'</span>' : '';
      var nopt = (it.options&&it.options.length)||1;
      var more = nopt>1 ? '<span class="more">⌄ '+nopt+' options</span>' : '';
      var meta = '<div class="meta">'+(sku.pack?'<span class="pk">'+esc(sku.pack)+'</span>':'')+perUnit+more+'</div>';
      return '<div class="hpitem'+(inb?' in':'')+'">'+
        '<div class="tap" data-sku="'+esc(k)+'">'+photo+'<div class="nm"><b>'+esc(title)+'</b>'+meta+'</div></div>'+
        '<div class="right"><span class="pr">₹'+rupees(sku.price_paise)+'</span>'+ctrl+'</div></div>';
    }).join('');
    host.querySelectorAll('[data-addhp]').forEach(function(b){ b.addEventListener('click',function(e){ e.stopPropagation(); setHpQty(b.dataset.addhp,1); }); });
    host.querySelectorAll('[data-inc]').forEach(function(b){ b.addEventListener('click',function(e){ e.stopPropagation(); bumpHp(b.dataset.inc,1); }); });
    host.querySelectorAll('[data-dec]').forEach(function(b){ b.addEventListener('click',function(e){ e.stopPropagation(); bumpHp(b.dataset.dec,-1); }); });
    host.querySelectorAll('input[data-q]').forEach(function(inp){ inp.addEventListener('click',function(e){e.stopPropagation();}); inp.addEventListener('input',function(){ setHpQty(inp.dataset.q, parseFloat(inp.value)||0, true); }); });
    host.querySelectorAll('.tap[data-sku]').forEach(function(t){ t.addEventListener('click',function(){ openHpSku(t.dataset.sku); }); });
    updateMov();
  }
  function cap(s){ s=String(s||''); return s.charAt(0).toUpperCase()+s.slice(1); }
  function feedItem(k){ return S.hp.feed.find(function(x){return x.item_key===k;}); }
  // the SKU shown/ordered for an item = the picked override, else the cheapest from the feed
  function chosenSku(k){
    var fi=feedItem(k); if(!fi) return {};
    var v=S.hp.chosen[k], src=v||fi;
    return { item_key:k, name:fi.name, matched:src.matched, price_paise:src.price_paise,
             unit_price_paise:src.unit_price_paise, unit:src.unit, pack:src.pack, brand:src.brand, image:src.image };
  }
  function setHpQty(k,qty,fromInput){ var sku=chosenSku(k); if(!sku.matched&&!feedItem(k)) return;
    if(qty>0) S.hp.basket[k]={it:sku,qty:qty}; else delete S.hp.basket[k];
    if(!fromInput) renderHpFeed(); else updateMov(); }
  function bumpHp(k,d){ var b=S.hp.basket[k]; var q=(b?b.qty:0)+d; if(q<0)q=0; setHpQty(k, Math.round(q*100)/100); }

  // ── the 3-tier chooser: exact cheapest SKU · related SKUs · search on Hyperpure ──
  function chooseSku(k, opt){ S.hp.chosen[k]=opt; var b=S.hp.basket[k]; setHpQty(k, b?b.qty:1); }
  function openHpSku(k){
    var fi=feedItem(k); if(!fi) return;
    var opts = (fi.options&&fi.options.length) ? fi.options.slice(0)
      : [{matched:fi.matched,pack:fi.pack,brand:fi.brand,unit:fi.unit,price_paise:fi.price_paise,unit_price_paise:fi.unit_price_paise,image:fi.image}];
    var curName=(S.hp.chosen[k]&&S.hp.chosen[k].matched)||fi.matched;
    var searchUrl='https://www.hyperpure.com/in/search/'+encodeURIComponent(fi.name)+'?query='+encodeURIComponent(fi.name);
    var rowsHtml=opts.map(function(o,i){
      var ph='<div class="ph sm"'+(o.image?' style="background-image:url('+esc(o.image)+')"':'')+'>'+(o.image?'':'<span>'+esc((o.matched||'?').slice(0,1))+'</span>')+'</div>';
      var pu=(o.unit&&o.unit_price_paise)?' · ₹'+rupees(o.unit_price_paise)+'/'+esc(o.unit):'';
      var bdg=(i===0)?'<span class="bdg">cheapest</span>':'';
      var sel=(o.matched===curName)?' sel':'';
      return '<div class="skurow'+sel+'" data-pick="'+i+'">'+ph+
        '<div class="si"><b>'+esc(o.matched||'—')+'</b><small>'+esc(o.pack||'')+pu+'</small></div>'+
        '<div class="sp">₹'+rupees(o.price_paise)+bdg+'</div></div>';
    }).join('');
    var h='<div class="ov" id="ov"><div class="sheet"><h2>'+esc(cap(fi.name))+' · on Hyperpure</h2>'+
      '<div class="skuhint">Cheapest is picked by default — tap another to swap, or search Hyperpure for the exact one.</div>'+
      '<div class="skulist">'+rowsHtml+'</div>'+
      '<a class="hpsearch" href="'+esc(searchUrl)+'" target="_blank" rel="noopener">Search “'+esc(fi.name)+'” on Hyperpure ↗</a>'+
      '</div></div>';
    var hostEl=document.getElementById('sheetHost'); hostEl.innerHTML=h;
    document.getElementById('ov').addEventListener('click',function(e){ if(e.target.id==='ov') hostEl.innerHTML=''; });
    hostEl.querySelectorAll('.skurow[data-pick]').forEach(function(r){ r.addEventListener('click',function(){ chooseSku(k, opts[+r.dataset.pick]); hostEl.innerHTML=''; toast('Picked','info'); }); });
  }

  function hpSubtotal(){ var s=0; Object.keys(S.hp.basket).forEach(function(k){ var b=S.hp.basket[k]; s+=b.qty*(b.it.price_paise||0); }); return Math.round(s); }
  function updateMov(){
    var sub=hpSubtotal(), mov=S.hp.mov, del=S.hp.del;
    var fill=document.getElementById('movFill'), left=document.getElementById('movLeft'), right=document.getElementById('movRight'), btn=document.getElementById('hpPlaceBtn');
    var pct=Math.min(100, mov?Math.round(sub/mov*100):0);
    fill.style.width=pct+'%'; fill.classList.toggle('met', sub>=mov);
    var n=Object.keys(S.hp.basket).length;
    if(!n){ left.textContent='₹0'; right.textContent='of ₹'+rupees(mov)+' minimum'; btn.disabled=true; btn.textContent='Add items to start'; return; }
    left.textContent='₹'+rupees(sub)+' · '+n+' item'+(n>1?'s':'');
    if(sub<mov){ right.textContent='₹'+rupees(mov-sub)+' to go'; btn.disabled=true; btn.textContent='Add ₹'+rupees(mov-sub)+' more to reach minimum'; }
    else { right.textContent='+ ₹'+rupees(del)+' delivery = ₹'+rupees(sub+del); btn.disabled=false; btn.textContent='Send tomorrow’s order · ₹'+rupees(sub+del); }
  }

  document.getElementById('hpPlaceBtn').addEventListener('click', function(){
    if(busy) return; var sub=hpSubtotal(); if(sub<S.hp.mov) return;
    var lines=Object.keys(S.hp.basket).map(function(k){ var b=S.hp.basket[k];
      return { item_key:k, name:b.it.name, matched:b.it.matched, qty:b.qty, price_paise:b.it.price_paise,
               unit:b.it.unit, pack:b.it.pack, brand:b.it.brand, image:b.it.image }; });
    busy=true; var btn=this; btn.disabled=true; btn.textContent='Sending…';
    api('hyperpure-place',{method:'POST',body:{lines:lines}}).then(function(res){
      busy=false;
      if(!res.ok||!res.j||!res.j.ok){ toast(res.j&&res.j.j&&res.j.j.error||res.j&&res.j.error||'Place failed','err'); updateMov(); return; }
      toast('Queued for '+fmtDay(res.j.for_date)+' — confirm & pay in Hyperpure','ok');
      S.hp.basket={}; renderHpFeed();
    }).catch(function(){ busy=false; toast('No connection','err'); updateMov(); });
  });

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
      toast('Saved '+res.j.items+' items · '+res.j.orders+' order'+(res.j.orders>1?'s':'')+' for '+(res.j.for_date||'tomorrow'),'ok');
      document.getElementById('sheetHost').innerHTML='';
    }).catch(function(){ busy=false; toast('No connection','err'); btn.disabled=false; btn.textContent='Confirm & save'; });
  }

  // ── Saved orders (the PO trail) ──
  function loadHistory(){
    var list=document.getElementById('histList'), empty=document.getElementById('histEmpty'), head=document.getElementById('histHead');
    list.innerHTML='<div class="empty">Loading…</div>'; empty.classList.add('hide'); head.innerHTML='';
    api('po-history').then(function(res){
      if(!res.ok||!res.j||!res.j.ok){ list.innerHTML=''; toast('Load failed','err'); return; }
      var orders=res.j.orders||[];
      if(!orders.length){ list.innerHTML=''; empty.classList.remove('hide'); return; }
      head.innerHTML='<span class="ttl">'+orders.length+' saved order'+(orders.length>1?'s':'')+'</span>';
      list.innerHTML=orders.map(function(o){
        var hdr=esc(o.brand||'')+' · '+esc(o.for_date||'')+(o.need_by?' ('+esc(o.need_by)+')':'');
        var rows=(o.items||[]).map(function(it){
          var q=(((it.qty||'')+' '+(it.unit||'')).trim())||'—';
          return '<div class="dec-it"><div class="di"><b>'+esc(it.item||'')+'</b>'+(it.flag?'<span class="fl">⚠ '+esc(it.flag)+'</span>':'')+'</div><span class="du">'+esc(q)+'</span></div>';
        }).join('');
        return '<div class="dec-order"><div class="dec-oh"><b>'+hdr+'</b><span style="margin-left:auto;font-size:11px;color:var(--dim)">'+(o.items||[]).length+' items</span></div>'+rows+'</div>';
      }).join('');
    }).catch(function(){ list.innerHTML=''; toast('No connection','err'); });
  }

  // ── Vendors — per-vendor records: paid / outstanding / full trail (timestamps + method) ──
  function fmtTs(s){ if(!s) return ''; try{ return String(s).slice(0,16).replace('T',' '); }catch(e){ return s; } }
  function loadVendors(){
    var list=document.getElementById('venList'), empty=document.getElementById('venEmpty');
    list.innerHTML='<div class="empty">Loading…</div>'; empty.classList.add('hide');
    api('vendor-ledger').then(function(res){
      if(!res.ok||!res.j||!res.j.ok){ list.innerHTML=''; toast('Load failed','err'); return; }
      var vs=res.j.vendors||[];
      if(!vs.length){ list.innerHTML=''; empty.classList.remove('hide'); return; }
      list.innerHTML=vs.map(function(v,vi){
        var trail=(v.trail||[]).map(function(t){
          var when = t.paid_at?('paid '+fmtTs(t.paid_at)+(t.method?' · '+esc(t.method):'')) : (t.pay_requested_at?('asked '+fmtTs(t.pay_requested_at)) : ('placed '+fmtTs(t.ordered_at)));
          var stcls = t.status==='PAID'?'ok':(t.status==='REQUESTED'?'amber':'dim');
          return '<div class="tr"><span class="ts '+stcls+'">'+esc(t.status||'')+'</span>'+
            '<span class="ti">'+esc(t.for_date||'')+' · '+t.items+' item'+(t.items!==1?'s':'')+'</span>'+
            '<span class="ta">₹'+rupees(t.amount_paise)+'</span>'+
            '<span class="tw">'+esc(when)+'</span></div>';
        }).join('');
        return '<div class="ven"><div class="vhd" data-vi="'+vi+'">'+
          '<div class="vleft"><span class="bn">'+esc(v.vendor_name)+'</span>'+
            '<span class="tag f">'+esc(v.fulfilmentLabel||'')+'</span><span class="tag p">'+esc(v.payLabel||'')+'</span></div>'+
          '<div class="vright">'+(v.outstanding_paise>0?'<span class="due">₹'+rupees(v.outstanding_paise)+' due</span>':'<span class="clr">clear</span>')+'</div></div>'+
          '<div class="vmeta"><span>'+v.order_count+' order'+(v.order_count!==1?'s':'')+'</span><span>paid ₹'+rupees(v.paid_paise)+'</span>'+(v.last_paid_at?'<span>last '+esc(fmtTs(v.last_paid_at))+'</span>':'')+'</div>'+
          '<div class="vtrail hide" id="vt'+vi+'">'+(trail||'<div class="dim" style="padding:8px;color:var(--mute)">No orders.</div>')+'</div></div>';
      }).join('');
      list.querySelectorAll('.vhd[data-vi]').forEach(function(h){ h.addEventListener('click',function(){ var el=document.getElementById('vt'+h.dataset.vi); if(el) el.classList.toggle('hide'); }); });
    }).catch(function(){ list.innerHTML=''; toast('No connection','err'); });
  }

  // ── misc ──
  function lock(){ try{ sessionStorage.removeItem(SKEY); }catch(e){} if(S.hp&&S.hp.tick) clearInterval(S.hp.tick);
    try{ localStorage.removeItem('sauda_work'); }catch(e){}
    S={token:null,user:'',role:'',cat:null,brand:'both',order:[],seq:0,hp:{feed:[],win:null,mov:150000,del:9900,fresh:'',basket:{},chosen:{},tick:null},cmp:{items:[],sources:{},pick:{}},buy:{qty:{},when:'today'}};
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
