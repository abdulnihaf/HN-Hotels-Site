-- HN Hotels — Raw Materials Seed Data
-- Source: ops.hamzahotel.com extract (2026-04-09) + DayBook + Definitive List
-- Run: wrangler d1 execute DB --local --file seed-rm.sql

-- ============================================================
-- VENDORS (35 unique suppliers)
-- ============================================================
-- Odoo IDs from ops.hamzahotel.com. rename_from = name to update in Odoo.

INSERT OR IGNORE INTO rm_vendors (key, name, phone, odoo_id, company_id, rename_from, notes) VALUES
-- === NCH Primary Vendors (active POs) ===
('PRABHU_MILK',     'Prabhu Buffalo Milk Vendor', '9886806395', NULL, NULL, NULL, '74 POs. Primary milk vendor.'),
('JAY_JAY',         'Jay & Jay Dehydrofoods Pvt Ltd', '+919976688833', 97, NULL, 'Vetha Milk Powder Supplier', 'NEFT confirmed. Rename from Vetha.'),
('SHARIFF',         'Shariff Departmental Stores', '+918951484783', 98, NULL, 'Sharief Stores (Shivajinagar)', 'Rs 1.95L/yr. Spices, dry goods, oil, sauces, condensed milk.'),
('AFEEFA_IMPEX',    'Afeefa Impex Agencies', NULL, 99, NULL, 'Lakhimi Tea Industries', 'NEFT confirmed. Current tea vendor.'),
('FILTER_WATER',    'Filter Water Supplier (Rajesh)', '9538605311', 100, NULL, NULL, '64 POs. 20L cans.'),
('GANGA_BAKERY',    'Ganga Bakery', '7019547835', 102, NULL, NULL, '69 POs. Primary buns vendor.'),
('NILOUFER',        'Niloufer Bakery', NULL, 103, NULL, NULL, 'Niloufer branded products.'),
('NISARCHA',        'Nisarcha Brother (Hamza/Krispy Eats)', '8971457998', 104, NULL, NULL, '45 POs. Cutlet + Chicken Roll.'),
('NAZEER_NADEEM',   'Nazeer Nadeem', NULL, 105, NULL, 'Water Bottle Supplier', 'NEFT confirmed. 500ml bottles.'),
('SREE_MANJULA',    'Sree Manjula Enterprises', '9343587777', 112, NULL, 'Balu Krishna', 'NEFT confirmed. Osmania loose biscuit.'),
('BISLERI',         'Bisleri Water Supplier', '9900323484', 114, NULL, NULL, 'Backup water.'),
('SAMOSA_VENDOR',   'Sameer Hamza Samosa Vendor', '9746581122', 120, NULL, NULL, 'Samosa Raw.'),
('ABID',            'Abid Cheese Balls Vendor', '9742770048', NULL, NULL, NULL, 'Cheese Balls Raw. Also supplies samosa.'),
('BUTTER_ONLINE',   'Butter Online', NULL, NULL, NULL, NULL, '39 POs. Main NCH butter.'),
('AHMED_GAS',       'Ahmed - Gas Cylinder', '8553568718', NULL, NULL, NULL, '5 POs. LPG gas.'),
('GALAXY_BAKERY',   'Galaxy Bakery Products', NULL, NULL, NULL, NULL, 'Osmania Loose biscuit. 4 POs.'),
('R_PRASAD_DAIRY',  'R Prasad Dairy', '+919972608280', 96, NULL, NULL, '9 POs. Backup milk vendor.'),
('LIBERTY_TEA',     'Liberty Tea Powder', NULL, NULL, NULL, NULL, 'Tea vendor. 4 POs.'),
('LUQMAN_TEA',      'Tea Powder Luqman', '+919962122483', NULL, NULL, NULL, 'Tea vendor.'),
('SAVITA_BAKERY',   'Savita Bakery', NULL, NULL, NULL, NULL, 'Backup buns. 2 POs.'),
('NAVYA_MILK',      'Navya Milk Vendor', '9902476503', NULL, NULL, NULL, 'Buffalo milk. alt supplier.'),
('REHAN_OSMANIA',   'Rehan Osmania', '9482965179', NULL, NULL, NULL, 'Osmania biscuit.'),

-- === HE-specific Vendors (from product mappings + DayBook) ===
('MN_BROILERS',     'M.N. Broilers (Syed Ahmedulla)', NULL, NULL, NULL, NULL, 'Rs 3.84L/yr. All chicken. NEFT confirmed.'),
('HKGN_MUTTON',     'H.K.G.N Mutton Stall (Noor)', NULL, NULL, NULL, NULL, 'Rs 60K/yr. All mutton. NEFT confirmed.'),
('MANJU_VEG',       'Manju Veg Supplier', NULL, NULL, NULL, NULL, 'NCH veg vendor. Capsicum, carrot, cauliflower, cucumber, beans, mint, coriander, chillies.'),
('ANJU_VEG',        'Anju Express', NULL, NULL, NULL, NULL, 'HE veg vendor. From bill images.'),
('D_BABU_ONION',    'D Babu Onion Shop', NULL, NULL, NULL, NULL, 'Onion specific.'),
('ABU_TOMATO',      'Abu Tomato Shop', NULL, NULL, NULL, NULL, 'Tomato specific.'),
('TABREZ',          'Tabrez', NULL, NULL, NULL, NULL, 'Rumali Roti. Rs 6.8K/yr.'),
('MUDASSIR',        'Mudassir Pasha', NULL, NULL, NULL, NULL, 'Charcoal. Rs 25K/yr. NEFT confirmed.'),
('IMTAIZ',          'Imtaiz Bhai', NULL, NULL, NULL, NULL, 'Curd + Local Milk.'),
('SAJID',           'Sajid', NULL, NULL, NULL, NULL, 'Brain/Bheja. Rs 29K/yr.'),
('SRI_KRISHNA',     'Sri Krishna Enterprises', NULL, NULL, NULL, NULL, 'Cooking Wood. Rs 17K/yr. IMPS confirmed.'),
('HARI_PRASAD',     'Hari Prasad B', NULL, NULL, NULL, NULL, 'Coal Bhatti. Rs 19.5K/yr. NEFT confirmed.'),
('KARACHI_BAKERY',  'Karachi Bakery', NULL, NULL, NULL, NULL, 'Biscuits. Rs 2.5K/yr.');


