-- NCH Intelligence Seed — Exact data from proven daily-settlement.js
-- Source: nawabi-chai-house-sit/functions/api/daily-settlement.js (1791 lines)
-- Run: wrangler d1 execute hn-hiring --remote --file seed-rm-intelligence-nch.sql

-- ============================================================
-- RECIPES: POS Product → Raw Material (qty per 1 unit sold)
-- From daily-settlement.js lines 23-105
-- ============================================================

-- Irani Chai (POS ID 1028, ₹20) — 80ml: 60ml boiled milk + 20ml decoction
INSERT OR IGNORE INTO rm_recipes (pos_product_id, pos_product_name, brand, material_code, qty_per_unit, unit, notes) VALUES
(1028, 'Irani Chai', 'NCH', 'HN-RM-200', 0.05742, 'L', 'Buffalo Milk from boiled milk portion'),
(1028, 'Irani Chai', 'NCH', 'HN-RM-201', 0.001435, 'kg', 'SMP from boiled milk'),
(1028, 'Irani Chai', 'NCH', 'HN-RM-209', 0.001148, 'kg', 'Condensed Milk from boiled milk'),
(1028, 'Irani Chai', 'NCH', 'HN-RM-202', 0.000112, 'kg', 'Tea Powder from decoction'),
(1028, 'Irani Chai', 'NCH', 'HN-RM-029', 0.000225, 'kg', 'Sugar from decoction'),
(1028, 'Irani Chai', 'NCH', 'HN-RM-203', 0.01966, 'L', 'Filter Water from decoction');

-- Nawabi Special Coffee (POS ID 1102, ₹30) — 2x chai boiled milk + coffee + honey
INSERT OR IGNORE INTO rm_recipes (pos_product_id, pos_product_name, brand, material_code, qty_per_unit, unit, notes) VALUES
(1102, 'Nawabi Special Coffee', 'NCH', 'HN-RM-200', 0.11484, 'L', 'Buffalo Milk 2x chai'),
(1102, 'Nawabi Special Coffee', 'NCH', 'HN-RM-201', 0.002871, 'kg', 'SMP scaled with milk'),
(1102, 'Nawabi Special Coffee', 'NCH', 'HN-RM-209', 0.002297, 'kg', 'Condensed Milk scaled'),
(1102, 'Nawabi Special Coffee', 'NCH', 'HN-RM-214', 0.002, 'kg', 'Coffee Powder 2g per cup'),
(1102, 'Nawabi Special Coffee', 'NCH', 'HN-RM-215', 0.005, 'kg', 'Honey 5g per cup');

-- Lemon Tea (POS ID 1103, ₹20) — 80ml decoction + half lemon
INSERT OR IGNORE INTO rm_recipes (pos_product_id, pos_product_name, brand, material_code, qty_per_unit, unit, notes) VALUES
(1103, 'Lemon Tea', 'NCH', 'HN-RM-202', 0.000449, 'kg', 'Tea Powder'),
(1103, 'Lemon Tea', 'NCH', 'HN-RM-029', 0.000899, 'kg', 'Sugar'),
(1103, 'Lemon Tea', 'NCH', 'HN-RM-203', 0.07865, 'L', 'Filter Water'),
(1103, 'Lemon Tea', 'NCH', 'HN-RM-065', 0.5, 'units', 'Half lemon per cup');

-- Bun Maska (POS ID 1029, ₹40)
INSERT OR IGNORE INTO rm_recipes (pos_product_id, pos_product_name, brand, material_code, qty_per_unit, unit, notes) VALUES
(1029, 'Bun Maska', 'NCH', 'HN-RM-204', 1, 'units', 'Bun'),
(1029, 'Bun Maska', 'NCH', 'HN-RM-213', 0.05, 'kg', 'Butter 50g'),
(1029, 'Bun Maska', 'NCH', 'HN-RM-029', 0.004, 'kg', 'Powdered sugar 4g');

-- Malai Bun (POS ID 1118, ₹30) — malai is byproduct, only bun costed
INSERT OR IGNORE INTO rm_recipes (pos_product_id, pos_product_name, brand, material_code, qty_per_unit, unit, notes) VALUES
(1118, 'Malai Bun', 'NCH', 'HN-RM-204', 1, 'units', 'Bun only - malai is byproduct');

