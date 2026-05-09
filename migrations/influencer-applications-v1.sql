-- Creator Partner Portal — self-serve application schema.
-- Powers hamzaexpress.in/creators/apply.
-- See docs/CREATOR-PORTAL-ARCHITECTURE.md for full design.

CREATE TABLE IF NOT EXISTS influencer_applications (
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

  -- Other platforms (optional, signal of cross-platform reach)
  youtube_handle TEXT,
  tiktok_handle TEXT,
  other_platforms_text TEXT,

  -- Application content
  why_us_text TEXT,
  contact_phone TEXT NOT NULL,
  contact_email TEXT,

  -- Computed offer (snapshot at submit time; owner can override)
  computed_tier TEXT NOT NULL,                          -- T0..T7
  offer_covers INTEGER,
  offer_cash_paise INTEGER,
  offer_addons_json TEXT,                               -- JSON array of strings
  asks_json TEXT,                                       -- JSON array of strings

  -- Slot preference
  preferred_slot_id INTEGER,
  preferred_slot_date TEXT,
  preferred_window_code TEXT,

  -- Workflow
  status TEXT NOT NULL DEFAULT 'pending'                -- pending | auto_approved | approved | declined | adjusted
    CHECK(status IN ('pending','auto_approved','approved','declined','adjusted')),
  auto_approved INTEGER DEFAULT 0,
  decline_reason TEXT,
  adjusted_tier TEXT,                                   -- if owner overrides
  adjusted_offer_json TEXT,                             -- if owner customizes
  reviewed_by TEXT,
  reviewed_at TEXT,
  notes_owner TEXT,

  -- Linkage to existing booking system
  outreach_token TEXT,                                  -- generated on approval, ties to influencer_bookings.outreach_token
  booking_id INTEGER,                                   -- after approval creates a booking

  -- Source tracking (organic vs referred from outreach)
  application_source TEXT NOT NULL DEFAULT 'self_serve' -- self_serve | from_outreach | manual
    CHECK(application_source IN ('self_serve','from_outreach','manual')),
  referrer_url TEXT,                                    -- if creator landed via specific URL

  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_app_status ON influencer_applications(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_username ON influencer_applications(username);
CREATE INDEX IF NOT EXISTS idx_app_tier ON influencer_applications(computed_tier, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_source ON influencer_applications(application_source, submitted_at DESC);
