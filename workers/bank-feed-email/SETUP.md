# Money Feed — Setup

End-to-end setup for the live money feed at `hnhotels.in/ops/bank/`.
Covers HDFC ingest, Razorpay webhook, and the 3-month XLS backfill.

```
     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
     │ HDFC Bank    │────►│ bank-feed-   │────►│              │
     │ email alerts │     │ email Worker │     │              │
     └──────────────┘     └──────────────┘     │              │
                                               │   D1         │     ┌──────────────┐
     ┌──────────────┐     ┌──────────────┐     │              │────►│ /ops/bank/   │
     │ Razorpay     │────►│ razorpay-    │────►│  money_      │     │ live view    │
     │ webhook      │     │ webhook      │     │  events      │     └──────────────┘
     └──────────────┘     └──────────────┘     │              │
                                               │              │
     ┌──────────────┐     ┌──────────────┐     │              │
     │ XLS statement│────►│ backfill     │────►│              │
     │ (audit)      │     │ Python       │     │              │
     └──────────────┘     └──────────────┘     └──────────────┘
```

All free-tier. No new crons. Event-driven where the source supports it;
idempotent backfill where it doesn't.

---

## 1. D1 schema

```bash
cd HN-Hotels-Site
wrangler d1 execute hn-hiring --remote --file=schema-money-events.sql
```

Verify:
```bash
wrangler d1 execute hn-hiring --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'money_%'"
```
Expect: `money_events`, `money_source_health`, `money_recon_matches`, `money_monthly_statement`.

## 2. 3-month XLS backfill (do this first — instant dashboard)

Download your latest HDFC statement as `.xls` (NetBanking → Accounts → Account Statement → Excel). Then:

```bash
pip3 install --user xlrd pandas
python3 scripts/bank-backfill/backfill-hdfc-xls.py \
  /path/to/Acct_Statement_XXXXXXXX4680_DDMMYYYY.xls \
  > data/bank/backfill-hdfc-4680.sql

wrangler d1 execute hn-hiring --remote --file=data/bank/backfill-hdfc-4680.sql
```

The script prints a summary to stderr: txn count, channel breakdown, top counterparties.

`INSERT OR IGNORE` keys off `(source, source_ref)` so re-running after a new
statement just adds the delta — never duplicates.

Now `/ops/bank/` has 3 months of data and the dashboard's not empty.

## 3. Deploy the Email Worker (live HDFC ingest)

```bash
cd workers/bank-feed-email
wrangler secret put DASHBOARD_KEY        # reuse the key used by other workers
wrangler deploy
```

Note the deployed URL (e.g. `https://hn-bank-feed-email.<account>.workers.dev`).

## 4. Enable per-transaction email alerts in HDFC

Log into `now.hdfc.bank.in` → top-right menu → **Insta Alerts** tab (or URL
`/retail-app/user-profile/insta-alerts`):

For A/c ****4680:
- **Debits and Credits** → toggle ON, delivery = **Both** (SMS + Email). This is the master toggle — catches every txn regardless of amount.
- **Salary Credit** → leave ON (harmless, useful signal).
- Ignore Low Balance / Periodic Balance (not needed for feed).
- Save.

Email alerts are free; confirmation text is visible on the same page.

First alert arrives within 5 minutes of the next transaction.

## 5. Gmail auto-forward (subdomain, not root zone)

**Architecture note:** `hnhotels.in` root MX belongs to Google Workspace
(for `@hnhotels.in` mailboxes). CF Email Routing cannot own the root zone
without breaking Workspace mail. So the alerts pipeline lives on the
dedicated subdomain `alerts.hnhotels.in`, which has its own CF MX records
(`route{1,2,3}.mx.cloudflare.net`) + SPF.

**5a. Confirm subdomain is set up**

Cloudflare Dashboard → `hnhotels.in` → Email → Email Routing →
**Settings** → Subdomains. `alerts.hnhotels.in` should be listed as
enabled. If not, add it; CF writes MX + SPF automatically.

**5b. Temporarily flip the route to Gmail (for verification)**

Routes tab → edit `hdfc-alerts@alerts.hnhotels.in`:
- Action: **Send to an email** → `nihafwork@gmail.com`
- Save.

**5c. Kick off Gmail verification**

Gmail (nihafwork@gmail.com) → Settings → Forwarding and POP/IMAP →
**Add a forwarding address** → `hdfc-alerts@alerts.hnhotels.in`.
Google sends a verification code to that address. CF delivers it to
Gmail. Click confirmation link.

**5d. Flip the route back to the Worker**

Routes tab → edit `hdfc-alerts@alerts.hnhotels.in`:
- Action: **Send to a Worker** → `hn-bank-feed-email`
- Save.

**5e. Create the Gmail filter**