-- ============================================================
-- PRODUCTS — HE Range (HN-RM-001 to 098)
-- ============================================================

INSERT OR IGNORE INTO rm_products (hn_code, old_code, name, category, uom, brand, avg_cost, odoo_id, action, notes) VALUES
-- Spices — Whole
('HN-RM-001', 'HE-RM-001', 'Green Cardamom (Elaichi)', 'Spices — Whole', 'kg', 'HE', 3200, 1260, 'KEEP', NULL),
('HN-RM-002', 'HE-RM-002', 'Black Cardamom (Badi Elaichi)', 'Spices — Whole', 'kg', 'HE', 2200, 1261, 'KEEP', NULL),
('HN-RM-003', 'HE-RM-003', 'Cinnamon Sticks (Dalchini)', 'Spices — Whole', 'kg', 'HE', 140, 1262, 'KEEP', NULL),
('HN-RM-004', 'HE-RM-004', 'Mace (Javitri)', 'Spices — Whole', 'kg', 'HE', 2800, 1263, 'KEEP', NULL),
('HN-RM-005', 'HE-RM-005', 'Nutmeg (Jaiphal)', 'Spices — Whole', 'kg', 'HE', 1000, 1264, 'KEEP', NULL),
('HN-RM-006', 'HE-RM-006', 'Star Anise', 'Spices — Whole', 'kg', 'HE', 800, 1265, 'KEEP', NULL),
('HN-RM-007', 'HE-RM-007', 'Bay Leaves (Tej Patta)', 'Spices — Whole', 'g', 'HE', 20, 1266, 'UPDATE', 'UoM in Odoo is g not kg'),
('HN-RM-008', 'HE-RM-008', 'Cloves (Laung)', 'Spices — Whole', 'kg', 'HE', 1200, 1267, 'KEEP', NULL),
('HN-RM-009', 'HE-RM-009', 'Fennel Seeds (Saunf)', 'Spices — Whole', 'kg', 'HE', 200, 1268, 'KEEP', NULL),
('HN-RM-010', 'HE-RM-010', 'Cumin Seeds (Jeera)', 'Spices — Whole', 'kg', 'HE', 400, 1269, 'KEEP', NULL),
('HN-RM-011', 'HE-RM-011', 'Whole Red Chilli (Dried)', 'Spices — Whole', 'kg', 'HE', 300, 1270, 'KEEP', NULL),
('HN-RM-012', 'HE-RM-012', 'Whole Black Pepper', 'Spices — Whole', 'kg', 'HE', 800, 1271, 'KEEP', NULL),
('HN-RM-013', 'HE-RM-013', 'Mustard Seeds (Rai)', 'Spices — Whole', 'kg', 'HE', 120, 1272, 'KEEP', NULL),
('HN-RM-014', 'HE-RM-014', 'Sesame Seeds (Til)', 'Spices — Whole', 'kg', 'HE', 300, 1273, 'KEEP', NULL),
('HN-RM-015', 'HE-RM-015', 'Kasuri Methi (Dried Fenugreek)', 'Spices — Whole', 'kg', 'HE', 320, 1274, 'KEEP', NULL),
('HN-RM-016', 'HE-RM-016', 'Curry Leaves (Kadi Patta)', 'Spices — Whole', 'bundle', 'HE', 10, 1275, 'UPDATE', 'UoM: bundle not kg'),
-- Spices — Ground
('HN-RM-017', 'HE-RM-017', 'Red Chilli Powder', 'Spices — Ground', 'kg', 'HE', 460, 1276, 'KEEP', NULL),
('HN-RM-018', 'HE-RM-018', 'Cumin Powder (Jeera)', 'Spices — Ground', 'kg', 'HE', 400, 1277, 'KEEP', NULL),
('HN-RM-019', 'HE-RM-019', 'Coriander Powder (Dhania)', 'Spices — Ground', 'kg', 'HE', 180, 1278, 'KEEP', NULL),
('HN-RM-020', 'HE-RM-020', 'Turmeric Powder (Haldi)', 'Spices — Ground', 'kg', 'HE', 280, 1279, 'KEEP', NULL),
('HN-RM-021', 'HE-RM-021', 'Kitchen King Masala', 'Spices — Ground', 'kg', 'HE', 900, 1280, 'KEEP', NULL),
('HN-RM-022', 'HE-RM-022', 'Kashmiri Red Chilli Powder', 'Spices — Ground', 'kg', 'HE', 800, 1281, 'KEEP', NULL),
('HN-RM-023', 'HE-RM-023', 'Chaat Masala', 'Spices — Ground', 'kg', 'HE', 320, 1282, 'KEEP', NULL),
('HN-RM-024', 'HE-RM-024', 'Amchur Powder (Dry Mango)', 'Spices — Ground', 'kg', 'HE', 140, 1283, 'KEEP', NULL),
('HN-RM-025', 'HE-RM-025', 'Desiccated Coconut Powder', 'Spices — Ground', 'kg', 'HE', 200, 1284, 'KEEP', NULL),
('HN-RM-026', 'HE-RM-026', 'White Pepper Powder', 'Spices — Ground', 'kg', 'HE', 150, 1285, 'KEEP', NULL),
-- Salt & Seasoning
('HN-RM-027', 'HE-RM-027', 'Salt', 'Salt & Seasoning', 'kg', 'HE', 15, 1286, 'KEEP', NULL),
('HN-RM-028', 'HE-RM-028', 'Black Salt (Kala Namak)', 'Salt & Seasoning', 'kg', 'HE', 80, 1287, 'KEEP', NULL),
-- Sweetener (BOTH brands)
('HN-RM-029', 'HE-RM-029', 'Sugar', 'Sweetener', 'kg', 'BOTH', 44, 1288, 'KEEP', 'NCH also uses (was Odoo 1097). Consolidated.'),
-- Rice & Grains
('HN-RM-030', 'HE-RM-030', 'Jeera Samba Rice', 'Rice & Grains', 'kg', 'HE', 205, 1289, 'UPDATE', 'Rename from Basmati Rice. Cost=205.'),
-- Dry Goods
('HN-RM-031', 'HE-RM-031', 'Toor Dal (Arhar)', 'Dry Goods', 'kg', 'HE', 140, 1290, 'KEEP', NULL),
('HN-RM-032', 'HE-RM-032', 'Wheat Flour (Atta)', 'Dry Goods', 'kg', 'HE', 53, 1291, 'KEEP', NULL),
('HN-RM-033', 'HE-RM-033', 'All-Purpose Flour (Maida)', 'Dry Goods', 'kg', 'HE', 47, 1292, 'KEEP', NULL),
('HN-RM-034', 'HE-RM-034', 'Corn Flour', 'Dry Goods', 'kg', 'HE', 48, 1293, 'KEEP', NULL),
('HN-RM-035', 'HE-RM-035', 'Instant Noodles (Hakka)', 'Dry Goods', 'pkt', 'HE', 30, 1294, 'KEEP', NULL),
('HN-RM-036', 'HE-RM-036', 'Cashew Nuts (Kaju)', 'Dry Goods', 'kg', 'HE', 1000, 1295, 'KEEP', NULL),
('HN-RM-037', 'HE-RM-037', 'Cashew Paste (Magaz)', 'Dry Goods', 'kg', 'HE', 600, 1296, 'KEEP', NULL),
('HN-RM-038', 'HE-RM-038', 'Whole Cashews', 'Dry Goods', 'kg', 'HE', 1000, 1297, 'KEEP', NULL),
('HN-RM-039', 'HE-RM-039', 'Chana Dal', 'Dry Goods', 'kg', 'HE', 180, 1298, 'KEEP', NULL),
('HN-RM-040', 'HE-RM-040', 'Ajinomoto (MSG)', 'Dry Goods', 'kg', 'HE', 140, 1299, 'KEEP', NULL),
-- Oils & Fats
('HN-RM-041', 'HE-RM-041', 'Mustard Oil', 'Oils & Fats', 'L', 'HE', 190, 1300, 'KEEP', NULL),
('HN-RM-042', 'HE-RM-042', 'Refined Oil', 'Oils & Fats', 'L', 'HE', 150, 1301, 'UPDATE', 'Cost was invalid in Odoo'),
('HN-RM-043', 'HE-RM-043', 'Salato Oil (Blended)', 'Oils & Fats', 'L', 'HE', 190, 1302, 'KEEP', NULL),
('HN-RM-044', 'HE-RM-044', 'Vanaspati Ghee (Dalda)', 'Oils & Fats', 'kg', 'HE', 130, 1303, 'KEEP', NULL),
('HN-RM-045', 'HE-RM-045', 'Cow Ghee (Desi)', 'Oils & Fats', 'kg', 'HE', 660, 1304, 'KEEP', NULL),
('HN-RM-046', 'HE-RM-046', 'Amul Butter', 'Oils & Fats', 'kg', 'HE', 590, 1305, 'KEEP', 'Direct purchase — no vendor'),
('HN-RM-047', 'HE-RM-047', 'Amul Fresh Cream', 'Oils & Fats', 'L', 'HE', 225, 1306, 'KEEP', NULL),
('HN-RM-048', 'HE-RM-048', 'Amul Cheese (Block)', 'Oils & Fats', 'kg', 'HE', 450, 1307, 'UPDATE', 'Cost was invalid'),
-- Sauces
('HN-RM-049', 'HE-RM-049', 'Tomato Ketchup', 'Sauces', 'kg', 'HE', 60, 1308, 'KEEP', NULL),
('HN-RM-050', 'HE-RM-050', 'Soya Sauce', 'Sauces', 'L', 'HE', 50, 1309, 'KEEP', NULL),
('HN-RM-051', 'HE-RM-051', 'Red Chilli Sauce', 'Sauces', 'L', 'HE', 80, 1310, 'KEEP', NULL),
('HN-RM-052', 'HE-RM-052', 'Vinegar', 'Sauces', 'L', 'HE', 25, 1311, 'KEEP', NULL),
('HN-RM-053', 'HE-RM-053', 'Capsicum Sauce', 'Sauces', 'L', 'HE', 120, 1312, 'KEEP', NULL),
('HN-RM-054', 'HE-RM-054', '8 to 8 Sauce (Maggi)', 'Sauces', 'L', 'HE', 120, 1313, 'KEEP', NULL),
-- Colours
('HN-RM-055', 'HE-RM-055', 'Red Food Colour', 'Colours', 'g', 'HE', 60, 1314, 'KEEP', NULL),
('HN-RM-056', 'HE-RM-056', 'Yellow Food Colour', 'Colours', 'g', 'HE', 60, 1315, 'KEEP', NULL),
('HN-RM-057', 'HE-RM-057', 'Green Food Colour', 'Colours', 'g', 'HE', 60, 1316, 'KEEP', NULL),
-- Fresh Vegetables
('HN-RM-058', 'HE-RM-058', 'Onion', 'Fresh Vegetables', 'kg', 'HE', 22, 1317, 'UPDATE', 'Price from veg bills'),
('HN-RM-059', 'HE-RM-059', 'Ginger', 'Fresh Vegetables', 'kg', 'HE', 65, 1318, 'UPDATE', 'Split from Ginger Garlic Paste'),
('HN-RM-060', 'HE-RM-060', 'Green Chillies', 'Fresh Vegetables', 'kg', 'HE', 60, 1319, 'UPDATE', 'Price from veg bills'),
('HN-RM-061', 'HE-RM-061', 'Carrot', 'Fresh Vegetables', 'kg', 'HE', 40, 1320, 'KEEP', NULL),
('HN-RM-062', 'HE-RM-062', 'Cabbage', 'Fresh Vegetables', 'kg', 'HE', 20, 1321, 'UPDATE', 'Price from veg bills'),
('HN-RM-063', 'HE-RM-063', 'Capsicum', 'Fresh Vegetables', 'kg', 'HE', 50, 1322, 'KEEP', NULL),
('HN-RM-064', 'HE-RM-064', 'Cauliflower (Gobi)', 'Fresh Vegetables', 'pcs', 'HE', 30, 1323, 'UPDATE', 'UoM: pcs not kg'),
('HN-RM-065', 'HE-RM-065', 'Lemon (Nimbu)', 'Fresh Vegetables', 'pcs', 'BOTH', 5, 1324, 'UPDATE', 'NCH also uses. UoM: pcs.'),
('HN-RM-066', 'HE-RM-066', 'Fresh Mint (Pudina)', 'Fresh Vegetables', 'bundle', 'HE', 12, 1325, 'UPDATE', 'UoM: bundle'),
('HN-RM-067', 'HE-RM-067', 'Fresh Coriander (Kothimir)', 'Fresh Vegetables', 'bundle', 'HE', 15, 1326, 'UPDATE', 'UoM: bundle'),
('HN-RM-068', 'HE-RM-068', 'French Beans', 'Fresh Vegetables', 'kg', 'HE', 70, 1327, 'UPDATE', 'Price from veg bills'),
('HN-RM-069', 'HE-RM-069', 'Spring Onion', 'Fresh Vegetables', 'bundle', 'HE', 20, 1328, 'UPDATE', 'UoM: bundle'),
('HN-RM-070', 'HE-RM-070', 'Tomato', 'Fresh Vegetables', 'kg', 'HE', 22, 1329, 'UPDATE', 'Price from veg bills'),
('HN-RM-071', 'HE-RM-071', 'Cucumber', 'Fresh Vegetables', 'kg', 'HE', 30, 1330, 'KEEP', NULL),
-- Meat & Poultry
('HN-RM-072', 'HE-RM-072', 'Chicken Whole — Skin Out', 'Meat & Poultry', 'kg', 'HE', 230, 1331, 'KEEP', NULL),
('HN-RM-073', 'HE-RM-073', 'Chicken Tandoori Cut', 'Meat & Poultry', 'kg', 'HE', 230, 1332, 'KEEP', NULL),
('HN-RM-074', 'HE-RM-074', 'Chicken Whole — With Skin', 'Meat & Poultry', 'kg', 'HE', 190, 1333, 'KEEP', NULL),
('HN-RM-075', 'HE-RM-075', 'Chicken Boneless Breast', 'Meat & Poultry', 'kg', 'HE', 330, 1334, 'UPDATE', 'Cost was invalid'),
('HN-RM-076', 'HE-RM-076', 'Chicken Thighs', 'Meat & Poultry', 'kg', 'HE', 230, 1335, 'KEEP', NULL),
('HN-RM-077', 'HE-RM-077', 'Mutton Biryani Cut', 'Meat & Poultry', 'kg', 'HE', 780, 1336, 'KEEP', NULL),
('HN-RM-078', 'HE-RM-078', 'Mutton Chops', 'Meat & Poultry', 'kg', 'HE', 780, 1337, 'KEEP', NULL),
('HN-RM-079', 'HE-RM-079', 'Mutton Gravy Cut', 'Meat & Poultry', 'kg', 'HE', 780, 1338, 'KEEP', NULL),
-- Spices — Dried
('HN-RM-080', 'HE-RM-080', 'Guntur Red Chilli (Dried)', 'Spices — Dried', 'kg', 'HE', 340, 1339, 'KEEP', NULL),
('HN-RM-081', 'HE-RM-081', 'Khaskhas (Poppy Seeds)', 'Spices — Dried', 'kg', 'HE', 300, 1340, 'KEEP', NULL),
('HN-RM-082', 'HE-RM-082', 'Imli (Tamarind)', 'Spices — Dried', 'kg', 'HE', 220, 1341, 'KEEP', NULL),
('HN-RM-083', 'HE-RM-083', 'Carom Seeds (Ajwain)', 'Spices — Dried', 'kg', 'HE', 300, 1342, 'KEEP', NULL),
('HN-RM-084', 'HE-RM-084', 'Saffron (Kesar)', 'Spices — Dried', 'g', 'HE', 500, 1343, 'KEEP', NULL),
('HN-RM-085', 'HE-RM-085', 'Kalonji (Nigella Seeds)', 'Spices — Dried', 'kg', 'HE', 200, 1344, 'KEEP', NULL),
('HN-RM-086', 'HE-RM-086', 'Peanuts (Raw)', 'Dry Goods', 'kg', 'HE', 200, 1345, 'KEEP', NULL),
('HN-RM-087', 'HE-RM-087', 'Lemon Salt (Citric Acid)', 'Salt & Seasoning', 'kg', 'HE', 180, 1346, 'KEEP', NULL),
-- HE Operations items (no Odoo ID yet)
('HN-RM-088', 'HE-RM-088', 'Potato (Aloo)', 'Fresh Vegetables', 'kg', 'HE', 25, NULL, 'CREATE', 'From veg bills'),
('HN-RM-089', 'HE-RM-089', 'Baji Mirchi (Bhavnagri)', 'Fresh Vegetables', 'kg', 'HE', 50, NULL, 'CREATE', 'From veg bills'),
('HN-RM-090', 'HE-RM-090', 'Brain (Bheja)', 'Meat & Poultry', 'kg', 'HE', 500, NULL, 'CREATE', 'Vendor: Sajid'),
('HN-RM-091', 'HE-RM-091', 'Rumali Roti', 'Ready-Made', 'pcs', 'HE', 10, NULL, 'CREATE', 'Vendor: Tabrez'),
('HN-RM-092', 'HE-RM-092', 'Curd', 'Dairy', 'L', 'HE', 60, NULL, 'CREATE', 'Vendor: Imtaiz bhai'),
('HN-RM-093', 'HE-RM-093', 'Milk (Local)', 'Dairy', 'L', 'HE', 56, NULL, 'CREATE', 'Vendor: Imtaiz bhai'),
('HN-RM-094', 'HE-RM-094', 'Eggs', 'Dairy', 'pcs', 'BOTH', 5.5, NULL, 'CREATE', 'Direct purchase'),
('HN-RM-095', 'HE-RM-095', 'Charcoal', 'Fuel (Production)', 'kg', 'HE', 32, NULL, 'CREATE', 'Vendor: Mudassir'),
('HN-RM-096', 'HE-RM-096', 'Garlic (Lasun)', 'Fresh Vegetables', 'kg', 'HE', 130, NULL, 'CREATE', 'Split from Ginger&Garlic'),
('HN-RM-097', 'HE-RM-097', 'Chicken Cutlet (Pre-made)', 'Ready-Made', 'pcs', 'HE', 15, NULL, 'CREATE', 'Different from NCH raw cutlet'),
('HN-RM-098', 'HE-RM-098', 'Cooking Wood', 'Fuel (Production)', 'load', 'HE', 8000, NULL, 'CREATE', 'Vendor: Sri Krishna'),
-- Shariff store items (no Odoo ID yet)
('HN-RM-099', 'HE-RM-099', 'Semolina (Sooji/Rawa)', 'Dry Goods', 'kg', 'HE', 52, NULL, 'CREATE', 'Shariff 14x'),
('HN-RM-100', 'HE-RM-100', 'Moong Dal', 'Lentils', 'kg', 'HE', 110, NULL, 'CREATE', 'Shariff 7x'),
('HN-RM-101', 'HE-RM-101', 'Masoor Dal', 'Lentils', 'kg', 'HE', 80, NULL, 'CREATE', 'Shariff 6x'),
('HN-RM-102', 'HE-RM-102', 'Shah Jeera (Black Cumin)', 'Spices — Whole', 'kg', 'HE', 1200, NULL, 'CREATE', 'Shariff 7x'),
('HN-RM-103', 'HE-RM-103', 'Dates (Kajoor)', 'Dry Fruits', 'kg', 'HE', 500, NULL, 'CREATE', 'Shariff 4x'),
('HN-RM-104', 'HE-RM-104', 'Stone Flower (Dagad Phool)', 'Spices — Dried', 'g', 'HE', 800, NULL, 'CREATE', 'Shariff 3x. Per kg.'),
('HN-RM-105', 'HE-RM-105', 'Fried Chana', 'Dry Goods', 'kg', 'HE', 140, NULL, 'CREATE', 'Shariff 3x'),
('HN-RM-106', 'HE-RM-106', 'Raisins (Kismis)', 'Dry Fruits', 'kg', 'HE', 600, NULL, 'CREATE', 'Shariff 2x'),
('HN-RM-107', 'HE-RM-107', 'Baking Soda', 'Dry Goods', 'kg', 'HE', 100, NULL, 'CREATE', 'Shariff 2x'),
('HN-RM-108', 'HE-RM-108', 'Rose Petal', 'Garnish', 'g', 'HE', 800, NULL, 'CREATE', 'Shariff 2x. Per kg.'),
('HN-RM-109', 'HE-RM-109', 'Chicken Masala', 'Spices — Blended', 'kg', 'HE', 300, NULL, 'CREATE', 'Shariff 2x'),
('HN-RM-110', 'HE-RM-110', 'Custard Powder', 'Dry Goods', 'kg', 'HE', 360, NULL, 'CREATE', 'Shariff 2x'),
('HN-RM-111', 'HE-RM-111', 'Poha (Flattened Rice)', 'Dry Goods', 'kg', 'HE', 50, NULL, 'CREATE', 'Shariff 2x'),
('HN-RM-112', 'HE-RM-112', 'Almonds (Badam)', 'Dry Fruits', 'kg', 'HE', 900, NULL, 'CREATE', 'Shariff 1x'),
('HN-RM-113', 'HE-RM-113', 'Pistachios (Pista)', 'Dry Fruits', 'kg', 'HE', 2400, NULL, 'CREATE', 'Shariff 1x'),
('HN-RM-114', 'HE-RM-114', 'Sabja Seeds (Basil Seeds)', 'Seeds', 'kg', 'HE', 400, NULL, 'CREATE', 'Shariff 2x'),
('HN-RM-115', 'HE-RM-115', 'Urad Dal', 'Lentils', 'kg', 'HE', 120, NULL, 'CREATE', 'Shariff 1x'),
('HN-RM-116', 'HE-RM-116', 'Garam Masala Mix', 'Spices — Blended', 'kg', 'HE', 1500, NULL, 'CREATE', 'Shariff 1x');

