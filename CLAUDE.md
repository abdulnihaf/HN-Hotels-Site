# HN Hotels — Repo Context for Claude

This file auto-loads in every Claude Code session opened in this repo. It exists
because the owner (Nihaf) does marketing-strategy thinking on iPhone Claude Code,
and the iPhone sandbox cannot reach our private domains. Live business data must
travel into the conversation via files committed here.

## Identity

- **Legal entity:** HN Hotels Private Limited
- **CIN:** U55101KA2023PTC182051
- **PAN:** AAHCH1024M · **TAN:** BLRH15862A · **UDYAM:** UDYAM-KR-03-0606827
- **Incorporated:** 11 Dec 2023
- **Registered office:** #22, 3rd Floor, H.K.P. Road, Shivajinagar, Bangalore 560051
- **Brands:** Hamza Express (HE — QSR biryani/kabab) · Nawabi Chai House (NCH — Irani chai cafe)

## Outlets

- **Hamza Express** — #19, H.K.P. Road, Shivajinagar, Bangalore 560051. QSR. ~176-SKU menu.
- **Nawabi Chai House** — same locality, Shivajinagar. Cafe format, concentrated menu.
- **Hours:** ~7am–11pm IST, both outlets.
- **Neighborhood:** Bangalore Muslim quarter. Dakhni-food belt. Walking distance to MG Rd, Commercial St, Brigade Rd, Shivajinagar bus stand. Foot-traffic from office crowd by day, night-eaters/students after 9pm.

## Heritage positioning

