# Creator Partner Portal — Architecture

The self-serve portal at **hamzaexpress.in/creators** where any food/lifestyle creator
applies, gets auto-tiered, sees a personalised offer, and books a slot. Sits at the
end of the influencer pipeline as **Layer 4 — Self-Serve Application** (after Layer 1
Discovery, Layer 2 Scoring, Layer 3 Outreach).

## Why this layer exists

Layer 3 (outreach) reaches creators we discovered. But:

- Creators see Hamza Express organically (walking past, IG geotag, word-of-mouth)
- No reason to make them wait for our outreach turn
- Self-serve scales without owner bandwidth — creator does the work, we approve

Industry pattern: Olive Group, Truffles, Foodhall all run "creator partner programs"
with self-apply forms. We mirror the format with a heritage twist.

## Tier matrix — verified Q1 2026 Indian food creator economy

Sources synthesised from public Indian creator marketplace rate cards (Plixxo, Qoruz,
Influencer.in), F&B agency reports, and known practice in the BLR food creator scene.
Numbers are per-reel cash equivalents in INR; barter conversion ratios apply.

| Tier | Followers | Per-reel cash (mkt) | Cover count | Cash add | Add-ons | Ask | Auto-approve |
|---|---|---|---|---|---|---|---|
| **T0 Newbie** | <1K or private | ₹0 | — | — | — | — | ❌ Decline |
| **T1 Nano** | 1K–5K | ₹500–1,500 | 1 | ₹0 | — | 1 reel + 3 stories | ✅ |
| **T2 Micro** | 5K–15K | ₹1,500–4,000 | 2 | ₹0 | + Welcome chai | 1 reel + 5 stories + tag | ✅ |
| **T3 Mid-Micro** | 15K–30K | ₹4,000–12,000 | 3 | ₹0 | + Chai + Dessert | 1 reel + 5 stories + tag + 24h bio link | ✅ |
| **T4 Upper-Micro** | 30K–60K | ₹12,000–25,000 | 4 | ₹0 | + Dessert flight + chef interaction | 1 reel + 1 grid post + 5 stories | ✅ if ER ≥ 1.5% |
| **T5 Macro-Micro** | 60K–100K | ₹25,000–50,000 | 4 | ₹500 | + Mutton brain dry comp + dessert flight + chai | 1 reel + 1 grid post + 7 stories + 7d bio link | ⚠️ Manual |
| **T6 Edge-Macro** | 100K–250K | ₹50,000–100,000 | 4 | ₹3,000 | + Chef tasting (8 dishes) + family photo + chef interaction | 2 reels + 1 grid post + collab post + IG live snippet | ⚠️ Manual |
| **T7 Macro** | 250K+ | ₹100,000+ | 6 | ₹8,000 | + Full chef tasting + brand brief + behind-the-scenes | 2 reels + 1 grid + collab + IG live + 14d bio link | ⚠️ Manual (custom proposal possible) |

### Engagement-rate gates (universal)

- **ER < 0.5%**: auto-decline regardless of follower count (likely bought followers)
- **T4+ requires ER ≥ 1.5%** for auto-approval — else queued for manual review
- ER computed from last 12 posts: `(avg_likes + avg_comments) / followers`

### Why these specific numbers

Restaurant marketing math (HE specifically):
- AOV ₹464, food margin ~50% → 4 covers = ₹928 actual cost
- Single reel with 10K-20K views typically yields 50-150 outlet visits
- Conversion of 30-100 visits × ₹464 AOV = ₹14K-46K incremental revenue
- ROI breakeven at ~3 visits per reel — anything above that = profit

Cash bumps only at T4+ because:
- Below 60K followers, barter alone is acceptable to 70%+ of creators (industry data)
- 60K+ creators have professional rate cards, expect cash
- Above 100K, cash is non-negotiable; barter is bonus

## UX flow (Typeform-style, 1-question-per-screen, mobile-first)