-- ============================================================
-- PRODUCTS — NCH Range (HN-RM-200 to 225)
-- ============================================================

INSERT OR IGNORE INTO rm_products (hn_code, old_code, name, category, uom, brand, avg_cost, odoo_id, action, notes) VALUES
('HN-RM-200', 'RM-BFM',  'Buffalo Milk', 'Beverage Core', 'L', 'NCH', 55, 1095, 'KEEP', 'NCH core. 85 POs. Prabhu vendor.'),
('HN-RM-201', 'RM-SMP',  'Skimmed Milk Powder', 'Beverage Core', 'kg', 'NCH', 310, 1096, 'KEEP', NULL),
('HN-RM-202', 'RM-TEA',  'Tea Powder', 'Beverage Core', 'kg', 'NCH', 450, 1098, 'KEEP', 'NCH core.'),
('HN-RM-203', 'RM-WTR',  'Filter Water', 'Beverage Core', 'L', 'NCH', 30, 1101, 'KEEP', '20L cans. 64 POs.'),
('HN-RM-204', 'RM-BUN',  'Buns', 'Snack Raw', 'Units', 'NCH', 8, 1104, 'KEEP', '69 POs.'),
('HN-RM-205', 'RM-OSMG', 'Osmania Biscuit (Loose)', 'Biscuits', 'Units', 'NCH', 3.13, 1105, 'KEEP', NULL),
('HN-RM-206', 'RM-CCT',  'Chicken Cutlet (Unfried)', 'Snack Raw', 'Units', 'NCH', 15, 1106, 'KEEP', 'Different from HE pre-made cutlet.'),
('HN-RM-207', 'RM-BWR',  'Bottled Water (500ml)', 'Water', 'Units', 'NCH', 6.7, 1107, 'KEEP', NULL),
('HN-RM-208', 'RM-OSMN', 'Osmania Biscuit Box (Niloufer)', 'Biscuits', 'Units', 'NCH', 173, 1110, 'KEEP', NULL),
('HN-RM-209', 'RM-CM',   'Condensed Milk', 'Dairy', 'kg', 'NCH', 326, 1112, 'KEEP', NULL),
('HN-RM-210', 'RM-SAM',  'Samosa Raw', 'Snack Raw', 'Units', 'NCH', 8, 1113, 'KEEP', '29 POs.'),
('HN-RM-211', 'RM-OIL',  'Oil (Frying)', 'Oils & Fats', 'L', 'NCH', 155, 1114, 'KEEP', 'NCH generic frying oil.'),
('HN-RM-212', 'RM-CHB',  'Cheese Balls Raw', 'Snack Raw', 'Units', 'NCH', 10, 1116, 'KEEP', NULL),
('HN-RM-213', 'RM-BTR',  'Butter', 'Dairy', 'kg', 'NCH', 580, 1119, 'KEEP', 'Bun Maska butter.'),
('HN-RM-214', 'RM-COF',  'Coffee Powder', 'Beverage Core', 'kg', 'NCH', 1200, 1120, 'KEEP', NULL),
('HN-RM-215', 'RM-HNY',  'Honey', 'Sweetener', 'kg', 'NCH', 240, 1123, 'KEEP', NULL),
('HN-RM-216', 'RM-CMR',  'Chicken Roll Raw', 'Snack Raw', 'Units', 'NCH', 35, 1393, 'KEEP', NULL),
('HN-RM-221', 'NCH-NIL-DCC75', 'Niloufer DCC 75g', 'Biscuits', 'Units', 'NCH', 80, 1401, 'KEEP', 'Packed resale.'),
('HN-RM-222', 'NCH-NIL-FB100', 'Niloufer Fruit 100g', 'Biscuits', 'Units', 'NCH', 46.67, 1402, 'KEEP', 'Packed resale.'),
('HN-RM-223', 'NCH-NIL-FB200', 'Niloufer Fruit 200g', 'Biscuits', 'Units', 'NCH', 100, 1403, 'KEEP', 'Packed resale.'),
('HN-RM-224', 'NCH-NIL-100',   'Niloufer Osmania 100g', 'Biscuits', 'Units', 'NCH', 35.71, 1424, 'KEEP', 'Packed resale.'),
('HN-RM-225', 'NCH-LPG',       'LPG Gas Cylinder', 'Fuel (Production)', 'cylinder', 'BOTH', 1770, NULL, 'CREATE', 'Manual purchase. Ahmed vendor.');


