# Money-Source Ingest Roadmap

Every rupee in and out of HN Hotels Pvt Ltd lands in a single D1 table,
`money_events`, via source-specific ingesters. This doc tracks the full
matrix: what's live, what's next, where the fallback signals come from.

## Architecture

```
┌───────────────┐
│    Source     │         ingester                writes
├───────────────┤       ───────────────          ──────────
│ HDFC          │──► CF Email Worker       ──► money_events{source:'hdfc'}
│ Razorpay      │──► CF Webhook Worker     ──► money_events{source:'razorpay'}
│ Paytm         │──► CF Webhook Worker*    ──► money_events{source:'paytm'}
│ Zomato        │──► Email parse / API*    ──► money_events{source:'zomato_*'}
│ Swiggy        │──► Email parse / API*    ──► money_events{source:'swiggy'}
│ EazyDiner     │──► Email parse / API*    ──► money_events{source:'eazydiner'}
│ Federal Bank  │──► CF Email Worker*      ──► money_events{source:'federal'}
│ Monthly PDFs  │──► Cron parser           ──► money_monthly_statement
│ (audit layer) │                          ──► money_events{source:'hdfc'} (backfill)
└───────────────┘

(*) = not yet implemented, scaffold or plan present.

Reconciliation engine (nightly) pairs gross ↔ net events in money_recon_matches.
Dashboard reads from money_events via /api/bank-feed.
```

## Source status matrix

| Source            | Direction | Latency | State   | Ingester              | Fallback signal          |
|-------------------|-----------|---------|---------|-----------------------|--------------------------|
| **HDFC**          | both      | ~30-60s | built   | `bank-feed-email`     | monthly e-stmt PDF       |
| **Razorpay**      | both      | seconds | built   | `razorpay-webhook`    | HDFC IMPS credit         |
| **Paytm**         | in        | seconds | stub    | TBD                   | HDFC settlement credit   |
| **Zomato Dining** | in        | 5-7 d   | manual  | payout email parse    | HDFC NEFT credit         |
| **Zomato Delivery**| in       | 5-7 d   | manual  | payout email parse    | HDFC NEFT credit         |
| **Swiggy**        | in        | 5-7 d   | manual  | payout email parse    | HDFC NEFT credit         |
| **EazyDiner**     | in        | 30 d    | manual  | payout email parse    | HDFC NEFT credit         |
| **Federal Bank**  | both      | ~1 d    | plan    | email stmt or AA push | —                        |
| **Manual**        | both      | instant | built   | dashboard form (TBD)  | —                        |

## Why per-source, not a single bank-first view

Bank feed alone would work, **but**:

1. **Latency** — HDFC email lands 30-60 s after txn. Razorpay webhook lands in seconds. Paytm same. For payment-gateway inflows we know *before* the bank does.
2. **Gross vs net** — aggregators send net-of-commission. "Zomato paid us ₹8,260" shows up in HDFC, but the gross order value (₹10,000) and the commission split (₹1,740) are only visible via the aggregator. Books need both.
3. **Fallback** — if the HDFC email filter silently breaks, Razorpay webhook is still flowing. Dashboard's source-health row turns red on HDFC; Razorpay keeps green. Operator notices within 24 h instead of at month-close.
4. **Attribution** — the HDFC narration says `IMPS-...-POWERACCESS.PPSL2533@AXISBANK`. That's a Swiggy payout? A Zomato payout? We can't tell from the bank alone. With the aggregator source we can.

## Brand attribution

| Source          | Brand        | Notes                                              |
|-----------------|--------------|----------------------------------------------------|
| razorpay        | **NCH**      | NCH accepts card/UPI via Razorpay PG               |
| paytm           | **HE**       | HE accepts UPI via Paytm (counter QR)              |
| zomato_dining   | **HE**       | HE is the Zomato Dining listing                    |
| swiggy          | **HE**       | Delivery orders via Swiggy                         |
| eazydiner       | **HE**       | Dining reservations/prepaid offers                 |
| zomato_delivery | HE or NCH    | Split by aggregator order context                  |
| hdfc            | HN Hotels PL | Central account; infer brand from counterparty     |
| federal         | HN Hotels PL | Expense pool; infer from counterparty              |
| manual          | chosen       | Operator selects brand on entry                    |

