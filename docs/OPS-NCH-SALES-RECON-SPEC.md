# `/ops/sales/` NCH — Sales Reconciliation Dashboard Spec

**Status:** Spec only. No code written yet.
**Owner:** Nihaf
**Scope of this spec:** Nawabi Chai House (NCH) only. Hamza Express follows in a sibling spec after NCH ships and is verified.
**Goal:** A single live view that, for any chosen date range from **2026-04-01 onwards**, reconciles every NCH rupee from POS sale → cash pile / UPI rail / card / token. The dashboard must make the daily cash-vs-bank discrepancy visible before any expense is examined. This is the prerequisite to the Phase 2 PO/expense duplicate-detection work — without per-item POS consumption, BoM-driven dup detection has no anchor.

---

## Global rules (apply to every page in scope)

- **Mobile-first.** Owner uses iPhone Safari + Chrome Android. Every interaction must be ≥ 44 px tap target, scrollable in portrait, no horizontal scroll above the ledger row level.
- **Money in paise.** All sales / collections / discrepancies are stored as INTEGER paise in D1 and APIs. Convert to rupees only in the rendering layer. Never use floats for money math.
- **No build pipeline.** Vanilla HTML/JS/Tailwind CDN. No npm/Vite/Rollup. Mirror `ops/cash/index.html` shape exactly so future maintainers see one pattern, not two.
- **One branch, one draft PR per phase.** No bundling Phase A (sales mirror) with Phase B (Razorpay QR) with Phase C (UI).
- **Reuse, don't reinvent.**
  - PIN gate + USERS table + role gates → copy verbatim from `functions/api/cash.js` (lines 51–67).
  - Odoo JSON-RPC helper + `coCtx()` multi-company guard → copy from `functions/api/rm-ops.js` (lines 18–60).
  - Idempotent sync state → mirror the `cash_sync_state` cursor pattern (`schema-cash-events.sql` lines 152–182).
  - Live polling client → mirror `ops/cash/index.html` `schedulePoll()` (line 464).
- **Owner reviews + merges.** Draft PRs only. No production deploys from Claude.

---

## 1. Owner's mental model — the reconciliation formula

```
Layer 1 — POS sales (Odoo, ops.hamzahotel.com, company_id=10)
  pos.config 27 ──┐
  pos.config 28 ──┼── pos.order  (state ∈ paid|done|invoiced)
  pos.config 29 ──┘   ↓
                    pos.payment per order (1..N)
                    │
                    │ payment_method_id.name ∈ {
                    │   NCH Cash         → counter cash
                    │   NCH UPI          → counter UPI (→ Counter Razorpay QR)
                    │   NCH Card         → counter card (→ HDFC card terminal)
                    │   NCH Runner Ledger→ runner-attributed (cash+UPI mixed)
                    │   NCH Token Issue  → token issuance  (cash+UPI mixed)
                    │   Complimentary    → not money
                    │ }

Layer 2 — Razorpay QR collections (Razorpay REST API, /v1/payments/qr_codes/:id/payments)
  Counter Razorpay QR  ── matches Layer 1 PM=NCH UPI for the same date
  Runner QR 1 (Nafees) ─┐
  Runner QR 2 (…)      ─┼─ split: 5 rows total. Sum across these = "Runner UPI total".
  Runner QR 3 (…)      ─┤
  Runner QR 4 (…)      ─┤
  Runner QR 5 (…)      ─┘

Layer 3 — Reconciliation (computed daily)
  runner_sales_paise        = Σ PM=NCH Runner Ledger + PM=NCH Token Issue        (from Layer 1)
  runner_upi_paise          = Σ across 5 Runner QRs                              (from Layer 2)
  runner_cash_paise         = runner_sales_paise − runner_upi_paise              (DERIVED)

  counter_cash_paise        = Σ PM=NCH Cash                                      (from Layer 1)
  counter_upi_pos_paise     = Σ PM=NCH UPI                                       (from Layer 1)
  counter_upi_rzp_paise     = Σ Counter Razorpay QR                              (from Layer 2)
  counter_card_paise        = Σ PM=NCH Card                                      (from Layer 1)
  complimentary_paise       = Σ PM=Complimentary                                 (from Layer 1; not money)

  total_cash_paise          = runner_cash_paise + counter_cash_paise
  total_upi_paise           = runner_upi_paise  + counter_upi_rzp_paise
  total_card_paise          = counter_card_paise

  upi_discrepancy_paise     = counter_upi_pos_paise − counter_upi_rzp_paise
                              (should be ≈ 0; sustained drift means a misclassified
                               counter swipe or a stray runner UPI hit on the counter QR)

Layer 4 — Live cash pile reconciliation (cross-check vs /ops/cash/)
  total_cash_paise (this dashboard)
   ≈ daily delta in pos_counter_nch + (cash that left NCH till to Basheer)
     i.e. SUM of /api/cash trail credits for source ∈
         (runner_settlement, main_counter_cash, opening_float)
         minus debits (counter_expense, collection_handover)
     for the same day.
```

### Worked example — a representative NCH day from April

Take **2026-04-11** (highest sales day in the snapshot):

| Layer 1 — Odoo POS (Apr 11)                    | Orders | Gross    |
|------------------------------------------------|-------:|---------:|
| NCH Cash                                       |     81 |  ₹4,636  |
| NCH UPI                                        |     83 |  ₹5,629  |
| NCH Card                                       |      1 |  ₹40     |
| NCH Runner Ledger                              |    147 |  ₹5,410  |
| NCH Token Issue                                |     35 | ₹13,470  |
| Complimentary                                  |     20 |  ₹1,010  |
| **Total (excl Complimentary)**                 |    347 | **₹29,185** |