-- ============================================================
-- VENDOR ↔ PRODUCT MAPPINGS
-- ============================================================
-- is_primary=1 means this is the default vendor for purchase orders

-- HE Spices, Dry Goods, Sauces, Colours → Shariff
INSERT OR IGNORE INTO rm_vendor_products (product_code, vendor_key, is_primary, notes) VALUES
('HN-RM-001', 'SHARIFF', 1, NULL), ('HN-RM-002', 'SHARIFF', 1, NULL), ('HN-RM-003', 'SHARIFF', 1, NULL),
('HN-RM-004', 'SHARIFF', 1, NULL), ('HN-RM-005', 'SHARIFF', 1, NULL), ('HN-RM-006', 'SHARIFF', 1, NULL),
('HN-RM-007', 'SHARIFF', 1, NULL), ('HN-RM-008', 'SHARIFF', 1, NULL), ('HN-RM-009', 'SHARIFF', 1, NULL),
('HN-RM-010', 'SHARIFF', 1, NULL), ('HN-RM-011', 'SHARIFF', 1, NULL), ('HN-RM-012', 'SHARIFF', 1, NULL),
('HN-RM-013', 'SHARIFF', 1, NULL), ('HN-RM-014', 'SHARIFF', 1, NULL), ('HN-RM-015', 'SHARIFF', 1, NULL),
('HN-RM-017', 'SHARIFF', 1, NULL), ('HN-RM-018', 'SHARIFF', 1, NULL), ('HN-RM-019', 'SHARIFF', 1, NULL),
('HN-RM-020', 'SHARIFF', 1, NULL), ('HN-RM-021', 'SHARIFF', 1, NULL), ('HN-RM-022', 'SHARIFF', 1, NULL),
('HN-RM-023', 'SHARIFF', 1, NULL), ('HN-RM-024', 'SHARIFF', 1, NULL), ('HN-RM-025', 'SHARIFF', 1, NULL),
('HN-RM-026', 'SHARIFF', 1, NULL), ('HN-RM-027', 'SHARIFF', 1, NULL), ('HN-RM-028', 'SHARIFF', 1, NULL),
('HN-RM-029', 'SHARIFF', 1, NULL), ('HN-RM-030', 'SHARIFF', 1, NULL),
('HN-RM-031', 'SHARIFF', 1, NULL), ('HN-RM-032', 'SHARIFF', 1, NULL), ('HN-RM-033', 'SHARIFF', 1, NULL),
('HN-RM-034', 'SHARIFF', 1, NULL), ('HN-RM-035', 'SHARIFF', 1, NULL), ('HN-RM-036', 'SHARIFF', 1, NULL),
('HN-RM-037', 'SHARIFF', 1, NULL), ('HN-RM-038', 'SHARIFF', 1, NULL), ('HN-RM-039', 'SHARIFF', 1, NULL),
('HN-RM-040', 'SHARIFF', 1, NULL),
-- Oils & Fats → Shariff (except butter/cream/cheese)
('HN-RM-041', 'SHARIFF', 1, NULL), ('HN-RM-042', 'SHARIFF', 1, NULL), ('HN-RM-043', 'SHARIFF', 1, NULL),
('HN-RM-044', 'SHARIFF', 1, NULL), ('HN-RM-045', 'SHARIFF', 1, NULL),
('HN-RM-047', 'SHARIFF', 1, NULL), ('HN-RM-048', 'SHARIFF', 1, NULL),
-- Sauces + Colours → Shariff
('HN-RM-049', 'SHARIFF', 1, NULL), ('HN-RM-050', 'SHARIFF', 1, NULL), ('HN-RM-051', 'SHARIFF', 1, NULL),
('HN-RM-052', 'SHARIFF', 1, NULL), ('HN-RM-053', 'SHARIFF', 1, NULL), ('HN-RM-054', 'SHARIFF', 1, NULL),
('HN-RM-055', 'SHARIFF', 1, NULL), ('HN-RM-056', 'SHARIFF', 1, NULL), ('HN-RM-057', 'SHARIFF', 1, NULL),
-- Spices Dried → Shariff
('HN-RM-080', 'SHARIFF', 1, NULL), ('HN-RM-081', 'SHARIFF', 1, NULL), ('HN-RM-082', 'SHARIFF', 1, NULL),
('HN-RM-083', 'SHARIFF', 1, NULL), ('HN-RM-085', 'SHARIFF', 1, NULL), ('HN-RM-086', 'SHARIFF', 1, NULL),
('HN-RM-087', 'SHARIFF', 1, NULL),
-- Shariff new items (099-116)
('HN-RM-099', 'SHARIFF', 1, NULL), ('HN-RM-100', 'SHARIFF', 1, NULL), ('HN-RM-101', 'SHARIFF', 1, NULL),
('HN-RM-102', 'SHARIFF', 1, NULL), ('HN-RM-103', 'SHARIFF', 1, NULL), ('HN-RM-104', 'SHARIFF', 1, NULL),
('HN-RM-105', 'SHARIFF', 1, NULL), ('HN-RM-106', 'SHARIFF', 1, NULL), ('HN-RM-107', 'SHARIFF', 1, NULL),
('HN-RM-108', 'SHARIFF', 1, NULL), ('HN-RM-109', 'SHARIFF', 1, NULL), ('HN-RM-110', 'SHARIFF', 1, NULL),
('HN-RM-111', 'SHARIFF', 1, NULL), ('HN-RM-112', 'SHARIFF', 1, NULL), ('HN-RM-113', 'SHARIFF', 1, NULL),
('HN-RM-114', 'SHARIFF', 1, NULL), ('HN-RM-115', 'SHARIFF', 1, NULL), ('HN-RM-116', 'SHARIFF', 1, NULL);