-- Chicken Cutlet (POS ID 1031, ₹25)
INSERT OR IGNORE INTO rm_recipes (pos_product_id, pos_product_name, brand, material_code, qty_per_unit, unit, notes) VALUES
(1031, 'Chicken Cutlet', 'NCH', 'HN-RM-206', 1, 'units', 'Cutlet unfried'),
(1031, 'Chicken Cutlet', 'NCH', 'HN-RM-211', 0.03, 'L', 'Oil 30ml deep fry');

-- Pyaaz Samosa (POS ID 1115, ₹15)
INSERT OR IGNORE INTO rm_recipes (pos_product_id, pos_product_name, brand, material_code, qty_per_unit, unit, notes) VALUES
(1115, 'Pyaaz Samosa', 'NCH', 'HN-RM-210', 1, 'units', 'Samosa raw'),
(1115, 'Pyaaz Samosa', 'NCH', 'HN-RM-211', 0.02, 'L', 'Oil 20ml deep fry');

-- Cheese Balls (POS ID 1117, ₹50)
INSERT OR IGNORE INTO rm_recipes (pos_product_id, pos_product_name, brand, material_code, qty_per_unit, unit, notes) VALUES
(1117, 'Cheese Balls', 'NCH', 'HN-RM-212', 1, 'units', 'Cheese balls raw'),
(1117, 'Cheese Balls', 'NCH', 'HN-RM-211', 0.015, 'L', 'Oil 15ml deep fry');

-- Osmania Biscuit Single (POS ID 1030, ₹8)
INSERT OR IGNORE INTO rm_recipes (pos_product_id, pos_product_name, brand, material_code, qty_per_unit, unit, notes) VALUES
(1030, 'Osmania Biscuit', 'NCH', 'HN-RM-205', 1, 'units', '1 loose biscuit');

-- Osmania Pack of 3 (POS ID 1033, ₹20)
INSERT OR IGNORE INTO rm_recipes (pos_product_id, pos_product_name, brand, material_code, qty_per_unit, unit, notes) VALUES
(1033, 'Osmania Pack of 3', 'NCH', 'HN-RM-205', 3, 'units', '3 loose biscuits');

-- Niloufer Osmania Box 500g (POS ID 1111, ₹250)
INSERT OR IGNORE INTO rm_recipes (pos_product_id, pos_product_name, brand, material_code, qty_per_unit, unit, notes) VALUES
(1111, 'Niloufer Osmania 500g', 'NCH', 'HN-RM-208', 1, 'units', '1 box');

-- Water (POS ID 1094, ₹10)
INSERT OR IGNORE INTO rm_recipes (pos_product_id, pos_product_name, brand, material_code, qty_per_unit, unit, notes) VALUES
(1094, 'Water', 'NCH', 'HN-RM-207', 1, 'units', '1 bottle');


-- ============================================================
-- DECOMPOSITION RATIOS
-- From daily-settlement.js lines 135-154
-- ============================================================

-- Boiled Milk: 10L buffalo milk + 0.25kg SMP + 0.2kg milkmaid → ~10.45L
-- Per litre of boiled milk mixture:
INSERT OR IGNORE INTO rm_decomposition_ratios (ratio_name, brand, material_code, factor) VALUES
('boiled_milk', 'NCH', 'HN-RM-200', 0.957),      -- Buffalo Milk (L)
('boiled_milk', 'NCH', 'HN-RM-201', 0.02392),     -- SMP (kg)
('boiled_milk', 'NCH', 'HN-RM-209', 0.01914);     -- Condensed Milk (kg)

-- Tea Decoction: 70L water + 0.4kg tea + 0.8kg sugar → ~71.2L
-- Per litre of decoction:
INSERT OR IGNORE INTO rm_decomposition_ratios (ratio_name, brand, material_code, factor) VALUES
('tea_decoction', 'NCH', 'HN-RM-202', 0.005618),  -- Tea Powder (kg)
('tea_decoction', 'NCH', 'HN-RM-029', 0.01124),   -- Sugar (kg)
('tea_decoction', 'NCH', 'HN-RM-203', 0.9831);    -- Filter Water (L)

-- Tea-Sugar Box: 1 box = 0.4kg tea + 0.8kg sugar
INSERT OR IGNORE INTO rm_decomposition_ratios (ratio_name, brand, material_code, factor) VALUES
('tea_sugar_box', 'NCH', 'HN-RM-202', 0.4),       -- Tea Powder (kg)
('tea_sugar_box', 'NCH', 'HN-RM-029', 0.8);       -- Sugar (kg)

