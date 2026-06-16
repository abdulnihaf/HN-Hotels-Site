// ═══════════════════════════════════════════════════════════════════════════
// HN purchase catalog — the REAL items the kitchen buys, with the quantity and
// the price the owner currently pays (the baseline to beat). Given verbatim by
// the owner 2026-06-16. This is the spine: every source (Hyperpure, Zepto,
// Blinkit, …) is matched against these items, and a platform only "wins" when
// its per-unit price beats `buy.base_paise / buy.qty`.
//
//   must : AND of OR-groups — each group needs ≥1 synonym in the SKU name
//   not  : any of these in the name → reject (wrong-form decoy)
//   band : sane per-unit ₹ (kg/L) window → rejects mis-parsed / off-category
//   unit : the base unit the per-unit price is expressed in (kg | L | pc)
//   buy  : { pack, qty (in base unit), base_paise } — what we buy & what we pay
//
// FLAGGED (need owner confirm on the exact product): apple_chilli, magaj,
// msg/tasting-powder, ruchi_gold_oil brand. Edit here → next nightly scrape uses it.
// ═══════════════════════════════════════════════════════════════════════════

// prepared/condiment forms a raw commodity should never resolve to (esp. on
// quick-commerce, which is decoy-heavy: meals, drinks, gift packs, flavoured…)
export const HP_GLOBAL_NOT = [
  'dressing','sauce','paste','dip','gravy','curry','chutney','pickle','ready to','ready-to',
  'instant','seasoning','marinade','spread','ketchup','mayo','mayonnaise','syrup','combo',
  'assorted','sample','flavoured','flavored','seekh','tikka','momo','nugget','patty','kebab','kabab',
  'soda','drink','juice','meal','chapati','makhani','infused','gift','twigs','namkeen','cookie','biscuit',
];

