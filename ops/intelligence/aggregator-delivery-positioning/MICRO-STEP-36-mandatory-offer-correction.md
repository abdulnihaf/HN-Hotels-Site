# Micro-Step 36 - Mandatory Offer Correction + First Deployed UI

**Date:** 2026-05-15  
**Lane:** 03 Aggregator-Delivery  
**Brand:** Hamza Express  
**Scope:** Correct Micro-Step 35 under Nihaf's clarified objective and deploy the first UI version in the HN repo.  
**Execution mode:** Static HTML intelligence UI. No portal save by Codex. No Swiggy/Zomato offer launch by Codex.

---

## 1. Corrected Objective

The final objective is not:

```text
Avoid offers.
```

The final objective is:

```text
Increase organic delivery order volume by positioning each SKU family at the right customer price corridor, then running mandatory but smart offers where the customer sees strong value and HE does not blindly destroy margin.
```

This means:

1. Offers are mandatory in the final delivery positioning system.
2. The offer must be attached to the right SKU role, price corridor, and timing window.
3. Base price and discount must be designed together.
4. "No offer now" is only an execution gate, not final intelligence.

---

## 2. Deep Audit Of Micro-Steps 1-35 Under Corrected Context

| Phase | Micro-Steps | What Still Holds | What Changes After Correction |
|---|---:|---|---|
| Source separation | 1 | Swiggy, Zomato, menu truth, and playbook must remain separate. | The playbook is no longer a defensive "offer blocker"; it becomes the offer mechanic library after demand role is known. |
| Swiggy demand cleanup | 2-3 | Swiggy DATA.xlsx is the strongest actual local order-volume source. | Swiggy data should help select volume families for offer positioning, not only readiness cleanup. |
| Zomato rank-price read | 4 | Zomato MG Road sheet gives rank-price perception, not exact order counts. | The "20% reduction rule" remains rejected as a fixed input, but a derived discount percent can be chosen after corridor and offer math. |
| HE menu surface | 5-6 | Current HE menu is SKU truth and execution surface. | Current price is only a starting point. Final base price can be increased or decreased before discounting. |
| Candidate/action mapping | 7-10 | Early mapping was useful but superseded by fresh P0 model. | Any "no offer" reading from early steps must be rephrased as "not this offer before proof." |
| Evidence gates | 11-26 | Portal, cost, stack, and proof gates are valid. | Gates should decide which offer launches first, not whether offers exist in the final strategy. |
| Gate reset | 26A | Corrected premise is valid: menu = SKU truth, demand = price/volume truth, playbook = mechanic truth. | Add one more truth: offer visibility is a required conversion lever on aggregators. |
| Fresh P0 model | 27-29 | 21 Zomato P0 rows and row roles are valid. | "Base price before offer" becomes "base price plus planned offer layer," not "base price instead of offer." |
| Audit and approval | 30-32 | Contradiction audit and row-level approval prevented blind portal mutation. | The audit should not present zero-offer as final. It should present the first safe offer lanes and proof blockers. |
| Team release and QA | 33-34 | 8 price edits remain a clean manual packet. | This packet is only Layer 1. Layer 2 must be a mandatory offer packet after proof. |
| Final readout | 35 | The visual explanation format is useful. | The headline and conclusion must be corrected: offers are mandatory, sequenced, and smartly attached to SKU roles. |

---

## 3. Corrected Intelligence

The intelligence stack is now:

```text
volume family -> SKU role -> base price corridor -> offer mechanic -> timing -> proof gate -> manual execution packet
```

The first UI version should make three points clear:

1. **Base-price correction is the foundation**, not the end.
2. **Offer layer is mandatory**, but not blanket.
3. **The current best first offer candidates are narrow and role-based**, not an all-menu discount.

---

## 4. Corrected First Offer Architecture

| Offer Lane | SKU / Group | Mechanic | Why It Exists | Gate Before Portal Save |
|---|---|---|---|---|
| Premium hero pull | Mutton Biryani row 102 | Max 15% item-level offer, no stacking | Creates visible premium discount without discounting the whole cart. | Mutton food cost, packaging, active stack proof. |
| Lunch conversion badge | Zomato lunch window | Cart offer such as 20% capped, MOV-led, daypart only | Earns visible offer badge during weak office-lunch window. | MOV/basket proof and no overlap with item offer or Gold. |
| Combo value perception | Combo/value rows 1-9 cluster | Fixed combo / strike-through value, not extra percent discount | Customers already buy basket forms; show value through bundle architecture. | Component cost, portion promise, packaging proof. |
| Attach economics | Roomali Roti, Tandoor Roti, breads | Attach hook or small base raise; no discount | Breads support cart construction and margin blend. | Confirm whether low price is intentional hook or leak. |
| Swiggy volume lane | Swiggy high-volume families | PoC-mediated offer and menu readiness packet | Swiggy gives actual volume data, but execution surface must be cleaned. | Current price/photo/status/disabled-row proof. |

---

## 5. What Changes From Micro-Step 35

Micro-Step 35 said:

```text
The best current move is not an offer.
```

Corrected statement:

```text
The best final strategy requires offers, but the offer must sit on top of the right SKU role and base-price corridor. The first UI must show the mandatory offer architecture, while keeping portal execution proof-gated.
```

Therefore:

1. The 8-row Zomato price packet remains valid as Layer 1.
2. The "offers now 0" metric is invalid as final intelligence.
3. Mutton Biryani, lunch daypart, and fixed combo value become the first mandatory offer architecture lanes.
4. Swiggy remains demand truth and needs a readiness-to-offer packet, not dismissal.

---

## 6. Deployed UI Target

First UI version:

```text
ops/intelligence/aggregator-delivery-positioning/index.html
```

Production URL after deploy:

```text
https://hnhotels.in/ops/intelligence/aggregator-delivery-positioning/
```