-- Fried item oil per unit (used in decompose for fried state items)
INSERT OR IGNORE INTO rm_decomposition_ratios (ratio_name, brand, material_code, factor) VALUES
('fried_cutlet_oil', 'NCH', 'HN-RM-211', 0.03),   -- 30ml oil per cutlet
('fried_samosa_oil', 'NCH', 'HN-RM-211', 0.02),   -- 20ml oil per samosa
('fried_cheese_ball_oil', 'NCH', 'HN-RM-211', 0.015); -- 15ml per cheese ball

-- Bun Maska prepared: per prepared bun = 1 bun + 50g butter + 4g sugar
INSERT OR IGNORE INTO rm_decomposition_ratios (ratio_name, brand, material_code, factor) VALUES
('bun_maska', 'NCH', 'HN-RM-204', 1),             -- Bun (units)
('bun_maska', 'NCH', 'HN-RM-213', 0.05),          -- Butter (kg)
('bun_maska', 'NCH', 'HN-RM-029', 0.004);         -- Sugar (kg)

-- Osmania per packet: 24 biscuits per packet
INSERT OR IGNORE INTO rm_decomposition_ratios (ratio_name, brand, material_code, factor) VALUES
('osmania_packet', 'NCH', 'HN-RM-205', 24);       -- Osmania loose per packet


-- ============================================================
-- DENSITY CONSTANTS (kg per litre)
-- From daily-settlement.js lines 158-164
-- ============================================================

INSERT OR IGNORE INTO rm_density_constants (material_type, brand, density) VALUES
('boiled_milk', 'NCH', 1.035),
('tea_decoction', 'NCH', 1.03),
('oil', 'NCH', 0.92),
('raw_milk', 'NCH', 1.032),
('dry_goods', 'NCH', 1.0);    -- kg/kg, no conversion needed


-- ============================================================
-- VESSELS (physical containers with tare weights)
-- From daily-settlement.js lines 225-232
-- ============================================================

INSERT OR IGNORE INTO rm_vessels (vessel_code, brand, vessel_name, liquid_type, location, tare_weight_kg) VALUES
('KIT-PATILA-1', 'NCH', 'Kitchen Large Patila', 'boiled_milk', 'kitchen', 12.9),
('KIT-MILK-2', 'NCH', 'Kitchen Milk Vessel 2', 'boiled_milk', 'kitchen', 3.498),
('CTR-MILK-1', 'NCH', 'Counter Milk Vessel (Copper Samawar)', 'boiled_milk', 'counter', 3.15),
('CTR-DEC-1', 'NCH', 'Counter Decoction Vessel (Copper)', 'tea_decoction', 'counter', 5.05),
('KIT-DEC-1', 'NCH', 'Kitchen Decoction Prep Vessel', 'tea_decoction', 'kitchen', 6.0),
('KIT-DRY-1', 'NCH', 'Sugar/Tea Powder Container', 'dry_goods', 'kitchen', 1.7);


-- ============================================================
-- ZONES (gap adjustment thresholds)
-- From daily-settlement.js lines 203-205
-- ============================================================

INSERT OR IGNORE INTO rm_zones (zone_name, brand, gap_threshold_seconds) VALUES
('freezer', 'NCH', 600),           -- 10 min (slow items)
('kitchen', 'NCH', 600),           -- 10 min (slow items)
('display_counter', 'NCH', 300),   -- 5 min (fast items)
('tea_counter', 'NCH', 300);       -- 5 min (fast items)


-- ============================================================
-- FIELD → ZONE MAPPINGS
-- From daily-settlement.js lines 206-221
-- ============================================================

-- Freezer zone
INSERT OR IGNORE INTO rm_field_zones (field_name, brand, zone_name) VALUES
('raw_buffalo_milk', 'NCH', 'freezer'),
('raw_cutlets', 'NCH', 'freezer'),
('raw_samosa', 'NCH', 'freezer'),
('raw_cheese_balls', 'NCH', 'freezer'),
('butter', 'NCH', 'freezer');