-- Fresh Vegetables → Anju (HE), Manju (NCH)
INSERT OR IGNORE INTO rm_vendor_products (product_code, vendor_key, is_primary, notes) VALUES
('HN-RM-016', 'ANJU_VEG', 1, 'Curry leaves from veg vendor'),
('HN-RM-059', 'ANJU_VEG', 1, NULL), ('HN-RM-060', 'ANJU_VEG', 1, NULL),
('HN-RM-061', 'ANJU_VEG', 1, NULL), ('HN-RM-062', 'ANJU_VEG', 1, NULL),
('HN-RM-063', 'ANJU_VEG', 1, NULL), ('HN-RM-064', 'ANJU_VEG', 1, NULL),
('HN-RM-065', 'ANJU_VEG', 1, NULL), ('HN-RM-066', 'ANJU_VEG', 1, NULL),
('HN-RM-067', 'ANJU_VEG', 1, NULL), ('HN-RM-068', 'ANJU_VEG', 1, NULL),
('HN-RM-069', 'ANJU_VEG', 1, NULL), ('HN-RM-071', 'ANJU_VEG', 1, NULL),
('HN-RM-088', 'ANJU_VEG', 1, NULL), ('HN-RM-089', 'ANJU_VEG', 1, NULL),
('HN-RM-096', 'ANJU_VEG', 1, NULL);

