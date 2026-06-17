# Naam — marketing decision surface

> **Naam** — how the world comes to know I exist.
> A mobile-first PWA for iPhone 17 Pro that gives glance-and-act visibility over
> every marketing lane for **Hamza Express (HE)** and **Nawabi Chai House (NCH)**.

Deployed at **naam.hnhotels.in**. Built to the **Sauda** (purchase-console) UX bar:
single self-contained `index.html`, zero build dependency, iOS large-titles, PIN
gate, brand-scoped, PWA-installable, service-worker for instant/offline open.

## The point

It kills the heavy ritual. Today, to act on Meta/Google you make Claude pull
exhaustive context first — and because that's heavy, small marketing moves get
delayed. Naam puts the **trigger data** in front of you: each lane's glance
metric + the *one pending next-action*. You see *what needs you* at a glance,
then make the first decision from the phone.

**Phone-safe execution only.** Naam may write a local, phone-only decision queue
so the owner can approve, hold, or mark a move checked. It does **not** launch,
pause, or edit campaigns; those spend-changing steps still happen in the
controlled execution lane. Naam never writes a campaign, template, price,
creative, or Codex's marketing memory.

## Structure

```
naam/
  index.html              single-file app (shell, 4 tabs, all logic + styles)
  manifest.json           PWA manifest (name "Naam")
  sw.js                   service worker (shell cache-first, data network-first)
  icons/                  192 + 512 maskable icons
  data/
    naam-data.json        lane spine: per-brand glance metrics + next-actions
    creative-manifest.json projected from HN_Creative_Asset_Library registry
  creative/thumb/         lazy WebP thumbnails (one per creative, content-hashed,
                          relative ./creative/thumb/ — works at /naam/ and the subdomain root)
```

### Four tabs
- **Naam** — the action home: today's move, live pulse, live stages,
  "Needs you", and the lane ledger.
- **Creative** — manifest-driven library, brand/lane/status filters, lazy thumbs.
- **Queue** — local phone-safe decisions waiting for controlled execution.
- **You** — default brand, data freshness, per-lane health, PWA install.

Brand **HE / NCH** is a persistent switch; lanes with no NCH surface simply
don't appear under NCH (clean separation, no faked data).

## Data spine (committed, refreshed on laptop)

Naam reads two committed JSON files so it loads instantly and works offline —
the same model as `data/snapshots/` + `scripts/snapshot-context.js`.

| File | Built by | What |
|---|---|---|
| `data/naam-data.json` | `node scripts/naam-snapshot.js` | lane status, glance metrics, next-actions, freshness |
| `data/creative-manifest.json` + thumbs | `python3 scripts/build-creative-manifest.py` | every creative for both brands, projected from the canonical registry |

`naam-snapshot.js` reads the Codex marketing single-source-of-truth
(`~/.local/share/hn-marketing-memory/state/marketing-memory.json`, **read-only**)
for each lane's status/next-action, recomputes freshness, and refreshes live
glance metrics from the open-CORS cockpit APIs (+ aggregator with
`DASHBOARD_API_KEY`). Sources are isolated — an unreachable one keeps the prior
value and logs a warning. It honestly stamps `generated_at`; the app flags
staleness.

Live elements fetched directly (no snapshot): the **counter-UPI today** total
(`counter-recent?qr=…`, open CORS).

## Boundary (single-writer-safe)

- Reads Codex memory; **never writes** `~/.local/share/hn-marketing-memory/**`
  or `ops/marketing-control/**`.
- Surfaces the live cockpits (aggregator, ctwa, google, gbp, leads, gmb,
  counter); never originates aggregator polls (appliance model on hn-winpc).
- Stays on `claude/*` branches; Codex owns `codex/*`.

## Future-proof

The UI hardcodes nothing — it iterates `naam-data.json.lanes` and
`creative-manifest.json.lanes`/counts. A new lane, brand, or batch of creatives
appears after one laptop refresh with zero UI edits.

## Refresh (owner, on laptop)

```bash
node scripts/naam-snapshot.js              # refresh lane metrics + next-actions
python3 scripts/build-creative-manifest.py # refresh creative library + thumbs
# commit naam/data/*.json + naam/public/creative/thumb/* → live on deploy
```

## PIN

Soft lock (open cockpit data is already public-CORS). Default `1918` (Hamza
heritage year); change `const PIN` at the top of `index.html`'s script.