-- Kitchen zone
INSERT OR IGNORE INTO rm_field_zones (field_name, brand, zone_name) VALUES
('raw_sugar', 'NCH', 'kitchen'),
('raw_milkmaid', 'NCH', 'kitchen'),
('raw_smp', 'NCH', 'kitchen'),
('raw_tea_powder', 'NCH', 'kitchen'),
('tea_sugar_boxes', 'NCH', 'kitchen'),
('coffee_powder', 'NCH', 'kitchen'),
('honey', 'NCH', 'kitchen'),
('lemons', 'NCH', 'kitchen'),
('oil', 'NCH', 'kitchen'),
('plain_buns', 'NCH', 'kitchen'),
('water_bottles_kitchen', 'NCH', 'kitchen'),
('niloufer_kitchen', 'NCH', 'kitchen'),
('osmania_packets_kitchen', 'NCH', 'kitchen'),
('fried_cutlets_kitchen', 'NCH', 'kitchen'),
('fried_samosa_kitchen', 'NCH', 'kitchen'),
('fried_cheese_balls_kitchen', 'NCH', 'kitchen'),
('malai', 'NCH', 'kitchen'),
('boiled_milk_kitchen', 'NCH', 'kitchen'),
('tea_decoction_kitchen', 'NCH', 'kitchen');

-- Display counter zone
INSERT OR IGNORE INTO rm_field_zones (field_name, brand, zone_name) VALUES
('water_bottles_display', 'NCH', 'display_counter'),
('niloufer_display', 'NCH', 'display_counter'),
('osmania_packets_display', 'NCH', 'display_counter'),
('osmania_loose_display', 'NCH', 'display_counter'),
('fried_cutlets_display', 'NCH', 'display_counter'),
('fried_samosa_display', 'NCH', 'display_counter'),
('fried_cheese_balls_display', 'NCH', 'display_counter'),
('prepared_bun_maska', 'NCH', 'display_counter');

-- Tea counter zone
INSERT OR IGNORE INTO rm_field_zones (field_name, brand, zone_name) VALUES
('boiled_milk_counter', 'NCH', 'tea_counter'),
('tea_decoction_counter', 'NCH', 'tea_counter');


-- ============================================================
-- FIELD → PRODUCT MAPPINGS (for gap adjustment)
-- From daily-settlement.js lines 171-201
-- When a field has a counting gap, which POS products' gap sales subtract from closing?
-- ============================================================

INSERT OR IGNORE INTO rm_field_products (field_name, brand, pos_product_id) VALUES
-- Bun fields → Bun Maska (1029) + Malai Bun (1118)
('prepared_bun_maska', 'NCH', 1029),
('prepared_bun_maska', 'NCH', 1118),
('plain_buns', 'NCH', 1029),
('plain_buns', 'NCH', 1118),

-- Cutlet fields → Chicken Cutlet (1031)
('fried_cutlets_kitchen', 'NCH', 1031),
('fried_cutlets_display', 'NCH', 1031),
('raw_cutlets', 'NCH', 1031),

-- Samosa fields → Pyaaz Samosa (1115)
('fried_samosa_kitchen', 'NCH', 1115),
('fried_samosa_display', 'NCH', 1115),
('raw_samosa', 'NCH', 1115),

-- Cheese balls fields → Cheese Balls (1117)
('fried_cheese_balls_kitchen', 'NCH', 1117),
('fried_cheese_balls_display', 'NCH', 1117),
('raw_cheese_balls', 'NCH', 1117),

-- Boiled milk vessels → Irani Chai (1028) + Coffee (1102)
('boiled_milk_kitchen', 'NCH', 1028),
('boiled_milk_kitchen', 'NCH', 1102),
('boiled_milk_counter', 'NCH', 1028),
('boiled_milk_counter', 'NCH', 1102),

-- Tea decoction vessels → Irani Chai (1028) + Lemon Tea (1103)
('tea_decoction_kitchen', 'NCH', 1028),
('tea_decoction_kitchen', 'NCH', 1103),
('tea_decoction_counter', 'NCH', 1028),
('tea_decoction_counter', 'NCH', 1103),

-- Osmania fields → Osmania Single (1030) + Pack of 3 (1033)
('osmania_packets_kitchen', 'NCH', 1030),
('osmania_packets_kitchen', 'NCH', 1033),
('osmania_packets_display', 'NCH', 1030),
('osmania_packets_display', 'NCH', 1033),
('osmania_loose_display', 'NCH', 1030),
('osmania_loose_display', 'NCH', 1033),

-- Water fields → Water (1094)
('water_bottles_kitchen', 'NCH', 1094),
('water_bottles_display', 'NCH', 1094),

-- Niloufer fields → Niloufer Box (1111)
('niloufer_kitchen', 'NCH', 1111),
('niloufer_display', 'NCH', 1111);