Hamza family in Bangalore food trade since **1918** — four generations. Dakhni cuisine legacy. Public-facing references: [nawabichaihouse.com](https://nawabichaihouse.com), JustDial. Use this in any brand/marketing/PR copy — heritage is the moat against the Andhra-biryani belt next door.

## Menu fingerprint (verified Feb–Mar 2026, [investor.html](investor.html))

**Hamza Express — 176 SKUs.** Heroes (top 5 by revenue):
1. Ghee Rice — 9.7%
2. Chicken Kabab — 8.6%
3. Tandoori Chicken — 5.3%
4. Mutton Biryani — 5.1%
5. Chicken Biryani — 5.1%
Plus Mutton Brain Dry, Hamza Special, Mughlai Chicken, breads, drinks.
Avg ticket ~₹464.

**Nawabi Chai House — concentrated.** Two items = 77% of revenue:
- Irani Chai — **58.7%** (53,169 cups in 57 days)
- Haleem (all sizes) — **18%**
Bun Maska, Osmania biscuit packs, Nawabi Coffee, Malai Bun, chicken cutlet round it out.
Avg ticket ~₹349.

## Competitor set (Shivajinagar)

- **Empire** — chain, mass-market biryani. Not Dakhni.
- **Valima Ki Biryani** — local QSR.
- **Andhra-style biryani belt** — multiple outlets within 500m.
- HE differentiates on Dakhni/Hyderabad style + 1918 heritage. NCH owns the Irani-chai-and-snacks evening crowd; no real direct competitor in 1km radius.

## Channel economics summary (verified Apr 2026)

- **Dine-in:** 0% commission. Best margin.
- **WABA Direct (Wati):** ~2.36% gateway only.
- **Zomato Dining (HE):** ~8.26% effective.
- **Swiggy Delivery:** ~24.60% effective.
- **Zomato Delivery (<4km):** ~23.41% effective.
- **EazyDiner:** ₹30/cover + 5% + 1.8% gateway.

Detailed per-clause contract math lives in `docs/CONTRACT_REGISTRY.md` and the runtime [sales-finance.html](sales-finance.html).

## Aggregator contracts (signed)

- **Zomato Delivery** (HE + NCH): 02 Mar 2026
- **Swiggy** (HE + NCH): 02 Mar 2026
- **EazyDiner** (HE only): 28 Mar 2026
- **Zomato Dining** (HE): valid till 2046

## Truth-source URL register

Read these for live state. **Most are unreachable from iPhone sandbox** — see "Sandbox reachability" below.

| URL | What it holds | How to read |
|---|---|---|
| `hnhotels.in/ops/aggregator/` | Live Swiggy + Zomato orders, ratings, finance | API `/api/aggregator-pulse?action=orders\|finance\|health\|snapshots\|reviews` (key: `DASHBOARD_API_KEY`) |
| `hamzaexpress.in/ops/google-cockpit/` | Google Ads campaign state (HE) | API `/api/google-cockpit?period=today\|7d\|30d\|all` (open CORS, Worker has Google secrets) |
| `hamzaexpress.in/ops/ctwa-cockpit/` | Meta CTWA campaigns + funnel (HE) | API `/api/ctwa-analytics?period=7d\|30d\|all` (open CORS, Worker has Meta secrets) |
| `hamzaexpress.in/ops/leads/` | WABA leads CRM (HE) | API `/api/leads?action=counts\|history\|segments` (open CORS, D1-backed) |
| `app.hnhotels.in` | Operational app shell | Various; PIN-gated |
| `odoo.hnhotels.in` | Unified finance Odoo (expenses, POs, vendor bills, payroll) | JSON-RPC at `/jsonrpc`, db `main`, uid 2, env `ODOO_API_KEY`. Companies: 1=HQ, 2=HE, 3=NCH |
| `test.hamzahotel.com` | **HE Production** Odoo (POS source of truth for HE) | JSON-RPC same shape. Confusingly named "test" — it is HE prod |
| `ops.hamzahotel.com` | **NCH Production** Odoo (POS source of truth for NCH) | JSON-RPC same shape. NCH company_id = 10 |

POS sales data only lives on `test.hamzahotel.com` (HE) and `ops.hamzahotel.com` (NCH). Finance/expense/PO data lives on `odoo.hnhotels.in`. Don't mix them up.

## Standing marketing direction (verbatim from owner)

> **De-prioritize WABA as order destination — market unfamiliar.**
> Push: **Meta Ads, Influencer Marketing, Google Ads, Swiggy/Zomato organic + inorganic.**

WABA stays for retention/CRM, not for first-order acquisition.

## Current targets

- **May 2026** — HE: ₹15,00,000 · NCH: ₹12,00,000

For context, Mar 2026 actuals were HE ₹6,59,903 and NCH ₹10,80,731. May targets are 2.3× HE / 1.1× NCH.

## Sandbox reachability map (iPhone Claude Code)

The iPhone Claude Code sandbox has an egress allowlist. **The following are blocked**, so do not waste turns trying to fetch them from iPhone:

- `hnhotels.in`, `app.hnhotels.in`
- `hamzaexpress.in`, `nawabichaihouse.com`
- `odoo.hnhotels.in`, `test.hamzahotel.com`, `ops.hamzahotel.com`
- `graph.facebook.com`, `googleads.googleapis.com`

To bring data into iPhone sessions, the laptop runs `node scripts/snapshot-context.js` and commits the JSON outputs to `data/snapshots/`. Read those files instead.

## Where to read fresh data inside this repo

- `data/snapshots/aggregator-latest.json` — Swiggy + Zomato orders/ratings/finance
- `data/snapshots/sales-daily-last60d.json` — POS daily totals per brand per channel
- `data/snapshots/google-ads-latest.json` — Google Ads cockpit dump
- `data/snapshots/meta-ctwa-latest.json` — Meta CTWA cockpit dump
- `data/snapshots/waba-leads-latest.json` — WABA leads counts + recent
- `data/snapshots/snapshot-meta.json` — when/where snapshots were captured

Snapshots are **manual-refresh**. Owner runs the script when needed. If a snapshot is stale (>3 days), say so explicitly in any analysis rather than treating it as live.

## Secret handling — non-negotiable

- **NEVER commit API keys, OAuth tokens, refresh tokens, webhook secrets, or xlsx contents.**
- Local tokens go in `.env.local` (gitignored — see `.gitignore`).
- Production tokens are Cloudflare Worker secrets (`wrangler secret put …`), not files.
- If you discover a secret accidentally committed: rotate first, then strip from history.
- Reference env-var **names** in scripts; never hardcode values.

## Repo execution rules (binding for all sessions)

See `docs/EXECUTION-CHARTER.md` for full charter. Key rules:

- **No build pipeline.** Vanilla HTML/JS/CSS served from Cloudflare Pages. No npm/Vite/Rollup/esbuild.
- **Money in paise (INTEGER).** Convert to rupees only at the display layer.
- **Read before edit.** Read the full file before changing it.
- **No production deploys from Claude.** Open draft PRs only; owner reviews + merges.
- **One branch + one draft PR per phase.** No bundling.
- **Mobile-first.** ≥44px tap targets. Test Safari iOS + Chrome Android.
