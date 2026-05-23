-- migrations/0010_chicken_intel_phase1.sql
-- HE Chicken Intelligence — Phase 1 foundation
-- 4 tables + V11 recipe seed (74 dishes across POS/Swiggy/Zomato)

CREATE TABLE IF NOT EXISTS chicken_daily_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_date TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT 'HE',
  cut TEXT NOT NULL,
  opening_kg REAL,
  purchased_kg REAL,
  purchased_units INTEGER,
  po_odoo_id INTEGER,
  price_per_kg_paise INTEGER,
  price_entered_by_pin TEXT,
  price_entered_at DATETIME,
  gst_treatment TEXT,
  bill_attachment_url TEXT,
  recipe_consumed_g INTEGER DEFAULT 0,
  unit_sales_count INTEGER DEFAULT 0,
  dishes_sold_json TEXT,
  closing_kg REAL,
  closing_units INTEGER,
  closing_photo_url TEXT,
  closed_by_pin TEXT,
  closed_at DATETIME,
  variance_pct REAL,
  discrepancy_units INTEGER,
  cost_paise INTEGER,
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME,
  UNIQUE(business_date, brand, cut)
);

CREATE INDEX IF NOT EXISTS idx_chicken_ledger_date ON chicken_daily_ledger(business_date, brand);
CREATE INDEX IF NOT EXISTS idx_chicken_ledger_cut ON chicken_daily_ledger(cut, brand);

CREATE TABLE IF NOT EXISTS chicken_recipe_grams (
  dish_name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'POS',
  cut TEXT NOT NULL,
  grams_per_unit INTEGER NOT NULL,
  active INTEGER DEFAULT 1,
  PRIMARY KEY (dish_name, channel)
);

CREATE TABLE IF NOT EXISTS vendor_gst_treatment (
  vendor_id INTEGER PRIMARY KEY,
  vendor_name TEXT NOT NULL,
  gst_inclusive INTEGER NOT NULL,
  gst_rate_pct REAL DEFAULT 0,
  confirmed_by_pin TEXT,
  confirmed_at DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chicken_event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_time DATETIME DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,
  actor_pin TEXT,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_chicken_event_time ON chicken_event_log(event_time);

-- ━━━ Recipe grams seed (V11 manual, extracted from ops/chicken-intel/index.html) ━━━

-- POS dishes (49 rows)
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Butter Chicken', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Hyderabadi Gravy', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Lemon Chicken', 'POS', 'boneless', 300);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken 65', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Kadai Chicken', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Reshmi Kabab', 'POS', 'boneless', 300);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('BOGO Chicken Kathi Roll (2 pcs)', 'POS', 'boneless', 200);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Punjabi Chicken', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Chatpata', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Malai Tikka', 'POS', 'boneless', 300);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Irani Chicken', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Hamza Special', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Kathi Roll', 'POS', 'boneless', 100);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Kabab', 'POS', 'kebab', 340);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Shawarma', 'POS', 'shawarma', 100);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Shawarma Roll', 'POS', 'shawarma', 100);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('BOGO Chicken Shawarma (2 pcs)', 'POS', 'shawarma', 200);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Tandoori Chicken', 'POS', 'tandoori', 450);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Biryani Rice', 'POS', 'tandoori', 0);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Biryani', 'POS', 'tandoori', 100);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Lollipop', 'POS', 'lollipop', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Fried Rice', 'POS', 'boneless', 50);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chilli Chicken', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Pepper Dry', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Cutlet', 'POS', 'boneless', 50);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Singapore Chicken', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Mix Fried Rice', 'POS', 'boneless', 50);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Tandoori Chicken Masala', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Ghee Rice + Dal Fry + 2pc Kabab → kebab', 'POS', 'kebab', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Grill Chicken', 'POS', 'grill', 450);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Noodles', 'POS', 'boneless', 50);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Haryali Tikka', 'POS', 'boneless', 300);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Kali Mirch', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Ghee Rice + Butter Chicken + 2pc Kabab → boneless', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Ghee Rice + Butter Chicken + 2pc Kabab → kebab', 'POS', 'kebab', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Dopiyaza', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Tikka Masala', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Andhra Tikka', 'POS', 'boneless', 300);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Boneless Biryani', 'POS', 'boneless', 100);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Kalmi Kabab', 'POS', 'tangdi', 350);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Roll', 'POS', 'boneless', 100);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Mughlai Chicken', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Kolhapuri Gravy', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Methi Chicken', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Tikka Roll', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Fried Chicken — 1 Pc', 'POS', 'boneless', 80);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('American Chops', 'POS', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Biryani + 2pc Kabab → kebab', 'POS', 'kebab', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Biryani + 2pc Kabab → tandoori', 'POS', 'tandoori', 100);

-- Swiggy dishes (11 rows)
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Hyderabadi Biryani', 'Swiggy', 'tandoori', 100);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Malai Tikka', 'Swiggy', 'boneless', 300);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Singapore Chicken', 'Swiggy', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Mix Fried Rice', 'Swiggy', 'boneless', 50);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Butter Chicken combo', 'Swiggy', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Kabab combo', 'Swiggy', 'kebab', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Grill Chicken Half', 'Swiggy', 'grill', 225);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Tikka Masala', 'Swiggy', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Boneless Biryani', 'Swiggy', 'boneless', 100);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Methi Chicken', 'Swiggy', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Lemon Chicken', 'Swiggy', 'boneless', 170);

-- Zomato dishes (14 rows)
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Biryani+Kabab → kebab', 'Zomato', 'kebab', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Biryani+Kabab → biryani', 'Zomato', 'tandoori', 100);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Butter Chicken', 'Zomato', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Kali Mirch', 'Zomato', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Irani Chicken', 'Zomato', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Fried Rice', 'Zomato', 'boneless', 50);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Tandoori Chicken', 'Zomato', 'tandoori', 450);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken 65', 'Zomato', 'boneless', 300);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Grill Chicken', 'Zomato', 'grill', 450);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Butter Chicken combo', 'Zomato', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Kabab combo', 'Zomato', 'kebab', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Chicken Kabab', 'Zomato', 'kebab', 340);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Mughlai Chicken', 'Zomato', 'boneless', 170);
INSERT OR IGNORE INTO chicken_recipe_grams (dish_name, channel, cut, grams_per_unit) VALUES ('Tikka', 'Zomato', 'boneless', 300);

-- ━━━ MN Broilers GST placeholder (Basheer confirms via UI) ━━━
-- Defaults to gst_inclusive=1 (most common for fresh chicken under HSN 0207 which is 0% anyway)
INSERT OR IGNORE INTO vendor_gst_treatment (vendor_id, vendor_name, gst_inclusive, gst_rate_pct) VALUES (33, 'M.N. Broilers (Syed Ahmedulla)', 1, 0);