-- Note: sugar_container and tea_powder_container intentionally have NO product mappings
-- (slow-moving items, gap adjustment is irrelevant)


-- ============================================================
-- WASTAGE RULES (item + state → raw material decomposition)
-- From daily-settlement.js lines 238-300
-- ============================================================

-- Buffalo Milk wastage
INSERT OR IGNORE INTO rm_wastage_rules (wastage_item, brand, wastage_state, material_code, factor, label, uom) VALUES
('buffalo_milk', 'NCH', 'raw', 'HN-RM-200', 1, 'Raw', 'L'),
('buffalo_milk', 'NCH', 'boiled', 'HN-RM-200', 0.957, 'Boiled', 'L'),
('buffalo_milk', 'NCH', 'boiled', 'HN-RM-201', 0.02392, 'Boiled', 'L'),
('buffalo_milk', 'NCH', 'boiled', 'HN-RM-209', 0.01914, 'Boiled', 'L');

-- Cutlet wastage
INSERT OR IGNORE INTO rm_wastage_rules (wastage_item, brand, wastage_state, material_code, factor, label, uom) VALUES
('cutlet', 'NCH', 'frozen', 'HN-RM-206', 1, 'Frozen/Raw', 'units'),
('cutlet', 'NCH', 'fried', 'HN-RM-206', 1, 'Fried', 'units'),
('cutlet', 'NCH', 'fried', 'HN-RM-211', 0.03, 'Fried', 'units');

-- Samosa wastage
INSERT OR IGNORE INTO rm_wastage_rules (wastage_item, brand, wastage_state, material_code, factor, label, uom) VALUES
('samosa', 'NCH', 'frozen', 'HN-RM-210', 1, 'Frozen/Raw', 'units'),
('samosa', 'NCH', 'fried', 'HN-RM-210', 1, 'Fried', 'units'),
('samosa', 'NCH', 'fried', 'HN-RM-211', 0.02, 'Fried', 'units');

-- Cheese Balls wastage
INSERT OR IGNORE INTO rm_wastage_rules (wastage_item, brand, wastage_state, material_code, factor, label, uom) VALUES
('cheese_balls', 'NCH', 'frozen', 'HN-RM-212', 1, 'Frozen/Raw', 'units'),
('cheese_balls', 'NCH', 'fried', 'HN-RM-212', 1, 'Fried', 'units'),
('cheese_balls', 'NCH', 'fried', 'HN-RM-211', 0.015, 'Fried', 'units');

-- Buns wastage
INSERT OR IGNORE INTO rm_wastage_rules (wastage_item, brand, wastage_state, material_code, factor, label, uom) VALUES
('buns', 'NCH', 'plain', 'HN-RM-204', 1, 'Plain', 'units'),
('buns', 'NCH', 'bun_maska', 'HN-RM-204', 1, 'Bun Maska (prepared)', 'units'),
('buns', 'NCH', 'bun_maska', 'HN-RM-213', 0.05, 'Bun Maska (prepared)', 'units'),
('buns', 'NCH', 'bun_maska', 'HN-RM-029', 0.004, 'Bun Maska (prepared)', 'units');

-- Tea Decoction wastage
INSERT OR IGNORE INTO rm_wastage_rules (wastage_item, brand, wastage_state, material_code, factor, label, uom) VALUES
('tea_decoction', 'NCH', 'liquid', 'HN-RM-202', 0.005618, 'Liquid', 'L'),
('tea_decoction', 'NCH', 'liquid', 'HN-RM-029', 0.01124, 'Liquid', 'L'),
('tea_decoction', 'NCH', 'liquid', 'HN-RM-203', 0.9831, 'Liquid', 'L');

-- Direct 1:1 wastage items
INSERT OR IGNORE INTO rm_wastage_rules (wastage_item, brand, wastage_state, material_code, factor, label, uom) VALUES
('sugar', 'NCH', 'raw', 'HN-RM-029', 1, 'Raw', 'kg'),
('tea_powder', 'NCH', 'raw', 'HN-RM-202', 1, 'Raw', 'kg'),
('oil', 'NCH', 'waste', 'HN-RM-211', 1, 'Used/Waste', 'L'),
('condensed_milk', 'NCH', 'raw', 'HN-RM-209', 1, 'Raw', 'kg'),
('smp', 'NCH', 'raw', 'HN-RM-201', 1, 'Raw', 'kg');
