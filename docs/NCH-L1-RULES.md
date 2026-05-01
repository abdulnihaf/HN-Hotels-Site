# NCH-L1 Inflow · Agent Rule Registry

**Layer:** `LAYER_NCH_L1` · Inflow
**Source xlsx:** `~/Desktop/NCH-L1_Asset_Registry_2026-04-30.xlsx` (sheet `L12_Rules`)
**Operating principle:** every rule is a pure expression over the asset codes from L0–L11. Rules fire on streaming events; they do not run as batch reconciliation. Every fire produces an `EVT_<id>` row in `events_bus`, classified to a `TIER_<level>`, routed to a channel (WABA / SMS / voice / email / digest), targets a named recipient (Basheer / Nihaf / Tanveer / Naveen), and carries an SLA countdown.

---

## The 11 rules (also in xlsx sheet L12)

### POS-side gates

| Rule | Breach | Expression over codes | Tier · Channel · Target · SLA | Source |
|---|---|---|---|---|
| **G_1_COMP_NO_PARTNER** | Complimentary issued without partner_id | `pos.payment WHERE pm_id=PM_49 AND partner_id IS NULL` | `TIER_ERROR` · WABA+email · Basheer+Nihaf · 30m | `rectify.js:45-50` |
| **G_2_TOKEN_NO_PARTNER** | Token issuance without runner | `pos.payment WHERE pm_id=PM_48 AND config_id=POS_27 AND partner_id IS NULL` | `TIER_ERROR` · WABA+email · Basheer+Nihaf · 30m | POS-side enforcement gap |
| **G_3_RUNNER_LEDGER_NO_PARTNER** | Runner Ledger without runner | `pos.payment WHERE pm_id=PM_40 AND config_id=POS_28 AND partner_id IS NULL` | `TIER_ERROR` · WABA+email · Basheer+Nihaf · 30m | rectify.js gap |

### Promise mechanic

| Rule | Breach | Expression | Tier · Channel · Target · SLA |
|---|---|---|---|
| **G_4_PROMISE_NONZERO_AT_CLOSE** | `EQ_PROMISE(X) ≠ 0` at runner shift close | `EQ_PROMISE(RNR_X) at settlement.id where settled_at != null` | `TIER_ERROR` · WABA+email · Basheer · 30m |

### Razorpay ↔ POS

| Rule | Breach | Expression | Tier · Channel · Target · SLA |
|---|---|---|---|
| **G_5_RZP_VS_POS_DRIFT** | Razorpay payment without matching POS row in ±10 min | `razorpay.payment WHERE qr_id ∈ {RPQR_*} AND ¬∃ pos.payment in ±10 min on partner=qr_owner` | `TIER_ERROR` · WABA+email · Basheer+Nihaf · 30m |

### Bank ledger

| Rule | Breach | Expression | Tier · Channel · Target · SLA |
|---|---|---|---|
| **G_6_BANK_SOURCE_STALE** | HDFC/Federal/Razorpay/Paytm feed silent > expected gap | `money_source_health.status ∈ {silent, stale}` | `TIER_WARN` · WABA · Naveen+Nihaf · 4h |

### Cash pile

| Rule | Breach | Expression | Tier · Channel · Target · SLA |
|---|---|---|---|
| **G_7_CASH_RECONCILE_DRIFT** | Physical count differs from expected by > ₹500 | `|cash_events.balance_paise_after − EQ_CASH_PILE_NCH| > 500` | `TIER_ERROR` · WABA+email · Basheer+Nihaf · 30m |

### Inventory side-effect (informs L3 daily settlement)

| Rule | Breach | Expression | Tier · Channel · Target · SLA |
|---|---|---|---|
| **G_8_CHAI_COUNTER_PRODUCT_UNKNOWN** | POS sale of product not in `/ops/chai-counter/` whitelist (will become `/ops/item-counter/`) | `pos.order.line WHERE product_id NOT IN known set` | `TIER_INFO` · daily 09:00 digest · Tanveer |

### Aggregator