-- Onion → D Babu (separate from veg vendor)
INSERT OR IGNORE INTO rm_vendor_products (product_code, vendor_key, is_primary, notes) VALUES
('HN-RM-058', 'D_BABU_ONION', 1, 'Per Odoo mapping');

-- Tomato → Abu (separate from veg vendor)
INSERT OR IGNORE INTO rm_vendor_products (product_code, vendor_key, is_primary, notes) VALUES
('HN-RM-070', 'ABU_TOMATO', 1, 'Per Odoo mapping');

-- Meat & Poultry
INSERT OR IGNORE INTO rm_vendor_products (product_code, vendor_key, is_primary, notes) VALUES
('HN-RM-072', 'MN_BROILERS', 1, NULL), ('HN-RM-073', 'MN_BROILERS', 1, NULL),
('HN-RM-074', 'MN_BROILERS', 1, NULL), ('HN-RM-075', 'MN_BROILERS', 1, NULL),
('HN-RM-076', 'MN_BROILERS', 1, NULL),
('HN-RM-077', 'HKGN_MUTTON', 1, NULL), ('HN-RM-078', 'HKGN_MUTTON', 1, NULL),
('HN-RM-079', 'HKGN_MUTTON', 1, NULL),
('HN-RM-090', 'SAJID', 1, NULL);

