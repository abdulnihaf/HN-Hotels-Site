# Nihaf Agent — Daily Basket (trained baseline, 2026-07-01)

> The agent's **expectation model**: what a normal purchase day looks like per brand, learned from
> **50 real daily POs (26 HE + 24 NCH), 30 May–1 Jul 2026** (gap 18–24 Jun; NCH missing 9 & 13 Jun).
> Source: `HN Hotels Master Purchase Orders` zip, parsed clean (1,128 line-items, 0 parse errors).
> This is what lets the agent know "today looks incomplete" WITHOUT anyone listing items. It sharpens
> as the going-forward `hn-ops` trail grows. % = share of that brand's days the item appeared.

## How the agent uses this
- **Tier by frequency** → decides *what to expect daily* vs *what's occasional* (never flag occasional).
- **Typical quantity + range** → the "how much" approximation, and a sanity band (a qty far outside
  the range is worth a second look; qty is often left blank "—" = vendor fills, which is normal).
- **Merge name variants first** (see §Normalization) or frequencies under-count and essentials look missing.

---

## HAMZA EXPRESS — daily nature (26 days)

**Anchor — every day (the P&L spine):**
| Item (family) | Days | Typical qty |
|---|---|---|
| **Chicken — any form** (Shawarma 96%, Boneless 50%, Tandoori 50%, Kabab 38%) | ~daily | Shawarma ~6 kg · Boneless ~7 kg · Tandoori ~6 birds |
| **Cooking oil** (Oil 81% + Sunflower 58% + Soft/refined 35%) | ~daily | ~6 box + ~4 L |
| Eggs | 73% | ~3 crate |
| Amul cream · Dahi · Milk | 62 / 46 / 46% | ~1 L · ~4 L · ~2 L |

**Daily fresh-veg run (cluster — expect the group, not each):**
Green chilli 73% (~1 kg) · Tomato 69% (~2 kg) · Lemon 65% (~50 pc) · Cucumber 62% (~4 kg) ·
Capsicum 50% (~2 kg) · Coriander 50% (~3 bunch) · Garlic 50% (~2 kg) · Cabbage 46% (~4 kg) ·
Ginger/Carrot/Spring-onion/Mint ~35%.

**Near-daily staples:** Charcoal 54% (fuel, ~1 bag) · Maida 54% (~10 kg) · Vinegar 46% · Butter 42%.

**Periodic (NOT daily — do not chase daily):** Mutton 23% (~3 kg) + Mutton brain 19% → **mutton is
optional, ~1 day in 4** (matches Nihaf). Dals (moong/masur) ~27% · paneer 19% · rumali roti ~23%.

**Occasional / bulk restock:** spices, dry goods, packaging, dals — the long tail (110 one-off items).
**28–29 Jun = monthly-style restock** (56 & 51 items: Maida 40 kg, oils by box, ~30 spices/dals) —
recognise as a *restock day*, not the daily pattern.

## NAWABI CHAI HOUSE — daily nature (24 days)

**Anchor — every day:**
| Item (family) | Days | Typical qty |
|---|---|---|
| **Buns** | 92% | ~100 |
| **Milk** (morning + evening, merged) | ~daily | morning ~60 L · evening ~40 L |
| **Lemon** | 92% | ~20 |
| Samosa | 75% | ~10 |

**Frequent:** LPG cylinder ~daily-ish (~1) · Bisleri water (~5 case) · Cutlets (all pack sizes merged,
frequent) · Butter (merged ~6 pkt) · Sugar 33% (~50 kg when bought) · disposables (cups, silver
pouches, tissue).

**Periodic / bulk (NOT daily):** **Tea powder — only ~8%** (bought in bulk ~50 kg, lasts weeks — the
daily chai input is MILK, not tea powder) · Milkmaid (condensed) ~21% · Coffee, Boost/Horlicks occasional.

---

## Normalization — the biggest training finding (fix before the agent trusts frequency)
Spelling/format **variants fragment the count** — merge them via aliases or essentials look missing:
- **HE:** Oil / Soft oil / Sof oil / Sunflower oil → *cooking-oil family* · Rumali ↔ Romali roti ·
  Kabab chili ↔ chilli · Mint ↔ Pudina patta · Gobi ↔ Cauliflower · Curry leaves ↔ Kari patta ·
  Mutton chops ↔ Mutton champ · Coriander ↔ Dhania patta · Whole cashew ↔ Baby cashew (kaju).
- **NCH:** `Milk — morning` ↔ `Milk (morning)` (same item, two render formats — this alone split milk's
  true daily frequency in half) · Cutlets ↔ Cutlets (30 pcs) ↔ Cutlets (50 pcs) · Butter ↔ Butter (3 kg
  total) ↔ (2.5 kg total) · Silver pouch 5/7 ↔ 5/7 silver pouch · Bisleri 500ml ↔ 500 ml · cups variants.

## Data anomalies to guard
- **Egg range 2–90 crate** — the 90 is an outlier (bulk/typo); daily norm is ~3. Use median + a range band.
- Qty blank "—" is normal (kitchen didn't specify; vendor fills) — absence of qty ≠ a gap.

## Coverage caveats
26 HE / 24 NCH days. Continuous 30 May–17 Jun, then 25 Jun–1 Jul; **18–24 Jun absent** (23 Jun photo-only).
This baseline is a *starting* expectation — the agent keeps learning from the live `hn-ops` trail forward.