| Rule | Breach | Expression | Tier · Channel · Target · SLA |
|---|---|---|---|
| **G_9_AGG_COMMISSION_BAND** | Effective commission outside contracted band (Zomato 23.41% ±0.5%, Swiggy 24.60% ±0.5%) | `|EQ_AGG_NET_EXPECTED − BNK_HDFC_OPS credit| / gross > 0.5%` | `TIER_WARN` · WABA+email · Nihaf · 24h |

### Staff accountability

| Rule | Breach | Expression | Tier · Channel · Target · SLA |
|---|---|---|---|
| **G_10_RUNNER_SHORT_AGING** | Runner short > ₹500 unsettled > 7 days | `hr_deductions WHERE runner_id=X AND settled_at IS NULL AND created_at < now-7d` | `TIER_ERROR` · WABA+email · Basheer · 30m |

### Comms readiness

| Rule | Breach | Expression | Tier · Channel · Target · SLA |
|---|---|---|---|
| **G_11_WABA_OPTIN_PENDING** | Active staff with phone but no `comms_optin` row | `hr_employees WHERE active=true AND phone NOT NULL AND ¬∃ comms_optin opted_in` | `TIER_INFO` · daily 09:00 digest · Nihaf |

---

## How rules turn into the agent loop

```
event arrives in events_inbound (POS / Razorpay / HDFC / cash UI / aggregator)
   ↓
agent evaluates rules in L12 (set algebra over L0–L11 codes)
   ↓
match → TIER_<level> assignment from the rule's tier
   ↓
events_bus row created · alert outbox row created
   ↓
channel routing (WABA template / SMS / voice / email / digest)
   ↓
target receives alert with deep link to /ops/fix?eid=<EVT>
   ↓
Basheer fixes via single-card UI · DONE button writes to source-of-truth (Odoo or D1)
   ↓
events_bus.status = resolved · ack logged
   ↓
SLA timer cancelled · trail visible in /ops/money for owner
```

---

## What turns each rule from "logged today" to "blocked at point-of-event"

The current code accepts most of these breaches silently. The agent layer flips them from passive to active.

| Today | After agent |
|---|---|
| Complimentary saved without partner | POS-side validate before pos.payment.create OR agent intercepts within 60s and pings cashier with "select staff" |
| Token issued without runner | POS-side reject (set `pos.payment.method` validation) OR agent intercepts within 60s |
| Runner promise non-zero at close | Settlement UI gate already exists for shortage; extend to overage too + block close until reconciled |
| RZP without POS in 10 min | Cron evaluates every 60s; on breach, WABA cashier with "punch this order in POS now" |
| HDFC silent | Cron evaluates every 5 min; if > 24h silent, escalate to Naveen |
| Cash drift on reconcile | UI block: must enter expected value + reason if drift > ₹500 |
| Aggregator commission drift | EOD settlement webhook compares to band; if outside, WABA Nihaf with disputable amount |
| Runner short aging | Daily 00:30 cron evaluates; > 7d unsettled escalates to Basheer + blocks new shift open |

---

## Rule code prefix discipline

Same convention as the rest of the codebase. Future layers extend the prefix:

- `G_*` — L1 inflow gates (this file)
- `H_*` — L2 outflow gates (next layer)
- `I_*` — L3 daily settlement gates (final layer)

Each rule has a stable code that never changes; the rule body can be tuned (thresholds, SLAs) without renaming.

---

## Comms readiness for triggering these rules

The agent depends on the `/api/comms` flow already shipped in PR #27:

- `/api/comms?action=optin-send` → bulk-sends opt-in template to all active staff
- `/api/comms-webhook` → captures YES replies → flips `comms_optin` to `opted_in`
- After opt-in is collected, agent uses `/api/comms?action=send` with `template=<rule.template>`, `vars=[<entity codes from breach>]`

**Status:**
- HE WABA opt-in: ready to fire (PM_38 phone +91 80080 02049 verified live, token works)
- NCH WABA opt-in: blocked on token — see `docs/COMMS-OPTIN-RUNBOOK.md`
- Fast2SMS for SMS escalation: live, ₹50 wallet, 200 SMS available

Once PR #27 merges and Meta approves the `staff_optin_v1` template, opt-in fires bulk to all `hr_employees` rows where `phone IS NOT NULL AND active=true`.