```
runner_sales        = 5,410 + 13,470 = ₹18,880
runner_upi (RZP, hypothetical)        = ₹11,500
runner_cash (derived)                 = ₹18,880 − ₹11,500 = ₹7,380

counter_cash                          = ₹4,636
counter_upi_pos                       = ₹5,629
counter_upi_rzp (hypothetical)        = ₹5,612   (₹17 stuck-in-flight diff)
counter_card                          = ₹40

total_cash_paise   = 7,380 + 4,636    = ₹12,016
total_upi_paise    = 11,500 + 5,612   = ₹17,112
total_card_paise                      = ₹40
─────────────────────────────────────────────
grand_total                           = ₹29,168
upi_discrepancy                       = +₹17 (acceptable; auto-resolves at next Razorpay sync)
```

The dashboard's daily row shows: **Apr 11 · ₹29,168 sales · ₹12,016 cash · ₹17,112 UPI · ₹40 card · UPI ✓ (₹17 in-flight)**.

---

## 2. Data sources

| # | Source | Endpoint / API | Reachable from CF Pages Function? | Notes |
|---|---|---|---|---|
| 1 | NCH POS (Odoo) | `https://ops.hamzahotel.com/jsonrpc`, db `main`, company_id=10 | Yes (already used by `workers/spend-sync-cron`, `functions/api/hr-admin.js`, `functions/api/finance.js`) | Master POS data: pos.order, pos.payment, pos.payment.method, pos.order.line, pos.config |
| 2 | Razorpay QR collections | `https://api.razorpay.com/v1/payments/qr_codes/:qr_id/payments?from=...&to=...&count=100` (Basic auth, key_id : key_secret) | Yes | Paginated. 6 QRs total: 5 runner + 1 counter. Public Razorpay docs: [docs.razorpay.com/docs/qr-codes-apis](https://razorpay.com/docs/api/qr-codes/) |
| 3 | Razorpay webhook | `workers/razorpay-webhook` (already deployed) | Yes | Currently signature-verifies + 200s only. Re-enable ingest into the new `razorpay_payments` table built here. |
| 4 | NCH /api/settlement | `https://nawabichaihouse.com/api/settlement?action=history` etc. | Yes (already consumed by `functions/api/cash.js:593`) | Per-runner: `tokens_amount`, `sales_amount`, `upi_amount`, `cash_settled`. Used as a **cross-check**, not a primary input — Layer 1 + Layer 2 are the truth, settlement is the runner's declaration. |

---

## 3. What exists today

| Piece | Exists? | Where | Gap for this spec |
|---|---|---|---|
| Odoo NCH POS read pattern | Partial | `scripts/snapshot-context.js:145` (`pullPosBrand`), `functions/api/rm-ops.js:2371` (`fetchPOSSales`) | snapshot script is laptop-only; rm-ops fetcher hits the wrong host (`odoo.hnhotels.in`, not `ops.hamzahotel.com`). Need a CF-side fetcher targeting `ops.hamzahotel.com` with `OPS_ODOO_KEY` |
| Item-level POS lines | Yes | `functions/api/rm-ops.js:2383` reads `pos.order.line` | Same host issue — adapt the pattern, don't import |
| Daily channel rollup | Yes (snapshot) | `data/snapshots/sales-daily-last60d.json` | 60-day, daily grain, no per-config / no per-pos.payment. Need finer grain in D1 |
| Per-config (27/28/29) labels | No | — | pos.config IDs exist in `rm-ops.js:34` (NCH `[27, 28]`) but the third (29) and the human-readable names ("Counter / Runner / Token") aren't in the repo. Discover at first sync: read pos.config records and persist `pos_config_registry` |
| Razorpay webhook | Deployed but inert | `workers/razorpay-webhook/index.js:37` (`INGEST_TO_MONEY_EVENTS=false`) | Flip on for the new `razorpay_payments` table |
| Razorpay REST polling | None | — | Build new — webhook misses historical days (Apr 1 → today) and isn't QR-attributed |
| 5 NCH runner QR IDs | Not in repo | — | Owner-supplied at setup time. Stored in new `razorpay_qr_registry` table, not env, so they can be reassigned (runner attrition) without redeploy |
| `pos_counter_nch` cash pile | Yes | `cash_events` (per `schema-cash-events.sql`) | Already correct — this dashboard is read-side; cash writes stay in `/api/cash` |

---

## 4. What's missing — the build list

1. **D1 tables** — five new tables (Section 5).
2. **`/api/sales` Function** — read endpoints for the dashboard + admin actions for QR registry (Section 6.1).
3. **`workers/nch-sales-sync-cron`** — 5-minute cron pulling Odoo + Razorpay deltas into D1 (Section 6.2).
4. **Razorpay webhook flip** — turn on ingest into `razorpay_payments`, attribute by `qr_code_id` (Section 6.3).
5. **`/ops/sales/index.html`** — the dashboard (Section 7).
6. **April back-fill** — one-shot script to populate Apr 1 → first cron tick (Section 9).

Total: 1 schema migration, 1 new Function, 1 new Worker, 1 webhook patch, 1 new page, 1 backfill script.

---

## 5. Architecture — data layer

### 5.1 New D1 tables

All schemas live in a new file `schema-sales-recon.sql`. Run once on prod:

```bash
wrangler d1 execute hn-hiring --remote --file=schema-sales-recon.sql
```

#### `pos_config_registry`
Discovered at first sync from Odoo `pos.config`. Lets the UI render "Counter POS" instead of "config_id 29".

```
pos_config_id   INTEGER PRIMARY KEY      -- 27 / 28 / 29
brand           TEXT NOT NULL CHECK (brand IN ('NCH','HE'))
name            TEXT NOT NULL            -- raw Odoo name e.g. "NCH Counter"
label           TEXT                     -- owner-friendly: "Counter POS" / "Runner POS" / "Token POS"
station_kind    TEXT CHECK (station_kind IN ('counter','runner','token','other'))
last_seen_at    TEXT
```

#### `pos_orders_mirror`
One row per Odoo `pos.order`. Persisted so the dashboard doesn't re-hit Odoo for stale days.

```
odoo_pos_order_id  INTEGER PRIMARY KEY    -- pos.order.id
brand              TEXT NOT NULL CHECK (brand IN ('NCH','HE'))
pos_config_id      INTEGER NOT NULL
session_id         INTEGER
order_name         TEXT                   -- pos.order.name
order_date_ist     TEXT NOT NULL          -- ISO with +05:30 — keep IST literal
order_date_day     TEXT NOT NULL          -- YYYY-MM-DD (IST) — for fast daily group-by
amount_total_paise INTEGER NOT NULL
amount_tax_paise   INTEGER NOT NULL DEFAULT 0
state              TEXT
payment_methods_csv TEXT                  -- denormalized "NCH Cash,NCH UPI" for filter
synced_at          TEXT NOT NULL
```

Indexes: `(brand, order_date_day)`, `(pos_config_id, order_date_day)`, `(state)`.

#### `pos_payments_mirror`
One row per `pos.payment`. Carries the PM name verbatim — no enum, because new PMs may appear.

```
odoo_pos_payment_id INTEGER PRIMARY KEY
odoo_pos_order_id   INTEGER NOT NULL
brand               TEXT NOT NULL
order_date_day      TEXT NOT NULL          -- denormalized for fast roll-up
pos_config_id       INTEGER NOT NULL
payment_method_id   INTEGER NOT NULL
payment_method_name TEXT NOT NULL          -- "NCH Cash" | "NCH UPI" | "NCH Runner Ledger" | …
amount_paise        INTEGER NOT NULL       -- paise; sign already correct
synced_at           TEXT NOT NULL
FOREIGN KEY (odoo_pos_order_id) REFERENCES pos_orders_mirror(odoo_pos_order_id)
```

Indexes: `(brand, order_date_day, payment_method_name)`, `(payment_method_name, order_date_day)`.

#### `pos_lines_mirror`
One row per `pos.order.line`. Item-level; the foundation for Phase 2 BoM-driven dup detection.

```
odoo_pos_line_id    INTEGER PRIMARY KEY
odoo_pos_order_id   INTEGER NOT NULL
brand               TEXT NOT NULL
order_date_day      TEXT NOT NULL
pos_config_id       INTEGER NOT NULL
product_id          INTEGER NOT NULL
product_name        TEXT
qty                 REAL NOT NULL          -- can be 0.5 for half-haleem etc.
price_subtotal_incl_paise INTEGER NOT NULL
synced_at           TEXT NOT NULL
FOREIGN KEY (odoo_pos_order_id) REFERENCES pos_orders_mirror(odoo_pos_order_id)
```

Indexes: `(brand, order_date_day, product_id)`, `(product_id, order_date_day)`.

`qty` is REAL on purpose — POS allows half-units (haleem half-portion = 0.5). The integer-paise rule applies to **money**, not quantity.

#### `razorpay_qr_registry`
Owner-managed mapping of Razorpay QR codes → role + runner. Editable from the dashboard so runner attrition (e.g. Nafees leaves, replaced by Yashwant) doesn't require redeploy.

```
qr_code_id     TEXT PRIMARY KEY            -- razorpay qr_code id, e.g. "qr_LzAcOHEIeAtssh"
brand          TEXT NOT NULL CHECK (brand IN ('NCH','HE'))
role           TEXT NOT NULL CHECK (role IN ('counter','runner'))
runner_name    TEXT                        -- NULL for counter
runner_pin     TEXT                        -- NULL for counter; matches USERS PIN (if any)
display_name   TEXT NOT NULL               -- "Counter NCH" / "Runner — Nafees"
active         INTEGER NOT NULL DEFAULT 1
created_at     TEXT NOT NULL
deactivated_at TEXT
notes          TEXT
```

For NCH ship: 6 rows seeded by owner — 1 counter, 5 runners. PIN-mapped runners (runner_pin) make `pos.order.created_by` heuristics possible later.

#### `razorpay_qr_collections`
One row per Razorpay payment captured against a known QR. Inserted by the Razorpay sync worker (REST polling) AND by the webhook (when ingestion is flipped on). UNIQUE on `razorpay_payment_id` makes both paths idempotent.

```
razorpay_payment_id TEXT PRIMARY KEY        -- "pay_LzAcXYZ…"
qr_code_id          TEXT NOT NULL
brand               TEXT NOT NULL
role                TEXT NOT NULL CHECK (role IN ('counter','runner'))
amount_paise        INTEGER NOT NULL CHECK (amount_paise >= 0)
fee_paise           INTEGER NOT NULL DEFAULT 0
tax_paise           INTEGER NOT NULL DEFAULT 0
status              TEXT NOT NULL          -- captured | refunded | failed
method              TEXT                    -- upi | card | wallet
vpa                 TEXT                    -- payer VPA when present
contact             TEXT
captured_at         TEXT NOT NULL          -- ISO; the Razorpay-side timestamp
captured_at_day     TEXT NOT NULL          -- YYYY-MM-DD IST — for fast daily sums
synced_at           TEXT NOT NULL
synced_via          TEXT NOT NULL CHECK (synced_via IN ('webhook','rest_poll','manual'))
raw_payload         TEXT                    -- truncated JSON (≤ 8 KB) for forensics
notes               TEXT
FOREIGN KEY (qr_code_id) REFERENCES razorpay_qr_registry(qr_code_id)
```

Indexes: `(qr_code_id, captured_at_day)`, `(brand, captured_at_day)`, `(role, captured_at_day)`.

#### `sales_recon_daily` (computed, not authoritative)
Materialised per-day reconciliation. Refreshed by the sync worker after every Odoo + Razorpay tick. The dashboard reads this table for the daily grid; computing it on every page load is expensive at 60+ days.

```
brand               TEXT NOT NULL
day                 TEXT NOT NULL           -- YYYY-MM-DD IST
gross_sales_paise   INTEGER NOT NULL        -- excl. Complimentary
counter_cash_paise  INTEGER NOT NULL
counter_upi_pos_paise INTEGER NOT NULL
counter_upi_rzp_paise INTEGER NOT NULL
counter_card_paise  INTEGER NOT NULL
runner_sales_paise  INTEGER NOT NULL        -- PM=Runner Ledger + PM=Token Issue
runner_upi_paise    INTEGER NOT NULL        -- Σ over 5 runner QRs
runner_cash_paise   INTEGER NOT NULL        -- runner_sales − runner_upi
total_cash_paise    INTEGER NOT NULL        -- counter_cash + runner_cash
total_upi_paise     INTEGER NOT NULL
upi_discrepancy_paise INTEGER NOT NULL      -- counter_upi_pos − counter_upi_rzp
complimentary_paise INTEGER NOT NULL
unmapped_paise      INTEGER NOT NULL DEFAULT 0  -- PM the registry doesn't recognise; flag in UI
order_count         INTEGER NOT NULL
last_recomputed_at  TEXT NOT NULL
PRIMARY KEY (brand, day)
```

#### `sales_sync_state`
Mirrors `cash_sync_state`. One row per sync source; idempotent cursors.

```
sync_source TEXT PRIMARY KEY CHECK (sync_source IN (
  'nch_pos_orders',         -- ops.hamzahotel.com pos.order delta
  'nch_pos_payments',       -- ops.hamzahotel.com pos.payment delta
  'nch_pos_lines',          -- ops.hamzahotel.com pos.order.line delta
  'nch_pos_config',          -- ops.hamzahotel.com pos.config refresh
  'nch_razorpay_qr_poll',    -- Razorpay REST /payments/qr_codes/:id/payments
  'nch_recon_daily_compute'  -- the materialiser
))
last_synced_id   INTEGER
last_synced_at   TEXT
last_run_at      TEXT
last_run_status  TEXT CHECK (last_run_status IN ('ok','error','running','idle'))
last_error       TEXT
rows_added_total INTEGER NOT NULL DEFAULT 0
rows_added_last_run INTEGER NOT NULL DEFAULT 0
notes            TEXT
```

Seeded with `last_synced_at = '2026-04-01T00:00:00+05:30'` for every NCH source — that's the user's chosen anchor.

---

## 6. Architecture — API + worker layer

### 6.1 New `/api/sales` Function — `functions/api/sales.js`

Same response envelope as `/api/cash` (`{ success, ... }` JSON with CORS).

| Action | Method | Args | Returns |
|---|---|---|---|
| `?action=overview` | GET | `pin, from?, to?` (default Apr 1 → today IST) | KPI tiles: gross / cash / upi / card / discrepancy + last-sync timestamp |
| `?action=daily` | GET | `pin, from?, to?` | `sales_recon_daily` rows in range, newest first |
| `?action=pm-breakdown` | GET | `pin, from?, to?, pos_config_id?` | Σ amount_paise grouped by `payment_method_name` (and optionally per pos_config_id) — drives the PM stack |
| `?action=items` | GET | `pin, from?, to?, pos_config_id?, search?, limit=200` | Item-level grid: product, qty, gross, share-of-revenue |
| `?action=qr-registry` | GET | `pin` | `razorpay_qr_registry` rows with today + MTD sums attached |
| `?action=qr-collections` | GET | `pin, from?, to?, qr_code_id?` | `razorpay_qr_collections` rows |
| `?action=upsert-qr` | POST | `pin (admin/cfo), qr_code_id, brand, role, runner_name?, runner_pin?, display_name, active` | Owner-managed QR registry |
| `?action=sync` | POST | `pin (admin/cfo), source?` | Triggers the cron worker's logic synchronously (used by "Sync now" button + /scripts) |
| `?action=sync-status` | GET | `pin` | `sales_sync_state` rows |
| `?action=recompute-day` | POST | `pin (admin/cfo), day` | Force-refresh `sales_recon_daily` for a single day (after a manual fix) |

**Roles:** read endpoints — admin/cfo/gm/asstmgr/purchase/cashier/viewer. Mutating endpoints (`upsert-qr`, `sync`, `recompute-day`) — admin/cfo only. Same USERS table as `/api/cash`.

### 6.2 Sync layer — extend `workers/spend-sync-cron`, do NOT add a new cron

**Why no new Worker:** Cloudflare free-tier caps at **5 cron triggers per account**, and we're at the cap (`workers/spend-sync-cron/wrangler.toml:7`: "we're at the limit"). The established pattern is the **piggyback ping** — `hn-attendance-cron` (`*/15 * * * *`) calls peer Workers' fetch handlers with `DASHBOARD_KEY`. Sales sync follows the same pattern.

**Implementation:** add a new section to `workers/spend-sync-cron/index.js` exposing two new sync flows alongside the existing `counter_expenses_v2` ingest. The Worker already has the right bindings: `DB` (`hn-hiring`), `DB_NCH` (`nch-settlements`), `ODOO_KEY_HNHOTELS`, `ODOO_KEY_OPS_HAMZA`, `DASHBOARD_KEY`. Only Razorpay secrets are missing — add them.

**Cadence:** every 15 min during business hours via the existing `attendance-cron` ping. Dashboard staleness ≤ 15 min is acceptable for a daily reconciliation view (the client still polls every 30 s for cached `sales_recon_daily` rows).

**Per-tick work plan** (each step idempotent, soft-fails independently; runs inside `spend-sync-cron`'s existing fetch handler):

1. **`syncPosConfig`** — once a day (skip if last run < 24 h ago): read `pos.config` for company_id=10, upsert into `pos_config_registry`.
2. **`syncPosOrders`** — read `pos.order` from `ops.hamzahotel.com` where `id > last_synced_id` (ascending), in 1000-row chunks. Persist into `pos_orders_mirror`. Advance cursor.
3. **`syncPosPayments`** — read `pos.payment` `id > last_synced_id`, persist into `pos_payments_mirror`. Advance cursor.
4. **`syncPosLines`** — read `pos.order.line` `id > last_synced_id`, persist into `pos_lines_mirror`. Advance cursor.
5. **`syncRazorpayQrPoll`** — for each active row in `razorpay_qr_registry`, GET `https://api.razorpay.com/v1/payments/qr_codes/:qr_id/payments?from=<unix>&to=<unix>&count=100` (Basic auth: `RAZORPAY_KEY:RAZORPAY_SECRET`), page until empty. Upsert into `razorpay_qr_collections` on `razorpay_payment_id`. Advance per-QR cursor stored in a per-QR sub-row of `sales_sync_state`.
6. **`computeReconDaily`** — for every day in `[today−14, today]`, recompute the row and UPSERT into `sales_recon_daily`. The 14-day rolling window covers late-arriving Razorpay refunds without recomputing all of April every tick.

**Subrequest budget:** CF free tier caps at 1000 subrequests/invocation. NCH typically books ~340 orders/day; a 15-min delta is ≤ 5 orders → well under 50 subrequests/tick. The daily `syncPosConfig` + a Razorpay 6-QR pull adds ~12 subrequests. Comfortable.

**Razorpay rate limit:** 5000 req/min in live mode — comfortable at 15-min cadence.

**Required new secrets on `hn-spend-sync-cron`** (copy from NCH Pages project per asset DB rows 73/74; same Razorpay account):
```
wrangler secret put RAZORPAY_KEY    --config workers/spend-sync-cron/wrangler.toml
wrangler secret put RAZORPAY_SECRET --config workers/spend-sync-cron/wrangler.toml
```

**Required new secrets on `hn-hotels-site` Pages** (so the `/api/sales` Function can run an on-demand `?action=sync` from the dashboard "Sync now" button):
```
wrangler pages secret put RAZORPAY_KEY    --project-name hn-hotels-site
wrangler pages secret put RAZORPAY_SECRET --project-name hn-hotels-site
```
`ODOO_API_KEY` is already on `hn-hotels-site` (asset DB row 144 — admin UID 2 → `ops.hamzahotel.com`). No additional Odoo secret needed.

### 6.3 Razorpay webhook patch — `workers/razorpay-webhook/index.js`

Flip `INGEST_TO_MONEY_EVENTS` semantics:
- Don't write to `money_events` (that pivot stays — Razorpay is settlement-side, not money source).
- Do write to `razorpay_qr_collections` when the captured payment carries a `qr_code_id` matching `razorpay_qr_registry`.
- Webhooks arrive within seconds; cron poll is the safety net for missed deliveries.

### 6.4 What we explicitly do NOT build

- Per-runner identity attribution within `NCH Runner Ledger` POS rows. Odoo doesn't tag the runner on the order line; the only runner signal is the QR the customer paid to. Phase 1 rolls up to "Runner UPI total" without per-runner-runner-sales matching. Phase 2 adds per-runner attribution by joining `razorpay_qr_collections.qr_code_id` → `razorpay_qr_registry.runner_pin` against settlement `runner_id`.
- HE side. Sibling spec after NCH ships and the recon math is verified for a full week.
- Aggregator (Swiggy/Zomato) reconciliation. Lives in `/ops/aggregator/`, separate flow.
- WABA orders. The repo shows `NCH WABA UPI` and `NCH WABA COD` PMs but volume is tiny — they roll into the overall cash/UPI buckets without special UI.

---

## 7. Architecture — UI layer (`ops/sales/index.html`)

### 7.1 Layout (mobile-first portrait)

Mirror `ops/cash/index.html` chrome (PIN gate, header, nav, sticky filter bar). The body is **5 vertical sections**, each collapsible. On desktop the first two are shown side-by-side; on mobile they stack.

```
┌─────────────────────────────────────────────┐
│ Header: HN / sales       [live●] [↻] [user] │
│ Nav: money bank cash expense purchase sales*│
├─────────────────────────────────────────────┤
│ Filter bar (sticky):                        │
│   from [2026-04-01] → to [today]            │
│   POS [All ▾]  PM [All ▾]                   │
│   ☐ Show only days with discrepancy         │
└─────────────────────────────────────────────┘

§1 KPI tiles  (always expanded, 2×2 mobile / 1×4 desktop)
  ┌────────────┐┌────────────┐┌────────────┐┌────────────┐
  │ Sales      ││ Cash       ││ UPI        ││ Discrepancy│
  │ ₹4,82,000  ││ ₹1,89,200  ││ ₹2,82,400  ││ ₹240 yel   │
  │ Apr 1–28   ││ 39%        ││ 58%        ││ 2 days red │
  └────────────┘└────────────┘└────────────┘└────────────┘
  + 1 row of secondary chips: Card · Complimentary · Order count · Avg ticket
  + last-sync indicator: "synced 47s ago · pos·rzp·recon"

§2 Daily reconciliation grid  (default expanded, 28 rows)
  | Day        | Sales  | Cash | UPI  | Card | Discrep | ▾ |
  | Apr 28     | …      | …    | …    | …    | ✓ ₹0    |   |
  | Apr 27     | …      | …    | …    | …    | ⚠ ₹120  |   |
  Row tap → expand: PM stack chart + RZP QR sub-rows for that day

§3 POS breakdown  (collapsed by default)
  Table per pos.config × payment_method_name
  Counter POS (config 29):  Cash 4,636 | UPI 5,629 | Card 40
  Runner POS  (config 28):  Runner Ledger 5,410
  Token POS   (config 27):  Token Issue 13,470
  Below: a stacked-bar chart for the date range — pure SVG, no chart library.

§4 Items  (collapsed by default)
  Search box. Top-200 grid for the date range:
  | Item          | Qty   | Revenue | %share | Top POS |
  | Irani Chai    | 8,420 | 1,68,400| 35%    | Counter |
  | Haleem Full   | 320   | 28,800  | 6%     | Counter |
  | Haleem Half   | 410   | 18,450  | 4%     | Counter |
  | Bun Maska     | 1,210 | 12,100  | 3%     | Counter |
  | Osmania       | 980   | 6,860   | 1.4%   | Counter |
  Sort headers. Phase 2 adds a "BoM consumption" column — left blank for now but the schema supports it.

§5 Razorpay QR registry  (collapsed; admin/cfo only)
  6 cards, 1 per QR:
   ┌─────────────────────────────────────────┐
   │ Counter NCH               [edit]        │
   │ qr_LzAcOHEIeAtssh                        │
   │ Today ₹3,200 · MTD ₹84,500 · last 12s   │
   └─────────────────────────────────────────┘
  + button: "Add QR" (admin/cfo)

§6 Sync status  (always at bottom, collapsed)
  Per-source dots (mirror ops/cash/'s sync-rows pattern).
```

### 7.2 Live update mechanism

- Client poll: `loadOverview()` every **30 s** (same cadence as `/ops/cash/`). Visible "live" green dot pulse; goes red and labels "paused" if a fetch fails.
- Server: 15-minute tick via `attendance-cron`'s existing piggyback into `spend-sync-cron` (Section 6.2). The cap on cron triggers is hit, so this is the chosen path.
- "Sync now" button on the dashboard hits `/api/sales?action=sync` (admin/cfo only) for the impatient owner case — that path runs the same flows synchronously and writes the same cursors. Idempotent vs the cron tick.
- Result: data is at most ~15 min stale during business hours; the client polls the cached `sales_recon_daily` so the UI feels instant on every tab switch.

### 7.3 Discrepancy semantics — what colour for what

```
upi_discrepancy_paise    abs    | colour
< 100 paise (₹1)                 | green ✓
< 10000 paise (₹100)             | yellow ⚠ "in flight, will reconcile"
≥ 10000 paise (₹100)             | red ⚠ "needs investigation"
```

Tap a yellow/red day → opens a side drawer with: matching POS rows, matching Razorpay rows, suspected misclassification candidates ("a counter UPI hit a runner QR" and similar pattern hints).

---

## 8. The reconciliation formula — formal

The materialiser is one SQL UPSERT per day per brand. Pseudo-SQL (D1 dialect):

```sql
WITH
day_payments AS (
  SELECT order_date_day, payment_method_name, SUM(amount_paise) AS p
  FROM pos_payments_mirror
  WHERE brand = 'NCH' AND order_date_day = ?
  GROUP BY 1, 2
),
day_qr AS (
  SELECT captured_at_day, role, SUM(amount_paise) AS p
  FROM razorpay_qr_collections
  WHERE brand = 'NCH' AND captured_at_day = ? AND status = 'captured'
  GROUP BY 1, 2
),
day_orders AS (
  SELECT order_date_day, COUNT(*) AS n,
         SUM(CASE WHEN payment_methods_csv NOT LIKE '%Complimentary%' THEN amount_total_paise ELSE 0 END) AS gross_paise,
         SUM(CASE WHEN payment_methods_csv LIKE '%Complimentary%' THEN amount_total_paise ELSE 0 END) AS comp_paise
  FROM pos_orders_mirror
  WHERE brand = 'NCH' AND order_date_day = ?
  GROUP BY 1
)
SELECT
  -- counter_*
  COALESCE((SELECT p FROM day_payments WHERE payment_method_name = 'NCH Cash'), 0)        AS counter_cash_paise,
  COALESCE((SELECT p FROM day_payments WHERE payment_method_name = 'NCH UPI'),  0)        AS counter_upi_pos_paise,
  COALESCE((SELECT p FROM day_qr WHERE role = 'counter'), 0)                              AS counter_upi_rzp_paise,
  COALESCE((SELECT p FROM day_payments WHERE payment_method_name = 'NCH Card'), 0)        AS counter_card_paise,
  -- runner_*
  COALESCE((SELECT p FROM day_payments WHERE payment_method_name = 'NCH Runner Ledger'),0)
   + COALESCE((SELECT p FROM day_payments WHERE payment_method_name = 'NCH Token Issue'),0) AS runner_sales_paise,
  COALESCE((SELECT p FROM day_qr WHERE role = 'runner'), 0)                                AS runner_upi_paise,
  -- and the derived columns are computed in JS and UPSERTed
  (SELECT n FROM day_orders) AS order_count,
  (SELECT gross_paise FROM day_orders) AS gross_sales_paise,
  (SELECT comp_paise  FROM day_orders) AS complimentary_paise;
```

Then in JS:

```
runner_cash_paise   = runner_sales_paise − runner_upi_paise
total_cash_paise    = runner_cash_paise + counter_cash_paise
total_upi_paise     = runner_upi_paise  + counter_upi_rzp_paise
upi_discrepancy_paise = counter_upi_pos_paise − counter_upi_rzp_paise
unmapped_paise      = (Σ all payment_method_names not in the recognised set, excluding Complimentary)
```

`unmapped_paise > 0` triggers a UI banner: "PM '<name>' isn't in the recogniser; sales recon may be off by ₹X". This catches new PMs that show up in Odoo without code changes.

---

## 9. April back-fill plan (one-shot)

Without this, `/ops/sales/` is correct only from the first cron tick onwards.

`scripts/sales-backfill/run-nch.js`:

1. Pull `pos.config` rows for company_id=10. Persist into `pos_config_registry`.
2. Pull every `pos.order` with `date_order >= 2026-04-01` and `state in (paid, done, invoiced)`. Walk in 1000-row chunks. Persist into `pos_orders_mirror`.
3. Pull `pos.payment` for the same orders. Persist into `pos_payments_mirror`.
4. Pull `pos.order.line` for the same orders. Persist into `pos_lines_mirror`.
5. Owner registers the 6 Razorpay QR IDs via `/ops/sales/` UI (Section 7.1 §5) **before** step 6.
6. For each registered QR, GET `/v1/payments/qr_codes/:qr_id/payments?from=2026-04-01T00:00:00+05:30&to=now` paginated. Persist into `razorpay_qr_collections`.
7. For every day Apr 1 → today, run `computeReconDaily(brand='NCH', day=...)`. Persist into `sales_recon_daily`.
8. Print a summary: per-day `gross_sales_paise`, `unmapped_paise`, `upi_discrepancy_paise`, count of days with red-tier discrepancy. Owner reviews.
9. Step 8 acceptance: zero `unmapped_paise` or zero red-tier discrepancies, OR the listed exceptions are explained in `data/sales-recon-exceptions.csv`.

Idempotent — re-running uses the same UNIQUE keys and overwrites computed rows.

---

## 10. Phase 2 hooks — BoM-driven duplicate detection (out of scope here)

The user's concern: a counter-recorded "₹500 sugar" cash expense + a Zoya PO for "10kg sugar @ ₹50" on the same week may be the same purchase logged twice. Today there's no signal. With this dashboard's `pos_lines_mirror`:

```
expected_consumption(item, day) = Σ over menu_items of (qty_sold × bom_factor)
```

For NCH, the BoM-sensitive items are well-known (chai → tea-leaf, sugar, milk; haleem → wheat, mutton, ghee; etc.). Once Phase 2 adds `nch_bom` (item × raw_material × ratio), the dup detector becomes:

```
For each raw_material × week:
  expected = Σ pos_lines_mirror item_qty × bom_ratio
  observed = Σ purchase_bills + counter_expenses (vendor expense category)
  if observed > expected × 1.15 → flag for review
  if a single purchase + a single counter expense on the same vendor within 7 days → strong dup signal
```

This dashboard does not implement detection. It only ensures `pos_lines_mirror` has the per-item per-day quantity Phase 2 will need.

---

## 11. Files likely to be touched

| File | Change | Notes |
|---|---|---|
| `schema-sales-recon.sql` | NEW — 7 tables | One migration; `wrangler d1 execute hn-hiring --remote` |
| `functions/api/sales.js` | NEW — 10 actions | Mirror `/api/cash` shape; reuses already-deployed `ODOO_API_KEY` (asset DB row 144) |
| `workers/spend-sync-cron/index.js` | EDIT — extend with NCH sales sync flows | No new Worker (CF cron cap hit per `wrangler.toml:7`); piggyback on existing `attendance-cron` ping |
| `workers/spend-sync-cron/wrangler.toml` | EDIT — add secret comment lines for `RAZORPAY_KEY` + `RAZORPAY_SECRET` | Bindings (`DB`, `DB_NCH`, `ODOO_KEY_OPS_HAMZA`) already present |
| `workers/attendance-cron/index.js` | EDIT — add ping to spend-sync-cron's new sales-sync path (or reuse existing ping if it already covers all of spend-sync-cron's flows) | Verify the existing ping triggers all of spend-sync-cron's per-tick work; if it does, this row drops to "no change" |
| `workers/razorpay-webhook/index.js` | EDIT — flip ingest path | Match captured payment's `qr_code_id` against `razorpay_qr_registry`; insert into `razorpay_qr_collections` only on match. `INGEST_TO_MONEY_EVENTS` stays false (architecture pivot 2026-04-23 holds for `money_events`). |
| `ops/sales/index.html` | NEW — the dashboard | Mirrors `ops/cash/index.html` chrome (PIN gate, USERS table, 30 s poll, sheet-overlay forms) |
| `scripts/sales-backfill/run-nch.js` | NEW | One-shot Apr 1 → first sync; uses `OPS_ODOO_KEY` from `.env.local` (snapshot pattern) |
| `ops/cash/index.html` | EDIT (1 line) | Add `<a href="/ops/sales/">sales</a>` to the nav |
| `index.html` | EDIT (optional) | Cross-link `/ops/sales/` from any owner shell that lists `/ops/*` pages |

**No new `wrangler.toml`, no new Worker.** The CF account already has its 5 cron triggers spent (gmail-poller `*/1`, attendance-cron `*/15`, others); adding a new one would silently exceed the free-tier limit. The piggyback pattern is already in production for `spend-sync-cron`.

(Confirm by reading each file before edit, per execution charter.)

---

## 12. Out of scope for this spec

- HE sales reconciliation (sibling spec).
- Aggregator (Swiggy/Zomato) sales — already in `/ops/aggregator/`.
- Bank-side reconciliation (HDFC/Federal credits matching Razorpay settlements) — already in `/ops/bank/`.
- Settlement vs runner-declared accuracy — `/api/settlement` cross-check is a UI-only overlay, not a write path.
- Push notifications. Owner already gets enough; this dashboard is pull-driven.
- P&L. That's Phase 4 (`docs/EXECUTION-CHARTER.md`).

---

## 13. Acceptance criteria

1. **Schema applied.** `wrangler d1 execute hn-hiring --remote --file=schema-sales-recon.sql` succeeds. All seven tables exist with the indexes named above.
2. **Backfill clean.** After `scripts/sales-backfill/run-nch.js`, `pos_orders_mirror` order count for any day Apr 1 → backfill-date matches `data/snapshots/sales-daily-last60d.json` order count for that day within ±1 order (drift tolerance for the rare same-second order arriving mid-pull).
3. **Sync live.** `spend-sync-cron`'s extended sales-sync path runs cleanly across 4 successive `attendance-cron` pings (≥ 1 hour) with no error rows in `sales_sync_state`. `rows_added_total` increments organically across orders / payments / lines / qr_poll / recon_compute.
4. **Razorpay QR registry usable.** Owner registers 6 QRs via the `/ops/sales/` UI. Each QR receives at least one `razorpay_qr_collections` row within 60 min of registration (assuming there's traffic).
5. **Reconciliation formula exact.** For every day Apr 1 → today, `gross_sales_paise = total_cash_paise + total_upi_paise + total_card_paise + complimentary_paise + unmapped_paise` (this is the integrity invariant). Drift > ₹1 on any day is a bug.
6. **UPI discrepancy bounded.** For at least 5 of any 7 consecutive days, `|upi_discrepancy_paise| < ₹100`. Days that fail this gate get an entry in `data/sales-recon-exceptions.csv` with owner-supplied reason.
7. **Mobile shape.** `/ops/sales/` loads on iPhone Safari + Chrome Android. Every tap target ≥ 44 px. Filter bar sticks. Tables scroll horizontally without overflowing the viewport.
8. **Live feel.** With 30-second client poll + 15-minute attendance-cron piggyback, "Today" KPI tile lag stays within 15 min of the most recent Odoo POS sale during 7am–11pm IST. The "Sync now" button forces a 0-min refresh on demand.
9. **Item-level granularity.** `pos_lines_mirror` row count for a given day is ≥ POS order count for that day (a correctness floor — every paid order has at least one line). Phase 2 BoM detection uses this without further schema changes.
10. **Money in paise.** No float comparisons in `sales.js` or the cron worker money math. Grep confirms.

---

## 14. Resolved deployment wiring (from `~/Documents/Tech/HN-Hotels-Asset-Database.xlsx`)

Everything below is already provisioned. This spec assumes these as the wiring inputs — no owner action required at design time.

| Item | Resolved value | Source |
|---|---|---|
| CF account_id | `3d506f78b08b3d95c667b82ef6ee7ab8` | asset row 156 |
| `hn-hotels-site` Pages project | live at `hnhotels.in` | asset rows 217–222 |
| D1 binding `DB` (this Pages + spend-sync-cron + attendance-cron) | `hn-hiring` (`a0107321-790a-4d46-ac3c-a54a676c6bcb`) | asset rows 137/138, `wrangler.toml` lines 18–21 |
| D1 binding `DB_NCH` (on spend-sync-cron only) | `nch-settlements` (`3388724b-41b2-4925-a7df-12f068c19e6e`) | asset rows 84/85, `workers/spend-sync-cron/wrangler.toml` lines 24–27 |
| `ODOO_API_KEY` on `hn-hotels-site` | already set; admin UID 2 → `ops.hamzahotel.com` | asset row 144 |
| `ODOO_KEY_OPS_HAMZA` on `hn-spend-sync-cron` | already set; admin UID 2 → `ops.hamzahotel.com` | asset note in `workers/spend-sync-cron/wrangler.toml:31` |
| Razorpay live keys | `RAZORPAY_KEY` + `RAZORPAY_SECRET` already on NCH Pages project (`nawabichaihouse.com`) | asset rows 73/74 |
| Razorpay webhook secret on `hn-razorpay-webhook` | already set as `RAZORPAY_WEBHOOK_SECRET` | `workers/razorpay-webhook/wrangler.toml` |
| NCH POS config 29 (NCH-Delivery counter) | confirmed | asset row 67 |
| NCH POS PMs IDs 50/51 (COD/UPI) | confirmed | asset rows 69/70 |
| NCH Odoo Razorpay config name | `nch_razorpay` | asset row 71 |
| Existing crons (cap = 5/account) | `gmail-poller */1`, `attendance-cron */15`, `hr-digest`, `bank-feed-email` (event), `personal-bank-feed-email` (event), plus others | grep of `workers/*/wrangler.toml` |
| Cron cap headroom | **zero** — `spend-sync-cron` already documents this and ping-piggybacks | `workers/spend-sync-cron/wrangler.toml:7-13` |

**Two secrets to add** (one wrangler command each — values already exist on NCH Pages):
```
wrangler pages secret put RAZORPAY_KEY    --project-name hn-hotels-site
wrangler pages secret put RAZORPAY_SECRET --project-name hn-hotels-site
wrangler secret put RAZORPAY_KEY    --config workers/spend-sync-cron/wrangler.toml
wrangler secret put RAZORPAY_SECRET --config workers/spend-sync-cron/wrangler.toml
```

**Six Razorpay QR codes** (1 counter + 5 runners) are seeded by the owner via the dashboard `Add QR` button (Section 7.1 §5) at first run. They live in `razorpay_qr_registry` (D1, editable) — not in env, by design — so runner attrition / re-assignment is one click. The asset DB intentionally does not list them; the registry is the single editable source.

---

## 15. Sequencing

Three sub-phases, draft PR per sub-phase, no bundling:

**Sub-phase A — data layer.** schema-sales-recon.sql + functions/api/sales.js (read-only actions) + ops/sales/index.html (read-only render of `sales_recon_daily`). Demonstrates the dashboard against an empty dataset.

**Sub-phase B — sync layer.** workers/nch-sales-sync-cron + scripts/sales-backfill/run-nch.js + razorpay webhook patch. After this lands, `/ops/sales/` is fully populated for Apr 1 → today.

**Sub-phase C — admin layer.** Razorpay QR registry CRUD UI + recompute-day + sync-status detail panel. After this lands, owner self-serves QR re-assignment without redeploys.

After sub-phase C ships and acceptance §13 passes for one full day, the next branch begins HE sales reconciliation (sibling spec). Phase 2 PO/expense duplicate detection (`docs/OPS-DUP-SPEC.md` — already written) consumes `pos_lines_mirror` once `nch_bom` is seeded.

The `/ops/cash/` dashboard is unaffected by any of this — sales recon is a read-only mirror; cash writes still flow through `/api/cash`.