-- HE Operations items
INSERT OR IGNORE INTO rm_vendor_products (product_code, vendor_key, is_primary, notes) VALUES
('HN-RM-091', 'TABREZ', 1, NULL),
('HN-RM-092', 'IMTAIZ', 1, NULL), ('HN-RM-093', 'IMTAIZ', 1, NULL),
('HN-RM-095', 'MUDASSIR', 1, NULL),
('HN-RM-097', 'NISARCHA', 1, 'HE pre-made cutlet same vendor as NCH'),
('HN-RM-098', 'SRI_KRISHNA', 1, NULL);

-- NCH Products → Vendors (from actual Odoo PO history)
INSERT OR IGNORE INTO rm_vendor_products (product_code, vendor_key, is_primary, notes) VALUES
('HN-RM-200', 'PRABHU_MILK', 1, '74 POs'),
('HN-RM-200', 'R_PRASAD_DAIRY', 0, '9 POs. Backup.'),
('HN-RM-200', 'NAVYA_MILK', 0, 'Alt supplier'),
('HN-RM-201', 'JAY_JAY', 1, '10 POs'),
('HN-RM-202', 'AFEEFA_IMPEX', 1, 'Current. NEFT confirmed.'),
('HN-RM-202', 'LIBERTY_TEA', 0, '4 POs'),
('HN-RM-202', 'LUQMAN_TEA', 0, 'Alt supplier'),
('HN-RM-203', 'FILTER_WATER', 1, '64 POs'),
('HN-RM-204', 'GANGA_BAKERY', 1, '69 POs'),
('HN-RM-204', 'SAVITA_BAKERY', 0, '2 POs. Backup.'),
('HN-RM-205', 'SREE_MANJULA', 1, 'NEFT: Sree Manjula Enterprises'),
('HN-RM-205', 'GALAXY_BAKERY', 0, '4 POs'),
('HN-RM-206', 'NISARCHA', 1, '45 POs'),
('HN-RM-207', 'NAZEER_NADEEM', 1, 'NEFT confirmed. 22 POs.'),
('HN-RM-208', 'NILOUFER', 1, NULL),
('HN-RM-209', 'SHARIFF', 1, '9 POs'),
('HN-RM-210', 'SAMOSA_VENDOR', 1, '29 POs'),
('HN-RM-210', 'ABID', 0, 'Also supplies samosa'),
('HN-RM-211', 'SHARIFF', 1, '5 POs'),
('HN-RM-212', 'ABID', 1, '26 POs'),
('HN-RM-213', 'BUTTER_ONLINE', 1, '39 POs'),
('HN-RM-213', 'SHARIFF', 0, '25 POs. Also supplies butter.'),
('HN-RM-214', 'SHARIFF', 1, NULL),
('HN-RM-215', 'SHARIFF', 1, NULL),
('HN-RM-216', 'NISARCHA', 1, '8 POs'),
('HN-RM-221', 'NILOUFER', 1, NULL), ('HN-RM-222', 'NILOUFER', 1, NULL),
('HN-RM-223', 'NILOUFER', 1, NULL), ('HN-RM-224', 'NILOUFER', 1, NULL),
('HN-RM-225', 'AHMED_GAS', 1, '5 POs');


