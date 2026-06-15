// ═══════════════════════════════════════════════════════════════════════════
// Hyperpure buying spec — the COA "what we actually buy" dimension for Sauda.
//
// Each item CONSTRAINS the match so the scout can never pick the wrong FORM
// (the failure that made cashew resolve to splits and jeera to rice):
//   must : AND of OR-groups — each group needs ≥1 synonym present in the SKU name
//   not  : any of these words in the name → reject (kills wrong-form decoys)
//   band : [min,max] sane price per kg / L (₹) → rejects mis-parsed or off-category
//   form : human label of the form we buy (shown to the owner for confirmation)
//
// Grounded in buy_lines purchase history (2026-06-15): they buy "whole cashew",
// "cumin powder", ghee ~₹680/kg, refined oil ₹129–173/L. Specs marked CONFIRM
// are still assumptions awaiting the owner's word on the form he actually uses.
// This is the ONE place the buying truth lives — edit here, the nightly scrape
// (which fetches this catalog) picks correctly on the next run, no box change.
// ═══════════════════════════════════════════════════════════════════════════

// Applied to EVERY item on top of its own not[] — prepared/condiment forms a raw
// commodity should never resolve to (killed jeera→"Harissa Cumin Dressing").
export const HP_GLOBAL_NOT = [
  'dressing','sauce','paste','dip','gravy','curry','chutney','pickle','ready to','ready-to',
  'instant','seasoning','marinade','spread','ketchup','mayo','mayonnaise','syrup','combo',
  'assorted','sample','flavoured','flavored','seekh','tikka','momo','nugget','patty','kebab','kabab',
];

export const HP_CATALOG = [
  { key: 'paneer',      query: 'paneer',      label: 'Paneer',           form: 'fresh block',      unit: 'kg', band: [200, 450],
    must: [['paneer']],                  not: ['tikka','momo','spread','frozen','bhurji','masala','tofu'] },
  { key: 'ghee',        query: 'ghee',        label: 'Ghee',             form: 'tin / pack',       unit: 'L',  band: [440, 800],   // buy_lines ~₹680/kg
    must: [['ghee']],                    not: ['vanaspati','margarine','dalda'] },
  { key: 'refined oil', query: 'refined oil', label: 'Refined oil',      form: 'tin / pouch',      unit: 'L',  band: [95, 210],    // buy_lines ₹129–173/L
    must: [['refined'],['oil']],         not: ['mustard','coconut','olive','sesame','groundnut','ghee'] },
  { key: 'maida',       query: 'maida',       label: 'Maida',            form: 'bag',              unit: 'kg', band: [20, 65],
    must: [['maida']],                   not: ['mix','premix','instant'] },
  { key: 'sooji',       query: 'sooji',       label: 'Sooji / Rava',     form: 'bag',              unit: 'kg', band: [26, 80],
    must: [['sooji','rava','semolina']], not: ['idli mix','upma mix'] },
  { key: 'sugar',       query: 'sugar',       label: 'Sugar',            form: 'bag',              unit: 'kg', band: [34, 70],
    must: [['sugar']],                   not: ['brown','jaggery','icing','cube','powdered','demerara','sachet'] },
  { key: 'cashew',      query: 'cashew',      label: 'Cashew (whole)',   form: 'whole — buy_lines: "whole cashew"', unit: 'kg', band: [500, 1050],
    must: [['cashew','kaju']],           not: ['kani','split','ssp','lwp','pieces','broken','baby','roasted','salted'] },
  { key: 'jeera',       query: 'jeera',       label: 'Jeera',            form: 'whole seeds — CONFIRM (buy_lines shows "cumin powder")', unit: 'kg', band: [170, 540],
    must: [['cumin','jeera']],           not: ['powder','ground','samba','rice','masala'] },
  { key: 'dalda',       query: 'vanaspati',   label: 'Dalda (vanaspati)',form: 'tin / pouch',      unit: 'L',  band: [90, 185],
    must: [['vanaspati','dalda']],       not: ['pure ghee'] },
  { key: 'honey',       query: 'honey',       label: 'Honey',            form: 'bottle',           unit: 'kg', band: [140, 560],
    must: [['honey']],                   not: ['cough','syrup','candy','sauce'] },
];