```
LANDING (hamzaexpress.in/creators)
  Hero            "Hamza Express Creator Partner Program"
                  Heritage frame: "4 generations · Est. 1918"
  Pillars         "Free meal" · "Pick your slot" · "Own your content"
  Trust           Past creator visits, recent stories
  CTA             "Apply now"

APPLY (hamzaexpress.in/creators/apply)

Step 1: IG handle
  "What's your Instagram handle?"
  [@yourhandle]
  → Submits to /api/creator-application?action=lookup
  → Backend checks influencer_bio_pulse cache (instant) OR
    falls back to IG public endpoint (~500ms) OR
    queues Apify enrichment (slow, returns "we'll review")

Step 2: Tier reveal (loading → tier card)
  IF cached or IG-public-fetched:
    "✓ Found you @username
     [followers count] followers · [ER]% engagement
     You qualify as our [Tier name]"
    [Continue]

  IF Apify queued (rare fallback):
    "We're verifying your profile (~30 sec)..."
    [poll status every 5s for up to 60s]
    On timeout: "We'll review your profile and email back within 24h"

Step 3: Personalized offer
  Card showing:
  "Here's what we're offering you:
   ✓ [N] covers (you + [N-1] guests)
   ✓ [Add-ons]
   ✓ ₹[budget] meal value
   ✓ ₹[cash] cash payment           ← only T5+
   
   In return:
   ✓ [Ask line 1]
   ✓ [Ask line 2]
   ✓ [Ask line 3]
   
   Post within 7 days · Tag @hamzaexpressblr · Use the geotag pin"
  [Looks good]    [Not interested]

Step 4: Other platforms (optional, drives cross-platform reach signal)
  "Have a YouTube / TikTok / other platforms? (optional)"
  YouTube: [@channel]
  TikTok:  [@handle]
  Other:   [free text]
  [Continue]    [Skip]

Step 5: Why us? (optional, helps owner personalize hosting)
  "Why Hamza Express? (optional, 1-2 sentences)"
  [textarea, 280 char limit]
  [Continue]    [Skip]

Step 6: Pick a slot
  Calendar grid — 5 slots/day for May 10-31
  Each slot: glyph icon · date · window · "1 spot · exclusive" or "Booked"
  [Tap to select]

Step 7: Phone + email
  "Where should we WhatsApp your confirmation?"
  Phone: [+91 ...]
  Email: [optional]
  [Continue]

Step 8: Review + submit
  Summary card showing:
  - @handle, tier, followers
  - Slot: date · window
  - Offer summary
  - Contact info
  [Confirm application]   [Edit]

Step 9: Confirmation
  IF auto-approved (T1-T4 with ER pass):
    "✓ You're booked for [Date, Window]
     We'll WhatsApp you the day before with last-mile details.
     #19 H.K.P. Road, Shivajinagar, Bangalore 560051
     [Map]"

  IF manual review (T5+ or low ER):
    "✓ Application received.
     We review T5+ applications within 24h to ensure the offer is right.
     We'll WhatsApp once approved.
     [Optional: tell us anything you'd like to feature]"

  IF declined (T0 / ER < 0.5%):
    "Thanks for applying. We work with creators who actively engage their
     BLR-based food community. We can't fit your profile right now —
     but check back after building your audience or improving engagement!"
```

## Visual / branding rules

