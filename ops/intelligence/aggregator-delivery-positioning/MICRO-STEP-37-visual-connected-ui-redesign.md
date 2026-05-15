# Micro-Step 37 - Visual Connected UI Redesign

**Date:** 2026-05-15  
**Lane:** 03 Aggregator-Delivery  
**Scope:** Replace the deployed MS36 table-heavy UI with a visual intelligence map covering the full 35-micro-step chain.  
**Portal action by Codex:** None.  
**Production action:** Static HN repo UI redeploy only.

---

## Owner Feedback

The deployed MS36 UI was not correct enough because it was still too text/table-driven and did not visually connect the full intelligence built across the 35 micro-steps.

The requested correction:

```text
Make the UI cover all intelligence from the 35 micro-steps and make it visually connected, easier to understand.
```

---

## Redesign Decision

The UI was rebuilt as a connected board instead of a readout table.

It now shows:

1. Four source roles: Swiggy demand, Zomato price perception, HE menu truth, playbook mechanics.
2. Seven compressed micro-step phases covering MS01-MS35.
3. Swiggy and Zomato signal cards with the most important volume and price anchors.
4. Zomato P0 SKU role board: value anchors, combo review, base-price review, visibility, attach economics.
5. The customer-perception path: base price, offer badge, value anchor, combo value, proof.
6. Mandatory offer lanes: Mutton item offer, lunch cart/daypart offer, fixed combo value, Swiggy offer lane.
7. Final execution sequence: price foundation, offer-proof packet, manual portal setup, no blind stacking.

---

## Corrected Intelligence Preserved

Offers remain mandatory in the final strategy.

The corrected rule is:

```text
Run offers only after the SKU has a role, a price corridor, and a mechanic.
```

This means:

- no blanket discount;
- no all-menu offer blast;
- no "no offers" final answer;
- price architecture and offer architecture work together;
- proof gates sequence the offer, they do not delete it.

---

## Updated Deployed File

```text
ops/intelligence/aggregator-delivery-positioning/index.html
```