Rollups per brand can be derived from `source` + counterparty-matching
rules at query time — no new schema column needed today.

## Source-specific notes

### HDFC (`source=hdfc`, instrument=`hdfc_ca_4680`)
- **Live ingest**: per-txn email alerts → CF Email Worker.
- **One-time setup**: `workers/bank-feed-email/SETUP.md`.
- **Enable in HDFC NetBanking**: Profile → Insta Alerts → toggle "Debits and Credits" ON, delivery = Both (SMS + Email).
- **Fallback**: monthly e-Statement PDF parser (not yet built; stub table `money_monthly_statement` exists).
- **Backfill**: `scripts/bank-backfill/backfill-hdfc-xls.py` converts any downloaded `.xls` statement into an idempotent SQL load. Run after every new statement until live pipe is steady.

### Razorpay (`source=razorpay`, instrument=`razorpay_balance`)
- **Brand**: NCH (Nawabi Chai House). All Razorpay inflow is NCH revenue.
- **Account**: live mode, key_id `rzp_live_SDN76Q...` (stored as a Worker secret, not in repo).
- **Live ingest**: webhooks at `https://hn-razorpay-webhook.<acct>.workers.dev/`.
- **Setup**: in Razorpay Dashboard → Settings → Webhooks, add the URL. Subscribe to: `payment.captured`, `payment.failed`, `payout.processed`, `payout.reversed`, `settlement.processed`, `refund.processed`. Copy the webhook secret into `wrangler secret put RAZORPAY_WEBHOOK_SECRET`.
- **Two secrets, don't confuse them**:
  - `RAZORPAY_WEBHOOK_SECRET` — a string *you choose* when creating the webhook; used to verify incoming POST signatures.
  - `RAZORPAY_API_KEY_ID` + `RAZORPAY_API_KEY_SECRET` — different values, pulled from Dashboard → Settings → API Keys; used when *we* call Razorpay (fetch settlement details, generate payout, etc.). Not needed by the webhook worker; set them only if we add API-pull features later.
- **Signature verification**: HMAC-SHA256 over raw body vs `X-Razorpay-Signature`.
- **Reconciliation**: a `settlement.processed` Razorpay event corresponds to one HDFC IMPS credit (usually next business day). Match via `money_recon_matches`.

### Paytm (`source=paytm`, instrument=`paytm_counter_nihaf`)
- **Brand**: HE (Hamza Express uses Paytm at the counter).
- **Current**: Paytm counter UPI to `nihaf@paytm`. Manual settlement to HDFC periodically.
- **Next**: Paytm Merchant API webhook (`paytm-business`), same pattern as Razorpay. Endpoint `workers/paytm-webhook/`.
- **Status (2026-04)**: API access requested from Paytm; awaiting merchant onboarding completion. Expected turnaround ~2-4 weeks.
- **Interim**: the HDFC credit from Paytm settlement is already captured via the HDFC ingester with counterparty `PAYTM*` — we miss only the per-order attribution, not the money.

### Zomato / Swiggy / EazyDiner (aggregator payouts)
- **Reality**: weekly (Zomato/Swiggy) or monthly (EazyDiner) payouts to HDFC.
- **Current**: visible in HDFC as `NEFT-...-ZOMATO` / `NEFT-...-SWIGGY`.
- **Next (for gross visibility)**: parse the payout breakup emails each aggregator sends a day before settlement. Endpoint: same CF Email Routing pattern as HDFC, separate worker per source.
- **Channel column** in money_events will be `neft` (via HDFC) OR a future `settlement` source entry that the recon engine pairs.

### Federal Bank (`source=federal`, instrument=`federal_ca`)
- **Status (2026-04)**: NetBanking activation in progress. Once active, operator will share alert delivery details (SMS + email); reuse the `bank-feed-email` worker pattern with a Federal-specific parser branch and Gmail filter. Set up the Federal flow as a sibling worker `workers/federal-feed-email/` when details land.
- **Interim**: Federal transactions are logged manually in the current `bank_transactions` ledger. No change needed.