- Color palette: matches existing booking page (bg #0a0f1a, tan #D2B48C, sienna #713520, gold #fbbf24)
- Typography: Plus Jakarta Sans (body) · Cinzel (1918 brand mark) · JetBrains Mono (numbers)
- Layout: 1 question per viewport, large tap targets (≥44px), no horizontal scroll
- Transitions: 200ms slide between steps
- Loading state for Step 2: skeleton card with shimmer (not spinner — feels faster)
- Trust strip at top of every step: "EST. 1918 · Dakhni · Shivajinagar · 5 slots/day"
- Progress indicator: "Step N of 8" small, subtle, top-right

## Schema additions

```sql
CREATE TABLE influencer_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,                              -- IG handle (lowercased, no @)

  -- IG profile snapshot at application time
  full_name TEXT,
  followers_count INTEGER,
  engagement_rate REAL,
  is_verified INTEGER DEFAULT 0,
  is_business_account INTEGER DEFAULT 0,
  category_name TEXT,
  profile_pic_url TEXT,

  -- Other platforms
  youtube_handle TEXT,
  tiktok_handle TEXT,
  other_platforms_text TEXT,

  -- Application content
  why_us_text TEXT,
  contact_phone TEXT NOT NULL,
  contact_email TEXT,

  -- Computed offer (snapshot — owner can override later)
  computed_tier TEXT NOT NULL,                          -- T0..T7
  offer_covers INTEGER,
  offer_cash_paise INTEGER,
  offer_addons_json TEXT,                               -- JSON array
  asks_json TEXT,                                       -- JSON array

  -- Slot preference
  preferred_slot_id INTEGER,
  preferred_slot_date TEXT,
  preferred_window_code TEXT,

  -- Workflow
  status TEXT NOT NULL DEFAULT 'pending',               -- pending | auto_approved | approved | declined | adjusted
  auto_approved INTEGER DEFAULT 0,
  decline_reason TEXT,
  adjusted_tier TEXT,                                   -- if owner overrides
  adjusted_offer_json TEXT,                             -- if owner customizes
  reviewed_by TEXT,
  reviewed_at TEXT,
  notes_owner TEXT,

  -- Linkage
  outreach_token TEXT,                                  -- generated on approval
  booking_id INTEGER,                                   -- after approval creates a booking

  -- Timestamps
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_app_status ON influencer_applications(status, submitted_at DESC);
CREATE INDEX idx_app_username ON influencer_applications(username);
CREATE INDEX idx_app_tier ON influencer_applications(computed_tier, submitted_at DESC);
```

## API endpoints

All under `https://hamzaexpress.in/api/creator-application` (HE repo, D1 bound to hn-hiring as HIRING_DB).

```
POST ?action=lookup
  body: { handle: "@username" or "username" }
  → 1. Strip @, lowercase
  → 2. Check influencer_bio_pulse — if cached + recent (<30d), return tier+offer instantly
  → 3. Else, IG public endpoint fetch — return tier+offer (cached for next time)
  → 4. Else, queue Apify enrichment, return { status: 'queued', poll_after: 5s }
  Response: { found, tier, followers_count, engagement_rate, offer, auto_approve_eligible }

POST ?action=submit
  body: full application form
  → Recompute tier server-side (don't trust client)
  → Insert into influencer_applications
  → If auto-approve eligible: create booking shell, reserve slot, mark auto_approved
  → Else: leave pending, queue for owner review
  → Send WhatsApp confirmation (auto-approve) or "we'll review" (pending)
  Response: { application_id, status, booking_id?, confirmation_message }

GET ?action=status&handle=username
  → Check application status (for users to come back later)
  Response: { status, slot_date, slot_window, message }

OWNER (DASHBOARD_KEY):
GET ?action=list-pending             → All status='pending' apps
GET ?action=list-recent&limit=50     → Recent apps regardless of status
POST ?action=approve  body={id}       → Approve, create booking, send WhatsApp
POST ?action=adjust   body={id, new_tier, new_offer}  → Customize and re-offer
POST ?action=decline  body={id, reason}  → Decline with reason
```

## Approval workflow

```
Submitted application (any tier)
  ↓
Auto-approve check:
  - tier in [T1, T2, T3, T4]
  - AND if T4: ER >= 1.5%
  - AND followers ≥ 1000 (T1+)
  - AND last_post_at within 60d
  ↓
  YES → status='auto_approved'
        Create influencer_bookings row, slot reserved
        WhatsApp: "Your slot is confirmed for [date]"
  ↓
  NO  → status='pending'
        Surface in /ops/influencer-applications/
        Owner sees: profile + offer + slot
        Actions: Approve | Adjust | Decline
        ↓
        Approve:  → confirmed booking, WhatsApp
        Adjust:   → re-offer with new terms (creator can accept/reject)
        Decline:  → polite WhatsApp, no booking
```

## Owner approval surface

Surface at `hnhotels.in/ops/influencer-applications/` (DASHBOARD_KEY gated).

```
┌──────────────────────────────────────────────────┐
│  Pending review (3)                               │
│                                                    │
│  ┌─────────────────────────────────────────────┐ │
│  │ @example_handle · 75K · 2.3% ER · T5         │ │
│  │ Slot: May 18 · 8-9:30 PM                      │ │
│  │ Offer: 4 covers + ₹500                        │ │
│  │ Why us: "Love the heritage angle..."          │ │
│  │                                                │ │
│  │ [✓ Approve]  [↓ Adjust]  [✗ Decline]          │ │
│  └─────────────────────────────────────────────┘ │
│                                                    │
│  Recent (auto-approved last 24h)                  │
│  @user1 · T2 · approved · slot reserved          │
│  @user2 · T3 · approved · slot reserved          │
│                                                    │
│  Stats this month                                 │
│  Submitted: 47 · Auto-approved: 32 · Pending: 8   │
│  Approved: 12 · Declined: 3 · Adjusted: 4         │
└──────────────────────────────────────────────────┘
```

## Cross-system flow

```
Layer 1 (Discovery — already running)        ┌─→ influencer_bio_pulse
   Apify multi-vector cron                    │     (the inventory we maintain)
   ─────────────────────────────────         │
                                              │
Layer 2 (Scoring — already running)          │
   _lib/influencer-tier.js scoreRelevance()  ↓
   ─────────────────────────────────       (read by all 3 portals)
                                              ↓
Layer 3 (Outreach — already running)         ↓
   cron-outreach-wave at 10 IST              ↓
   sends to 50 unique creators/day            ↓
   creates outreach_token-stamped URL    ←───┘
   creators land at hamzaexpress.in/booking?token=
                                              ↓
Layer 4 (Self-serve, NEW)                   ┌─┴─→  hamzaexpress.in/creators/apply
   creators apply organically                  →   /api/creator-application?action=lookup
   tier computed instantly from bio_pulse      →   /api/creator-application?action=submit
   auto-approve T1-T4, manual review T5+       →   creates application + booking on approve
                                              ─┬─→
                                                ↓
                          shared booking system  →   /marketing/Influencer/booking/?token=
                                                ↓
                                         /ops/influencer-bookings/
                                         /ops/influencer-applications/
```

Both Layer 3 and Layer 4 funnel into the same `influencer_bookings` table with a
distinguishing `application_source` field ('outreach' | 'self_serve').

## Cost & cadence

```
Per-application cost:
  - Lookup hit (cached):           $0
  - Lookup miss (IG public):       $0
  - Lookup fallback (Apify):       $0.005 (rare)

Auto-approve volume estimate:
  - 10-30 applications/week organic (after initial buzz)
  - 70% are T1-T4 → auto-approve
  - 5-10 manual reviews/week for owner

Slot capacity:
  - 5 slots/day × 30 days = 150 slots/month max
  - Layer 3 outreach takes 50/day = 1500/month  ← EXCEEDS slot capacity
  - But ~5% conversion on outreach = 75/month booked
  - Plus self-serve: ~10-30/week = 40-120/month
  - Combined: ~115-200 actual bookings/month
  - Well within 150 slot cap

Cap action: when slots fill for a date, the slot picker grays it out.
```

## Phasing

**Phase 1 (this build, MVP):**
- Schema + API + landing + apply flow + confirmation + owner approval surface
- Auto-tier from cached bio_pulse OR IG public endpoint
- Simple slot picker (reuses existing 5/day system)
- Plain WhatsApp confirmation (uses existing comms-core sendWaba)

**Phase 2 (later):**
- Apify async fallback when not in cache (queue + email back)
- Status check page at `/creators/status?handle=X`
- Past creator testimonials carousel
- Spanish/Kannada translations
- Negotiation flow (creator counter-proposes adjusted offer)

## Files

**HE repo (`hamza-express-site/`):**
- `creators/index.html` — landing
- `creators/apply/index.html` — Typeform-style flow
- `creators/confirmation/index.html` — post-submit (auto-approve / pending / declined)

**HN repo (`HN-Hotels-Site/`):**
- `migrations/influencer-applications-v1.sql` — schema
- `functions/api/creator-application.js` — API (lookup, submit, owner endpoints)
- Updated `functions/api/_lib/influencer-tier.js` — T0-T7 matrix
- `ops/influencer-applications/index.html` — owner approval surface

The HE repo has `HIRING_DB` binding to `hn-hiring`, so the API can live in HE alongside
the public pages — no cross-domain CORS needed.
