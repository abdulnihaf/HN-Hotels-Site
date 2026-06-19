// ═══════════════════════════════════════════════════════════════════════════
// Sauda vendor master — the canonical ~17 vendors, merged across the two legacy
// sources (sauda_day_po full names + buy_lines short names). This is the ONE
// place the merge lives, so the catalog can route every item to a real vendor.
//
// Each vendor carries its own behaviour, so the placing UI never has to ask:
//   fulfilment: deliver | collect | standing | porter | bus
//   pay:        per | khata_roll | khata_periodic
//
// FLAGGED for owner confirmation (ground truth lives in Odoo purchase.hnhotels.in
// + bank feed): vpa handles, and the brain/bheja split (Sajid ≠ M.N. Broilers).
// ═══════════════════════════════════════════════════════════════════════════

// fulfilment + pay vocab → human labels for the UI
export const FULFILMENT = {
  deliver:  'delivers',
  collect:  'collect',     // Basheer goes & fetches
  standing: 'standing',    // arrives daily, no daily order (e.g. milk)
  porter:   'porter',      // sent via Porter
  bus:      'intercity',    // city-to-city shipment, then local pickup/porter
};
export const PAY = {
  per:            'pay per order',
  khata_roll:     'khata',          // rolling: pay yesterday's bill on next visit
  khata_periodic: 'khata (weekly)', // periodic settlement
};

