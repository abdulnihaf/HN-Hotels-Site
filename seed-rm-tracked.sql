-- HN Hotels — Tracked Items for Daily Inventory Settlement
-- Run: wrangler d1 execute hn-hiring --remote --file seed-rm-tracked.sql

-- ============================================================
-- HE TRACKED ITEMS — Tiered by spend and perishability
-- ============================================================

-- Tier 1: Daily count (high spend, perishable)
INSERT OR IGNORE INTO rm_tracked_items (product_code, brand, tier, count_method) VALUES
('HN-RM-072', 'HE', 1, 'direct'),  -- Chicken Whole — Skin Out (Rs 230/kg)
('HN-RM-073', 'HE', 1, 'direct'),  -- Chicken Tandoori Cut (Rs 230/kg)
('HN-RM-074', 'HE', 1, 'direct'),  -- Chicken Whole — With Skin (Rs 190/kg)
('HN-RM-075', 'HE', 1, 'direct'),  -- Chicken Boneless Breast (Rs 330/kg)
('HN-RM-076', 'HE', 1, 'direct'),  -- Chicken Thighs (Rs 230/kg)
('HN-RM-077', 'HE', 1, 'direct'),  -- Mutton Biryani Cut (Rs 780/kg)
('HN-RM-078', 'HE', 1, 'direct'),  -- Mutton Chops (Rs 780/kg)
('HN-RM-079', 'HE', 1, 'direct'),  -- Mutton Gravy Cut (Rs 780/kg)
('HN-RM-030', 'HE', 1, 'direct'),  -- Jeera Samba Rice (Rs 205/kg)
('HN-RM-042', 'HE', 1, 'direct'),  -- Refined Oil (Rs 150/L)
('HN-RM-058', 'HE', 1, 'direct'),  -- Onion (Rs 22/kg)
('HN-RM-070', 'HE', 1, 'direct'),  -- Tomato (Rs 22/kg)
('HN-RM-092', 'HE', 1, 'direct'),  -- Curd (Rs 60/L)
('HN-RM-225', 'HE', 1, 'direct');  -- LPG Gas Cylinder (Rs 1770, BOTH brand)

-- Tier 2: Every 2-3 days (medium spend, semi-perishable)
INSERT OR IGNORE INTO rm_tracked_items (product_code, brand, tier, count_method) VALUES
('HN-RM-043', 'HE', 2, 'direct'),  -- Salato Oil (Rs 190/L)
('HN-RM-045', 'HE', 2, 'direct'),  -- Cow Ghee (Rs 660/kg)
('HN-RM-044', 'HE', 2, 'direct'),  -- Vanaspati Ghee (Rs 130/kg)
('HN-RM-094', 'HE', 2, 'direct'),  -- Eggs (Rs 5.5/pc)
('HN-RM-095', 'HE', 2, 'direct'),  -- Charcoal (Rs 32/kg)
('HN-RM-098', 'HE', 2, 'direct'),  -- Cooking Wood (Rs 8000/load)
('HN-RM-090', 'HE', 2, 'direct'),  -- Brain/Bheja (Rs 500/kg)
('HN-RM-093', 'HE', 2, 'direct'),  -- Milk Local (Rs 56/L)
('HN-RM-059', 'HE', 2, 'direct'),  -- Ginger (Rs 65/kg)
('HN-RM-096', 'HE', 2, 'direct'),  -- Garlic (Rs 130/kg)
('HN-RM-060', 'HE', 2, 'direct'),  -- Green Chillies (Rs 60/kg)
('HN-RM-061', 'HE', 2, 'direct'),  -- Capsicum (if exists)
('HN-RM-063', 'HE', 2, 'direct'),  -- Carrot
('HN-RM-064', 'HE', 2, 'direct'),  -- Cauliflower
('HN-RM-047', 'HE', 2, 'direct');  -- Amul Fresh Cream (Rs 225/L)

-- Tier 3: Weekly (low daily spend, shelf-stable)
INSERT OR IGNORE INTO rm_tracked_items (product_code, brand, tier, count_method) VALUES
('HN-RM-029', 'HE', 3, 'direct'),  -- Sugar (BOTH, Rs 44/kg)
('HN-RM-031', 'HE', 3, 'direct'),  -- Toor Dal
('HN-RM-032', 'HE', 3, 'direct'),  -- Wheat Flour (Atta)
('HN-RM-033', 'HE', 3, 'direct'),  -- Maida
('HN-RM-034', 'HE', 3, 'direct'),  -- Corn Starch
('HN-RM-041', 'HE', 3, 'direct'),  -- Mustard Oil
('HN-RM-048', 'HE', 3, 'direct'),  -- Amul Cheese
('HN-RM-017', 'HE', 3, 'direct'),  -- Red Chilli Powder
('HN-RM-020', 'HE', 3, 'direct'),  -- Turmeric Powder
('HN-RM-019', 'HE', 3, 'direct'),  -- Coriander Powder
('HN-RM-018', 'HE', 3, 'direct'),  -- Cumin Powder
('HN-RM-010', 'HE', 3, 'direct');  -- Cumin Seeds

-- ============================================================
-- NCH TRACKED ITEMS — All 18 raw materials, daily
-- ============================================================

INSERT OR IGNORE INTO rm_tracked_items (product_code, brand, tier, count_method) VALUES
('HN-RM-200', 'NCH', 1, 'vessel'),   -- Buffalo Milk (vessel weighing)
('HN-RM-201', 'NCH', 1, 'container'),-- SMP (container weighing)
('HN-RM-202', 'NCH', 1, 'container'),-- Tea Powder (container weighing)
('HN-RM-029', 'NCH', 1, 'container'),-- Sugar (BOTH brand, container weighing)
('HN-RM-203', 'NCH', 1, 'direct'),   -- Filter Water (can count)
('HN-RM-204', 'NCH', 1, 'direct'),   -- Buns (unit count)
('HN-RM-205', 'NCH', 1, 'direct'),   -- Osmania Biscuit Loose (unit count)
('HN-RM-206', 'NCH', 1, 'direct'),   -- Chicken Cutlet Unfried (unit count)
('HN-RM-207', 'NCH', 1, 'direct'),   -- Bottled Water (unit count)
('HN-RM-208', 'NCH', 1, 'direct'),   -- Osmania Biscuit Box (unit count)
('HN-RM-209', 'NCH', 1, 'container'),-- Condensed Milk (container weighing)
('HN-RM-210', 'NCH', 1, 'direct'),   -- Samosa Raw (unit count)
('HN-RM-211', 'NCH', 1, 'direct'),   -- Oil Frying (measured)
('HN-RM-212', 'NCH', 1, 'direct'),   -- Cheese Balls Raw (unit count)
('HN-RM-213', 'NCH', 1, 'direct'),   -- Butter (weighed)
('HN-RM-214', 'NCH', 1, 'container'),-- Coffee Powder (container weighing)
('HN-RM-215', 'NCH', 1, 'direct'),   -- Honey (weighed)
('HN-RM-065', 'NCH', 1, 'direct'),   -- Lemon (BOTH brand, unit count)
('HN-RM-216', 'NCH', 1, 'direct'),   -- Chicken Roll Raw (unit count)
('HN-RM-225', 'NCH', 1, 'direct');   -- LPG Gas Cylinder (BOTH brand)