### Odoo POS (`source=odoo_pos_he`, `source=odoo_pos_nch`)
- **What**: counter sales (cash + card + UPI) booked directly into each brand's POS in Odoo — these are the *gross* counter inflow that Razorpay/Paytm/HDFC eventually settle.
- **Instance mapping** (verified 2026-04):
  - HE POS → `test.hamzahotel.com` (HE Production Odoo)
  - NCH POS → `ops.hamzahotel.com` (NCH Production Odoo)
- **Current**: already covered by `workers/spend-sync-cron` for expense side. For the POS *inflow* side, add a pull on `pos.order` (paid orders only) → write to `money_events` with source `odoo_pos_he` / `odoo_pos_nch`, instrument `pos_counter_he` / `pos_counter_nch`, direction `credit`, counterparty = customer name or "Walk-in".
- **Why relevant**: without it, the dashboard sees only the electronic subset of counter revenue. Adding POS pull gives complete gross-inflow per brand.
- **Priority**: high — same 15-min cadence as existing spend sync. Implementation: extend `spend-sync-cron` with a `pos.order` fetcher, not a new worker. No new cron slot consumed.
- **Cross-source match**: one Odoo POS order paid via UPI → one Razorpay payment.captured event (when via Razorpay at NCH) → one HDFC IMPS credit (when settled). Three sides of the same rupee; recon links them.

## Watchdog / fallback signalling

The `money_source_health` table stores per-source expected cadence:

| source           | expected_max_gap_minutes | rationale                                 |
|------------------|--------------------------|-------------------------------------------|
| hdfc             | 1440 (24 h)              | alerts fire per txn; if silent 24 h, broken |
| razorpay         | 2880 (48 h)              | some days have no customer payments       |
| paytm            | 2880                     | same                                      |
| zomato_* / swiggy / eazydiner | 10080 (7 d)  | weekly settlement cadence                 |
| federal          | 10080                    | low-activity account                      |

`/api/bank-feed?action=summary` computes `live_status` (healthy / stale / silent)
per row on read. Dashboard renders a red banner when any source is stale.

No separate cron needed — computation happens at request time against
`last_event_at`. If nobody opens the dashboard, nobody gets a signal — acceptable
tradeoff for a solo-operator tool.

Optional upgrade: a daily WhatsApp DM via the existing `attendance-cron` fetch
handler, pinging `/api/bank-feed?action=summary&pin=...` and sending
`any_source_stale=true` alerts.

## Reconciliation

Two-level:

1. **Per-row** (`reconcile_status` on `money_events`) — ties one bank debit to
   one expense/bill/platform payout. Status: `unreconciled | auto | manual | ignored`.
2. **Cross-source** (`money_recon_matches`) — ties one gross event (e.g.
   Razorpay settlement) to its matching net event (HDFC IMPS credit).
   Captures commission + tax deltas. Used to avoid double-counting in rollups.

Auto-match rules (planned, not yet built):
- Razorpay `settlement.processed` (amount=X, utr=U) + HDFC IMPS credit
  (amount=X±5%, counterparty `RAZORPAY*`) within 48 h → auto-match.
- Zomato payout email (amount=X, payout_date=D) + HDFC NEFT credit
  (amount≈X, counterparty `ZOMATO*`, txn_at≈D) → auto-match.

Manual fallback: dashboard row has an "ignore" action today; extend to
"match-to" once the reconciliation schema is exercised.

## D1 load order

```bash
cd HN-Hotels-Site
wrangler d1 execute hn-hiring --remote --file=schema-money-events.sql

# Seed with the 3-month backfill
python3 scripts/bank-backfill/backfill-hdfc-xls.py \
  /path/to/Acct_Statement_XXXXXXXX4680_DDMMYYYY.xls \
  > data/bank/backfill-hdfc-4680.sql
wrangler d1 execute hn-hiring --remote --file=data/bank/backfill-hdfc-4680.sql
```

After that, any subsequent live email/webhook writes land idempotently on top
of the backfill. No double counting.
