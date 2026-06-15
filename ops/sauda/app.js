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
            hp: { feed: [], win: null, mov: 150000, del: 9900, fresh: '', basket: {} /* item_key -> {it, qty} */, chosen: {} /* item_key -> picked SKU override */, tick: null } };

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
    setMode('place');
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

  // ── mode toggle: Place · To pay · Hyperpure ──
  function setMode(m){
    var place=document.getElementById('viewPlace'), pay=document.getElementById('viewPay'), hp=document.getElementById('viewHp');
    var placeBar=document.getElementById('placeBar'), hpBar=document.getElementById('hpBar');
    var h1=document.querySelector('.top h1');
    document.querySelectorAll('#modeSeg button').forEach(function(b){ b.classList.toggle('on', b.dataset.m===m); });
    [place,pay,hp].forEach(function(v){ v.classList.add('hide'); });
    placeBar.classList.add('hide'); hpBar.classList.add('hide');
    if(m==='pay'){ pay.classList.remove('hide'); if(h1) h1.textContent="To pay"; loadPay(); }
    else if(m==='hp'){ hp.classList.remove('hide'); hpBar.classList.remove('hide'); if(h1) h1.textContent="Tomorrow · Hyperpure"; loadHp(); }
    else { place.classList.remove('hide'); placeBar.classList.remove('hide'); if(h1) h1.textContent="Today's order"; }
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
        html+='<div class="basket"><div class="bh"><span class="bn">'+esc(o.vendor_name)+'</span>'+
          '<span class="tag f">'+esc(o.fulfilmentLabel||'')+'</span><span class="tag p">'+esc(o.payLabel||'')+'</span>'+
          (o.for_date?'<span class="tag p">'+esc(o.for_date)+'</span>':'')+'</div>'+
          '<div class="pb"><div class="its">'+(itemsTxt||'—')+'</div>'+
          (o.pay==='khata_roll'?'<div class="khata" style="margin:0 0 9px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg><span>Khata — clear the outstanding balance, not just this order.</span></div>':'')+
          '<div class="pay-row"><span class="rupee">₹</span><input inputmode="decimal" data-amt="'+o.id+'" value="'+esc(amt)+'" placeholder="amount"></div>'+
          '<div class="pay-acts">'+
            '<a class="upi'+(o.vpa?'':' dis')+'" data-vpa="'+esc(o.vpa)+'" data-vn="'+esc(o.vendor_name)+'" href="'+upiHref(o.vpa,o.vendor_name,parseFloat(amt)||0)+'">'+(o.vpa?'Pay via UPI':'No UPI saved')+'</a>'+
            '<button class="done" data-done="'+o.id+'">Mark paid</button>'+
          '</div></div></div>';
      });
      list.innerHTML=html;
      list.querySelectorAll('input[data-amt]').forEach(function(inp){
        inp.addEventListener('input', function(){
          var a=inp.closest('.pb').querySelector('a[data-vpa]'); var rs=parseFloat(inp.value||'0')||0;
          a.href=upiHref(a.dataset.vpa, a.dataset.vn, rs);
        });
      });
      list.querySelectorAll('a[data-vpa]').forEach(function(a){
        a.addEventListener('click', function(){
          if(!a.dataset.vpa) return;
          var pb=a.closest('.pb'); var id=+pb.querySelector('button[data-done]').dataset.done;
          var rs=parseFloat(pb.querySelector('input[data-amt]').value||'0')||0;
          if(rs>0) api('request-pay',{method:'POST',body:{id:id, amount_paise:Math.round(rs*100)}});
        });
      });
      list.querySelectorAll('button[data-done]').forEach(function(b){
        b.addEventListener('click', function(){
          var id=+b.dataset.done; var pb=b.closest('.pb'); var rs=parseFloat(pb.querySelector('input[data-amt]').value||'0')||0;
          if(busy) return; busy=true;
          var seq=rs>0?api('request-pay',{method:'POST',body:{id:id, amount_paise:Math.round(rs*100)}}):Promise.resolve();
          seq.then(function(){ return api('mark-paid',{method:'POST',body:{id:id, method:'upi'}}); })
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

  // ── misc ──
  function lock(){ try{ sessionStorage.removeItem(SKEY); }catch(e){} if(S.hp&&S.hp.tick) clearInterval(S.hp.tick);
    S={token:null,user:'',role:'',cat:null,brand:'both',order:[],seq:0,hp:{feed:[],win:null,mov:150000,del:9900,fresh:'',basket:{},chosen:{},tick:null}};
    pin=''; renderDots(); app.classList.add('hide'); gate.classList.remove('hide'); }
  document.getElementById('lock').addEventListener('click', lock);
  function toast(msg,kind){ var h=document.getElementById('toastHost'); h.innerHTML='<div class="toast '+(kind||'info')+'">'+esc(msg)+'</div>'; setTimeout(function(){h.innerHTML='';},2200); }
  function esc(s){ return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  document.getElementById('keypad').addEventListener('click', function(e){ var b=e.target.closest('button[data-k]'); if(b) press(b.getAttribute('data-k')); });
  document.addEventListener('keydown', function(e){ if(!app.classList.contains('hide')) return; if(e.key>='0'&&e.key<='9') press(e.key); else if(e.key==='Backspace') press('del'); });

  var existing=loadSession();
  if(existing){ S.token=existing.token; S.user=existing.user; S.role=existing.role; enter(); } else renderDots();
})();