export const HP_CATALOG = [
  { key:'sugar', query:'sugar', label:'Sugar', unit:'kg', band:[18,130], buy:{pack:'50 kg',qty:50,base_paise:222000},
    must:[['sugar']], not:['brown','jaggery','icing','cube','powdered','demerara','sachet'] },
  { key:'butter_unsalted', query:'unsalted butter', label:'Butter (unsalted)', unit:'kg', band:[250,1500], buy:{pack:'500 g',qty:0.5,base_paise:28500},
    must:[['butter']], not:['garlic','peanut','cocoa','chocolate'] },
  { key:'atta', query:'atta', label:'Atta', unit:'kg', band:[16,130], buy:{pack:'1 kg',qty:1,base_paise:4000},
    must:[['atta','whole wheat']], not:['maida','multigrain','besan','mix'] },
  { key:'maida', query:'maida', label:'Maida', unit:'kg', band:[16,130], buy:{pack:'1 kg',qty:1,base_paise:4000},
    must:[['maida']], not:['mix','premix','instant'] },
  { key:'milk', query:'milk', label:'Milk', unit:'L', band:[20,160], buy:{pack:'1 L',qty:1,base_paise:5000},
    must:[['milk']], not:['powder','condensed','shake','badam','almond','soy','masala'] },
  { key:'curd', query:'curd', label:'Curd', unit:'L', band:[24,190], buy:{pack:'1 L',qty:1,base_paise:5800},
    must:[['curd','dahi','yogurt','yoghurt']], not:['shrikhand','greek','flavoured'] },
  { key:'honey', query:'honey', label:'Honey', unit:'kg', band:[240,1800], buy:{pack:'400 g',qty:0.4,base_paise:23800},
    must:[['honey']], not:['cough','candy'] },
  { key:'condensed_milk', query:'condensed milk', label:'Milkmaid (condensed milk)', unit:'kg', band:[130,900], buy:{pack:'5 kg',qty:5,base_paise:162000},
    must:[['condensed','milkmaid']], not:[] },
  { key:'ruchi_gold_oil', query:'ruchi gold oil', label:'Ruchi Gold oil', unit:'L', band:[55,400], buy:{pack:'1 L',qty:1,base_paise:12800},
    must:[['ruchi','palmolein','palm oil']], not:['mustard','sunflower','coconut','olive'] },
  { key:'sunflower_oil', query:'sunflower oil', label:'Sunflower oil', unit:'L', band:[70,450], buy:{pack:'1 L',qty:1,base_paise:17400},
    must:[['sunflower'],['oil']], not:['mustard','coconut','olive','palm'] },
  { key:'chilli_powder', query:'chilli powder', label:'Chilli powder', unit:'kg', band:[100,750], buy:{pack:'1 kg',qty:1,base_paise:25000},
    must:[['chilli','chilly','mirchi'],['powder']], not:['flakes','whole','crushed'] },
  { key:'turmeric', query:'turmeric powder', label:'Haldi (turmeric)', unit:'kg', band:[80,650], buy:{pack:'1 kg',qty:1,base_paise:20000},
    must:[['turmeric','haldi'],['powder']], not:['fresh','root','raw'] },
  { key:'apple_chilli', query:'byadgi chilli', label:'Apple chilli — CONFIRM', unit:'kg', band:[120,1000], buy:{pack:'1 kg',qty:1,base_paise:38000},
    must:[['chilli','chilly','byadgi']], not:['powder','flakes'] },
  { key:'whole_cashew', query:'whole cashew', label:'Whole cashew', unit:'kg', band:[380,1900], buy:{pack:'250 g',qty:0.25,base_paise:23500},
    must:[['cashew','kaju']], not:['roasted','salted','flavoured','broken','split','pieces','bits'] },
  { key:'baby_cashew', query:'cashew', label:'Baby cashew', unit:'kg', band:[260,1500], buy:{pack:'1 kg',qty:1,base_paise:65000},
    must:[['cashew','kaju']], not:['roasted','salted','flavoured'] },
  { key:'magaj', query:'magaj seeds', label:'Magas/magaj seeds — CONFIRM', unit:'kg', band:[200,1600], buy:{pack:'1 kg',qty:1,base_paise:62000},
    must:[['magaj','magaz','melon seed','char']], not:[] },
  { key:'amul_cream', query:'amul fresh cream', label:'Amul cream', unit:'L', band:[90,600], buy:{pack:'1 L',qty:1,base_paise:22000},
    must:[['cream']], not:['ice cream','sour','body','face'] },
  { key:'salted_butter', query:'salted butter', label:'Salted butter', unit:'kg', band:[250,1500], buy:{pack:'500 g',qty:0.5,base_paise:30000},
    must:[['butter']], not:['garlic','peanut','unsalted'] },
  { key:'tomato_ketchup', query:'tomato ketchup', label:'Tomato sauce/ketchup', unit:'L', band:[24,220], buy:{pack:'1 L',qty:1,base_paise:6000},
    must:[['tomato'],['ketchup','sauce']], not:['puree','soup','baked'] },
  { key:'kasuri_methi', query:'kasuri methi', label:'Kasuri methi', unit:'kg', band:[150,2000], buy:{pack:'100 g',qty:0.1,base_paise:4000},
    must:[['kasuri','methi','fenugreek']], not:['seed','oil','fresh'] },
  { key:'colour_red', query:'food colour red', label:'Food colour (red)', unit:'kg', band:[200,3500], buy:{pack:'100 g',qty:0.1,base_paise:6500},
    must:[['colour','color']], not:['hair','fabric','rangoli','holi'] },
  { key:'colour_orange', query:'food colour orange', label:'Food colour (orange)', unit:'kg', band:[200,3500], buy:{pack:'100 g',qty:0.1,base_paise:6500},
    must:[['colour','color']], not:['hair','fabric','rangoli','holi'] },
  { key:'msg', query:'ajinomoto', label:'Tasting powder (MSG) — CONFIRM', unit:'kg', band:[50,600], buy:{pack:'1 kg',qty:1,base_paise:14000},
    must:[['ajinomoto','msg','tasting','monosodium','china salt']], not:[] },
  { key:'soya_sauce', query:'soya sauce', label:'Soya sauce', unit:'L', band:[25,300], buy:{pack:'800 ml',qty:0.8,base_paise:5000},
    must:[['soy','soya'],['sauce']], not:['chilli','schezwan','dark only'] },
  { key:'paneer', query:'paneer', label:'Paneer', unit:'kg', band:[150,750], buy:{pack:'1 kg',qty:1,base_paise:40000},
    must:[['paneer']], not:['tikka','momo','frozen','bhurji','tofu'] },
  { key:'cornflour', query:'corn flour', label:'Cornflour', unit:'kg', band:[20,300], buy:{pack:'1 kg',qty:1,base_paise:5000},
    must:[['corn'],['flour','starch']], not:['flakes','meal','syrup'] },
  { key:'moong_dal', query:'moong dal', label:'Moong dal', unit:'kg', band:[50,400], buy:{pack:'1 kg',qty:1,base_paise:12000},
    must:[['moong','mung'],['dal','dhal']], not:['sprout','snack','roasted'] },
  { key:'masoor_dal', query:'masoor dal', label:'Masoor dal', unit:'kg', band:[35,350], buy:{pack:'1 kg',qty:1,base_paise:8500},
    must:[['masoor','masur'],['dal','dhal']], not:['snack','roasted'] },
  { key:'rice', query:'sona masoori rice', label:'Staff rice', unit:'kg', band:[30,220], buy:{pack:'26 kg',qty:26,base_paise:168000},
    must:[['rice']], not:['basmati','poha','flakes','puffed','brown'] },
];
