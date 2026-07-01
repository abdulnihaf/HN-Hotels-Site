# Sauda Price Scout MVP

Date: 2026-07-01

Scope: feasibility-to-MVP layer for weekly source catalogue discovery, daily pinned-SKU refresh, liveness, and owner-editable source mapping. This is not cart or checkout automation.

## Laws

- Money is stored as integer paise.
- No fake-live data.
- Stale prices cannot be crowned.
- Cart and checkout automation are outside this phase.
- Backend code must not contain item-specific business rules.
- Source priority, liveness thresholds, search phrases, pinned SKUs, rejected SKUs, and mapping decisions are D1 data/config.
- Portal capture belongs on RTX/hn-winpc logged-in browser sessions.

## Live D1 Grounding

Remote D1 checked: `hn-hiring` via binding `DB`, database id `a0107321-790a-4d46-ac3c-a54a676c6bcb`.

Requested tables all exist:

| Table | Rows | Latest observed row |
|---|---:|---|
| `sx_item` | 0 | none |
| `sx_price_snapshot` | 0 | none |
| `sx_price_batch` | 0 | none |
| `hyperpure_prices` | 40 | 2026-06-30T15:07:16.305Z |
| `item_prices` | 59 | 2026-06-30T15:14:26.695Z |
| `buy_lines` | 213 | 2026-06-20 13:56:57 |
| `daily_price_snapshots` | 17,881 | 2026-06-20T01:10:30.813Z |
| `daily_price_snapshot_batches` | 3,068 | 2026-06-20T01:10:31.061Z |

Interpretation:

- The new `sx_*` price-batch path is present but empty. It cannot yet provide live batch proof.
- `item_prices` and `hyperpure_prices` contain recent portal evidence from 2026-06-30.
- `daily_price_snapshots` and `daily_price_snapshot_batches` are old for daily liveness on 2026-07-01, so they must display as stale unless refreshed.
- `sx_item` is empty. Until canonical Sauda items are loaded, the MVP screen derives a temporary 20-30 item preview from real `buy_lines` spend and labels it as `buy_lines.spend_preview`.

## Feasibility Matrix

| Source | Feasibility | Cadence | Capture host | Primary use | Constraint |
|---|---|---|---|---|---|
| Hyperpure | High | Weekly discovery, daily pinned refresh | RTX/hn-winpc logged-in browser | B2B benchmark and planned buying | Search can return finished goods; owner mapping must pin exact/substitute SKUs. |
| Zepto | Medium-high | Weekly discovery, daily pinned refresh | RTX/hn-winpc logged-in browser | Emergency and quick-commerce benchmark | Location/session dependent; short liveness threshold. |
| Blinkit | Medium-high | Weekly discovery, daily pinned refresh | RTX/hn-winpc logged-in browser | Emergency and quick-commerce benchmark | Stock changes quickly; stale rows cannot crown. |
| Instamart | Medium | Weekly discovery, daily pinned refresh | RTX/hn-winpc logged-in browser | Quick-commerce fallback | Dynamic store availability; needs pinned SKU refresh. |
| Amazon | Medium | Weekly discovery, daily pinned refresh | RTX/hn-winpc logged-in browser | Marketplace/Fresh/Now discovery | Account, location, and surface vary; URL evidence is important. |
| Flipkart | Medium-low | Weekly discovery, daily pinned refresh | RTX/hn-winpc logged-in browser | Minutes/marketplace discovery | Patchy availability; should not become primary without proof. |

## D1 Schema Proposal

Migration: `migrations/0020_sauda_price_scout.sql`.

Additive columns:

- `sx_item.image_r2_key`, `sx_item.scout_active`, `sx_item.mvp_rank`
- `sx_price_batch.source_key`, `candidate_count`, `pinned_count`, `stale_count`, `host_key`, `evidence_json`, `notes`
- `sx_price_snapshot.candidate_id`, `evidence_json`, `live_state`, `match_decision`, `source_url`

New tables:

- `sx_source_profile`: editable source priority, liveness threshold, capture host, auth mode, and config.
- `sx_source_search_phrase`: owner-editable search phrases per canonical item and source.
- `sx_source_candidate`: discovery candidates carrying source, image, title, pack/unit, URL, captured timestamp, evidence, and LIVE/STALE/DEAD state.
- `sx_item_source_map`: owner decisions for Exact, Substitute, Emergency, and Reject, including pinned state.
- `sx_refresh_job`: queued weekly discovery, daily pinned refresh, and fallback search jobs.

The migration seeds only source profiles. It does not seed prices or candidates.

## API Shape

Pages Function: `functions/api/sauda-price.js`.

Read endpoints:

- `GET /api/sauda-price?action=dashboard&pin=0305&limit=30`
- `GET /api/sauda-price?action=feasibility`
- `GET /api/sauda-price?action=schema-proposal`
- `GET /api/sauda-price?action=price-find&pin=0305&item_code=...`
- `GET /api/sauda-price?action=stale-scout&pin=0305`
- `GET /api/sauda-price?action=drift-alert&pin=0305`
- `GET /api/sauda-price?action=audit&pin=0305`

Write endpoints:

- `POST /api/sauda-price?action=ingest-candidates`
- `POST /api/sauda-price?action=candidate-decision&pin=0305`
- `POST /api/sauda-price?action=source-profile&pin=0305`
- `POST /api/sauda-price?action=search-phrase&pin=0305`
- `POST /api/sauda-price?action=refresh-job&pin=0305`

Ingest payload shape:

```json
{
  "source_key": "HYPERPURE",
  "batch_kind": "DISCOVERY",
  "host_key": "hn-winpc",
  "items": [
    {
      "item_code": "maida",
      "candidates": [
        {
          "title": "Sunil Bakery - Special Maida",
          "image_url": "https://...",
          "pack_size": "30 kg",
          "unit_label": "kg",
          "price_paise": 78400,
          "unit_price_paise": 2600,
          "url": "https://...",
          "captured_at_ist": "2026-07-01T12:00:00+05:30",
          "evidence": { "screenshot_key": "...", "selector": "..." }
        }
      ]
    }
  ]
}
```

## UX Screen

Screen: `/ops/sauda/price-scout/`.

It shows:

- MVP item queue.
- Canonical image from `sx_item.image_r2_key` or `sx_item.image_url`.
- Current paid/local rate.
- Live crown source.
- Hyperpure and quick-commerce comparison.
- Source health and stale alerts.
- Candidate cards with source, image, title, pack/unit, URL, captured timestamp, evidence source, and liveness.
- Exact, Substitute, Emergency, and Reject buttons.

Crown rule:

- Candidate must be LIVE.
- Candidate must be owner mapped as Exact, Substitute, or Emergency.
- Candidate must be pinned.
- Candidate must have a positive price.

Legacy rows from `hyperpure_prices`, `item_prices`, and `daily_price_snapshots` are rendered as evidence. When the owner classifies one, the API promotes it into `sx_source_candidate` and writes `sx_item_source_map`.

## MVP Rollout

1. Apply the D1 migration or let the API self-provision the additive schema.
2. Load the first 20-30 canonical raw materials into `sx_item` with `scout_active=1`, `mvp_rank`, and `image_r2_key`.
3. On RTX/hn-winpc, run weekly discovery for each source and search phrase.
4. Ingest candidates through `ingest-candidates`.
5. Owner maps candidates on `/ops/sauda/price-scout/`.
6. Daily refresh only pinned candidates.
7. Hook `price-find`, `stale-scout`, and `drift-alert` into Sauda/Nazar after live `sx_price_batch` evidence exists.
