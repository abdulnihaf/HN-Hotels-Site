# SPINE — Operational Intelligence Endpoint

**Live URL:** `https://hnhotels.in/api/spine`
**Type:** Read-only HTTP/JSON. Cloudflare Pages Function (`functions/api/spine.js`).
**Purpose:** One authenticated surface that serves complete business context as JSON, so a
**cloud chat (claude.ai) can be the informational/analysis engine** while **Claude Code stays
the execution engine**. SPINE has **zero write power** — only GET, only SELECT / Odoo reads.

---

## Why it exists

The owner does strategy from a cloud chat that cannot reach our private domains, and keeps
Claude Code (laptop, 24/7) strictly for execution. SPINE lets the cloud chat answer questions
like *"what's the business from X to Y?"*, *"how much was UPI?"*, *"who was present on day D?"*
by querying live systems — without any execution happening in the cloud chat.

---

## Authentication

A **dedicated** token (deliberately **not** `DASHBOARD_KEY`, which is embedded in client JS and
therefore semi-public). The token's SHA-256 hash lives in D1 table `spine_keys`; the raw token is
held only by the owner. Present it any one of these ways:

```
Authorization: Bearer <SPINE_TOKEN>
x-spine-key: <SPINE_TOKEN>
?key=<SPINE_TOKEN>
```

`resource=health` is the only open resource (no business data). Everything else needs the token.

> Rotation / revocation: update the `spine_keys` row (`active=0` to revoke). A new token = insert a
> new SHA-256 hash. If `SPINE_API_KEY` is ever set as a Pages secret, it takes precedence.

---

## How to query

```
GET https://hnhotels.in/api/spine?resource=<name>&<params>
```

Start with the self-describing manifest — it lists every resource, its params, and example URLs:

```
GET /api/spine?resource=manifest
```

### Common params
| param | meaning | default |
|---|---|---|
| `from` | start date `YYYY-MM-DD` | 1st of current month (IST) |
| `to` | end date `YYYY-MM-DD` | today (IST) |
| `brand` | `HE` \| `NCH` \| `HQ` (aggregator uses lowercase `he`/`nch`) | varies |
| `date` | single date for attendance | today (IST) |

### Money convention
Fields ending `_paise` are integers. `_rupees` / `.rupees` are the display value (`paise / 100`).

---

## Resources

| resource | what it answers | key params |
|---|---|---|
| `health` | is it up? (open, no auth) | — |
| `manifest` | full machine-readable grammar | — |
| `catalog` | stable reference data (entities, brands, company-id maps, channel economics, taxonomy, targets, staff roles) | — |
| `revenue` | "business from X to Y" — gross, cash, UPI, card, orders, avg ticket | `from,to,brand` |
| `revenue.daily` | per-day sales rows | `from,to,brand` |
| `payments` | "how much was UPI vs cash vs card" | `from,to,brand` |
| `items` | top menu items by revenue | `from,to,brand,search,limit` |
| `attendance` | "who was present / absent on day D" | `date,brand` |
| `cash` | live cash balances per pile | — |
| `aggregator` | Swiggy + Zomato orders / revenue / payout | `from,to,brand,platform` |
| `expenses` | spend by category + payment method (+ Odoo PO / outstanding bills) | `from,to,brand` |
| `vendors` | active vendor directory | `brand` |
| `purchase_orders` | Odoo POs in range | `from,to,brand` |
| `bills` | Odoo vendor bills (`&outstanding=1` for unpaid) | `from,to,brand,outstanding` |
| `credentials` | credential **reference** layer (names + locations, never values) | — |

### Example questions → calls
- *HE business this month:* `?resource=revenue&brand=HE`
- *NCH UPI vs cash, last week:* `?resource=payments&brand=NCH&from=2026-06-08&to=2026-06-14`
- *Who was present at HE yesterday:* `?resource=attendance&brand=HE&date=2026-06-14`
- *Live cash on hand:* `?resource=cash`
- *Swiggy orders this month:* `?resource=aggregator&platform=swiggy`
- *Outstanding vendor bills:* `?resource=bills&outstanding=1`

---

## Data sources (all read-only)

| domain | source |
|---|---|
| revenue / payments / items | D1 `sales_recon_daily`, `pos_payments_mirror`, `pos_lines_mirror`, `razorpay_qr_collections` |
| attendance | D1 `hr_attendance_daily` ⋈ `hr_employees` (CAMS biometric) |
| cash | D1 `cash_events` (anchor + delta) |
| aggregator | D1 `aggregator_orders` (Swiggy + Zomato pull) |
| expenses | D1 `business_expenses` + Odoo `purchase.order` / `account.move` |
| vendors / POs / bills | D1 `vendors` + Odoo `odoo.hnhotels.in` |

Bindings/secrets used: `DB` (D1 `hn-hiring`), `ODOO_API_KEY` — both already provisioned. No new
Cloudflare secret was introduced, so the endpoint goes live through the normal Pages deploy.

---

## Architecture notes

- **Read-only by construction.** GET-only handler; only `SELECT` and Odoo read methods. Cannot
  move money or change state.
- **Self-contained.** Reuses verified SQL from the proven production handlers (`sales.js`,
  `cash.js`, `hr-admin.js`, `aggregator-pulse.js`, `owner-dashboard.js`) rather than re-deriving it.
- **Self-describing.** `?resource=manifest` is the contract the cloud chat reads to discover
  capabilities.
- **Credential safety.** SPINE never serves secret values — only a reference layer (name + where
  stored). When an action needs an actual key, the cloud chat asks Claude Code to fetch it.

### Security follow-ups surfaced during build (NOT done by this endpoint)
- `scripts/odoo-expense-skeleton.js` contains a **literal `ODOO_API_KEY`** — rotate on Odoo and
  strip from git history.
- `DASHBOARD_KEY` is embedded in `ops/aggregator/brand-dashboard.js` and the Chrome extension —
  treat it as public; never reuse it for new auth (this is why SPINE uses its own token).