Gmail search → show search options → From:
`alerts@hdfcbank.bank.in OR alerts@hdfcbank.net OR InstaAlert@hdfcbank.net OR instaalerts@hdfcbank.net`
→ **Create filter**:
- ✅ Forward it to: `hdfc-alerts@alerts.hnhotels.in`
- ✅ Never send it to Spam
- ✅ Mark as read
- ✅ Also apply to matching conversations

**5f. Delete any stray root-zone alert route**

If a rule exists for `hdfc-alerts@hnhotels.in` (no `alerts.` subdomain),
delete it. It triggers a "DNS records: Misconfigured" banner because
CF tries to own root MX that Workspace already holds, and the rule
never delivers mail.

## 6. Verify HDFC end-to-end

Send yourself a ₹1 UPI to A/c 4680. Within 60 seconds:

```bash
wrangler d1 execute hn-hiring --remote \
  --command="SELECT id, txn_at, direction, amount_paise, counterparty, channel, parse_status FROM money_events WHERE source='hdfc' ORDER BY id DESC LIMIT 5"
```

Row visible → pipeline is live. Open `/ops/bank/` — the ₹1 appears.

## 7. Razorpay webhook (real-time customer payments)

```bash
cd workers/razorpay-webhook
wrangler secret put RAZORPAY_WEBHOOK_SECRET   # copy from Razorpay after next step
wrangler secret put DASHBOARD_KEY
wrangler deploy
```

Note the URL. Then in Razorpay Dashboard → **Settings** → **Webhooks** → **Add Webhook**:
- URL: `https://hn-razorpay-webhook.<account>.workers.dev/`
- Secret: generate or copy from wrangler
- Events: `payment.captured`, `payment.failed`, `payout.processed`, `payout.reversed`, `settlement.processed`, `refund.processed`
- Alert email: nihafwork@gmail.com
- Save. Razorpay sends a test POST — check:

```bash
wrangler tail hn-razorpay-webhook
```
Should see `200 ok` within seconds.

## 8. Source health (fallback visibility)

`/ops/bank/` shows a row of source chips: hdfc · razorpay · paytm · etc.
Each chip is:
- **green** if the source has delivered an event within its expected gap
- **orange** (stale) if it's past the gap
- **red** (silent) if it's never delivered

This is the early-warning if Gmail filter, Razorpay creds, or Cloudflare routing silently breaks. Expected gaps are seeded in `schema-money-events.sql` and tunable.

## 9. Daily ops

**Check pipeline health** (public, requires PIN on UI or DASHBOARD_KEY for worker):
```
https://hn-bank-feed-email.<account>.workers.dev/?key=<DASHBOARD_KEY>
https://hn-razorpay-webhook.<account>.workers.dev/?key=<DASHBOARD_KEY>
```

**Reparse rows stuck in 'quarantined' or 'partial'** (after a regex fix):
```
https://hn-bank-feed-email.<account>.workers.dev/?key=<DASHBOARD_KEY>&mode=reparse
```

**Tail worker logs for debugging**:
```bash
wrangler tail hn-bank-feed-email
wrangler tail hn-razorpay-webhook
```

**Rerun backfill after next monthly statement** (additive — won't dupe):
```bash
python3 scripts/bank-backfill/backfill-hdfc-xls.py new.xls > data/bank/backfill-hdfc-4680.sql
wrangler d1 execute hn-hiring --remote --file=data/bank/backfill-hdfc-4680.sql
```

## Audit fixes applied (vs draft v1)

- **Auth**: every `/api/bank-feed` endpoint requires a PIN now (read = any PIN, reconcile = ops+, admin rollback = admin). CORS narrowed to `hnhotels.in` origins.
- **DKIM verification**: email worker rejects messages without `dkim=pass` for `hdfcbank.{net,com,in}`. Prevents anyone who knows the `hdfc-alerts@` address from forging transactions.
- **Idempotency**: `INSERT OR IGNORE` via unique indexes on `(source, source_ref)` and `(source, instrument, direction, amount_paise, txn_at)`. When parser can't find a date, row is stored `partial` with `txn_at=NULL` — never fabricated.
- **No phantom zero-rows**: insert failures now write `parse_status='quarantined'` with `amount_paise=0` to a separate bucket, filtered out of rollups. No silent ledger pollution.
- **Money as integer paise**: no float drift in SUM() or equality comparisons. Dashboard divides by 100 for display.
- **HMAC-SHA256 signature check** on Razorpay webhooks, constant-time compare.
- **Dashboard**: PIN gate, source/direction/status filters, stale banner, quarantined bucket, error-backoff on consecutive failures, whitelist-based CSS classes (no injection).

## Known next-steps (not blocking MVP)

1. Replace `extractTextBody` in email worker with `postal-mime` for robust base64/multi-level MIME. Quarantine path captures failures so we never lose data.
2. Nightly cross-source reconciliation auto-matcher.
3. Monthly e-Statement PDF parser writing to `money_monthly_statement`.
4. Paytm webhook worker (copy razorpay-webhook pattern).
5. Zomato / Swiggy payout email parsers.