// canonical vendors. `aliases` = every spelling seen in the legacy data (lower-cased).
export const VENDORS = {
  ashrafiya:  { name: 'Ashrafiya Store',        cat: 'Provisions, spices, oils, cleaning', fulfilment: 'collect',  pay: 'khata_roll',     brand: 'both', vpa: 'q318394880@ybl',
                aliases: ['ashrafiya store', 'ashrafia', 'ashrafiya'] },
  manju:      { name: 'Manju Veg Supplier',     cat: 'Vegetables, herbs, lemon',           fulfilment: 'deliver',  pay: 'per',            brand: 'both', vpa: 'q025257178@ybl',
                aliases: ['manju veg supplier', 'manjunath', 'manju'] },
  deepak:     { name: 'Deepak Packaging',       cat: 'Bags, containers, pouches, tissue',  fulfilment: 'deliver',  pay: 'per',            brand: 'both', vpa: 'paytmqr6pdq3f@ptys',
                aliases: ['deepak packaging store', 'deepak packaging', 'rupnath'] },
  nazeer:     { name: 'Nazeer Nadeem',          cat: 'Water, cold drinks',                 fulfilment: 'deliver',  pay: 'per',            brand: 'both', vpa: 'q101761866@ybl',
                aliases: ['nazeer nadeem', 'nazeer', 'nadeem', 'nadeem water', 'nadeem cold drinks', 'nadeem water and cold drinks'] },
  mnbroilers: { name: 'M.N. Broilers',          cat: 'Chicken',                            fulfilment: 'deliver',  pay: 'per',            brand: 'HE',   vpa: '',
                aliases: ['m.n. broilers (syed ahmedulla)', 'm.n. broilers', 'mn broilers', 'mn chicken'] },
  prabhu:     { name: 'Prabhu (Buffalo Milk)',  cat: 'Milk (morning/evening)',             fulfilment: 'standing', pay: 'khata_periodic', brand: 'NCH',  vpa: 'prabhurathi13@oksbi',
                aliases: ['buffalo milk vendor', 'bootha', 'prabhu'] },
  irshad:     { name: 'M. Irshad Ahmed',        cat: 'Mutton',                             fulfilment: 'deliver',  pay: 'per',            brand: 'HE',   vpa: '',
                aliases: ['m. irshad ahmed', 'irshad'] },
  sajid:      { name: 'Sajid (Beja)',           cat: 'Brain / bheja',                      fulfilment: 'deliver',  pay: 'per',            brand: 'HE',   vpa: '',
                aliases: ['sajid', 'sajid beja'] },
  nisarcha:   { name: 'Nisarcha Brother',       cat: 'Chicken cutlets',                    fulfilment: 'deliver',  pay: 'per',            brand: 'NCH',  vpa: '8971457998@hdfc',
                aliases: ['nisarcha brother (hamza/krispy eats)', 'nisarcha brother', 'abdul suhail'] },
  ganga:      { name: 'Ganga Bakery',           cat: 'Buns',                               fulfilment: 'porter',   pay: 'per',            brand: 'NCH',  vpa: 'paytmqr67bsov@ptys',
                aliases: ['ganga bakery', 'ganga bakers'] },
  tabrez:     { name: 'Tabrez',                 cat: 'Rumali roti',                        fulfilment: 'deliver',  pay: 'per',            brand: 'HE',   vpa: 'mdt93044@ybl',
                aliases: ['md tabrez', 'tabrez'] },
  samosa:     { name: 'Krishnamurthy (Samosa)', cat: 'Samosa',                             fulfilment: 'collect',  pay: 'per',            brand: 'NCH',  vpa: 'krishnamurhinisha@okaxis',
                aliases: ['sameer hamza samosa vendor', 'krishnamoorthi', 'krishnamurthy', 'samosa vendor'] },
  eggs:       { name: 'Eggs (Syed Lais)',       cat: 'Eggs (go & buy, UPI tracked)',       fulfilment: 'collect',  pay: 'per',            brand: 'HE',   vpa: '9916374699ssa@ybl',
                aliases: ['eggs (syed lais)', 'syed siraj ahmed', 'syed lais', 'eggs'] },
  gas:        { name: 'Ahmed (Gas)',            cat: 'LPG cylinder',                       fulfilment: 'deliver',  pay: 'per',            brand: 'both', vpa: '9845956333@ibl',
                aliases: ['ahmed - gas cylinder', 'ahmed gas', 'ahmed', 'a m ruba bharat gas', 'am ruba bharat gas'] },  // bank: A M Ruba Bharat Gas
  osmania:    { name: 'Rehan (Osmania)',        cat: 'Osmania biscuits (occasional)',      fulfilment: 'deliver',  pay: 'per',            brand: 'NCH',  vpa: '7259834218@ybl',
                aliases: ['rehan osmania', 'rehan', 'farook', 'farooq', 'm farooq ahmed siddique'] },  // bank: paid to Farook (M Farooq Ahmed Siddique)
  charcoal:   { name: 'Mudassir (Charcoal)',    cat: 'Charcoal',                           fulfilment: 'collect',  pay: 'per',            brand: 'HE',   vpa: 'muddu14321@axl',
                aliases: ['mudassir pasha', 'mudassir', 'muda sir'] },  // bank: Mudassir Pasha
  afeefa:     { name: 'Afeefa Impex Agencies',  cat: 'Tea powder - intercity; HDFC beneficiary ending 2951; transport/Porter as separate refs', fulfilment: 'bus', pay: 'per', brand: 'NCH', vpa: '',
                aliases: ['afeefa impex agencies', 'afeefa impex', 'afifa impex', 'afifa impacts', 'lakhimi tea industries', 'tea powder vendor', 'liberty premium'] },
  jayjay:     { name: 'Jay & Jay',              cat: 'Milk powder',                        fulfilment: 'deliver',  pay: 'per',            brand: 'NCH',  vpa: 'vyapar.177783669496@hdfcbank',
                aliases: ['jay & jay', 'jay and jay', 'j&j'] },
};

// build a fast alias → key lookup once
const ALIAS_TO_KEY = (() => {
  const m = {};
  for (const [key, v] of Object.entries(VENDORS)) {
    m[key] = key;
    for (const a of v.aliases) m[a] = key;
    m[v.name.toLowerCase()] = key;
  }
  return m;
})();

// Resolve any raw vendor string (from legacy data) to a canonical vendor key,
// or null if we genuinely don't recognise it (→ surfaced as "unassigned").
export function canonVendorKey(raw) {
  if (!raw) return null;
  return ALIAS_TO_KEY[String(raw).trim().toLowerCase()] || null;
}

// Vendor record for a key, with its UI labels resolved.
export function vendorView(key) {
  const v = VENDORS[key];
  if (!v) return { key: 'unassigned', name: 'Unassigned', cat: '', fulfilment: 'deliver', pay: 'per', brand: 'both', fulfilmentLabel: 'delivers', payLabel: 'pay per order' };
  return { key, ...v, fulfilmentLabel: FULFILMENT[v.fulfilment] || v.fulfilment, payLabel: PAY[v.pay] || v.pay };
}