-- ============================================================
-- ARCHIVE LIST (15 items to deactivate in Odoo)
-- ============================================================

INSERT OR IGNORE INTO rm_archive_list (old_code, name, brand, reason) VALUES
('RM-MMD',  'Condensed Milk (dup)', 'NCH', 'Duplicate of RM-CM.'),
('RM-SUGP', 'Sugar Powder', 'NCH', 'No price, no POs, never used.'),
('RM-TEAR', 'Tea Powder (Ranveer)', 'NCH', 'Ranveer=vendor, not product. Dup of RM-TEA.'),
('RM-MMA',  'Milk Maid (Amul)', 'NCH', 'Variant of Condensed Milk. Consolidate.'),
('RM-MMN',  'Milk Maid (Nestle)', 'NCH', 'Variant of Condensed Milk. Consolidate.'),
(NULL,      'Nilofer Osmania biscuits (dup)', 'Shared', 'Duplicate of RM-OSMG.'),
(NULL,      'Service on Timesheets', 'Shared', 'Not raw material.'),
(NULL,      'Soap oil', 'HE', 'Housekeeping — not food RM.'),
(NULL,      'Hand wash', 'HE', 'Housekeeping.'),
(NULL,      'Tissue', 'HE', 'Housekeeping.'),
(NULL,      'Soap', 'HE', 'Housekeeping.'),
(NULL,      'Air freshener', 'HE', 'Housekeeping.'),
(NULL,      'Room freshener', 'HE', 'Housekeeping.'),
(NULL,      'Hit anti mosquito', 'HE', 'Housekeeping.'),
(NULL,      'Finol', 'HE', 'Housekeeping.');
