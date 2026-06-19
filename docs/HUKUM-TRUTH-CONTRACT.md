# The Hukum Truth Contract

> Governing standard for the technical layer beneath Hukum. Added 2026-06-20 from Nihaf direct.
> Why it exists: Nihaf is non-technical and runs the business off Hukum. If a number in Hukum
> is silently wrong, his entire execution breaks. So the foundation must make a wrong/lost/stale
> number **impossible to present as fact**. This is the *constraint*, not a *catcher* — we don't
> chase what's lost, we close the space so loss can't be silent.

## The problem this fixes (root, not symptom)

Every HN data feed today rests on a brittle capture path — portal scraping through human-shaped
browser sessions on one box, dashboard scrapes, bank-email parsing. Each expires/breaks
*independently and silently*, and that fragility flows UP into Naam, Hisaab, and Hukum. Patching
the latest broken token is whack-a-mole. The fix is architectural: **truth by reconciliation +
confidence on every number + self-heal that escalates only as a one-tap action.**

## The three rigid rules (every chamber/feed MUST obey)

1. **Truth by reconciliation, not single-source.** Every number Hukum shows must name at least
   one *independent witness* and be cross-checked against it. Scraping is one witness, never the
   source of truth. The independent witnesses already exist:
   - Sales → Odoo POS (the till).
   - Money → bank / Razorpay settlement (`money_events`).
   - Delivery → the per-order scrape **reconciled against** the aggregator bank settlement.
   - Inventory → received (Sauda) − sold (POS) − counted (Anbar).
   If two witnesses disagree, or one goes dark, the system knows *immediately* and leans on the
   other. Data cannot vanish silently because there is always a second pair of eyes.

2. **Every number carries its trust.** No value is shown without a `trust` label:
   `reconciled` (matches an independent witness) · `single_source` (captured, not yet reconciled)
   · `unverified` (capture may be losing data) · `stale` (witness too old) · `down` (no witness)
   · `unknown` (health unreadable — NEVER silently "ok"). When trust is not `reconciled`/`single_source`,
   Hukum **states it or blocks** — it never asserts a confident-but-wrong figure. (The Naam
   proof-gate, applied everywhere.)

3. **Self-heal closed; escalate only as a one-tap business action.** Breaks auto-detect AND
   auto-recover (rotate credentials from the live session, fall back to the other witness). The
   one irreducible human step (a real login consent, ground truth only Nihaf holds) appears
   *inside Hukum* as a one-tap action — never a technical scramble, never something he must
   understand. The AI is responsible for execution; Nihaf only ever sees a decision.

## The contract shape (what every domain returns to the spine)

```jsonc
{
  "domain":   "delivery",                 // sales | money | delivery | sauda | anbar | takht | darbar | naam | nazar
  "live":     true,                        // is the feed currently flowing?
  "trust":    "single_source",             // reconciled | single_source | unverified | stale | down | unknown
  "value":    "Zomato 5 orders today",     // the headline number, in plain words
  "witness":  "scrape; bank recon pending",// what it was (or wasn't) checked against
  "as_of":    "2026-06-20T03:48+05:30",
  "headline": "Zomato live; Swiggy 0 in 48h — verify",
  "action":   null                          // the ONE one-tap thing for Nihaf, or null
}
```

## The spine

`/api/hukm-truth` is the single endpoint the Hukum app reads (and a `hukm_truth` brain source for
the voice/glasses path). It computes each domain's contract verdict server-side (cross-source,
with full key/secret access), and rolls up an `overall` = `all_trustworthy | attention | loss_risk`.
The owner glances at ONE screen: per chamber — live & trustworthy (yes/no), the number, the one
action. Nothing technical leaks to him.

## Build order (chamber by chamber, against this contract)

1. **delivery** — feed-integrity (capture witness) + bank-settlement reconciliation. *(first, it's bleeding)*
2. **money** — `money_source_health` + Razorpay/bank reconciliation.
3. **sales** — reconciled `/api/sales` vs live POS.
4. then sauda, anbar, takht, darbar, naam, nazar — each declares its witness + trust.

Conforms to the EXECUTION LAWs in SPINE.md: NO-REGRESSION and AUTONOMOUS EXECUTION.
