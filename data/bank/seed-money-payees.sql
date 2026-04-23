-- Seeded from data/bank/hdfc-payees-4680.json (30 registered HDFC payees).
-- Brand attribution based on commodity + Nihaf's brand playbook:
--   NCH (Nawabi Chai House):  tea_powder, milk_powder, biscuits, biscuit_boxes
--   HE  (Hamza Express):      chicken, mutton, coal, firewood, charcoal
--   HQ  (HN Hotels Pvt Ltd):  owner accounts
--   mixed: utilities, water, grocery, packaging, petty cash, lpg_gas, mats
--   unknown: salary accounts (tagging pending — staff cross both brands)
--
-- category taxonomy:
--   salary, vendor_food, vendor_packaging, vendor_utility, vendor_other,
--   owner, petty_cash
--
-- Run:
--   wrangler d1 execute hn-hiring --remote --file=data/bank/seed-money-payees.sql

INSERT OR IGNORE INTO money_payees
  (registry_source, name, normalized_name, bank, account_type, last4, category, commodity, role, brand, is_own_account, notes)
VALUES
  ('hdfc_4680', 'Abdul Khader Nihaf Salary AC',             'ABDUL KHADER NIHAF SALARY AC',             'HDFC Bank',                      'Savings',  '4005', 'owner',            NULL,             NULL,         'HQ',      1, 'Self / owner salary account'),
  ('hdfc_4680', 'Afeefa Impex Tea Powder Vendor',           'AFEEFA IMPEX TEA POWDER VENDOR',           'HDFC Bank',                      'Savings',  '2951', 'vendor_food',      'tea_powder',     NULL,         'NCH',     0, NULL),
  ('hdfc_4680', 'Ahmed Shaheen',                            'AHMED SHAHEEN',                            'HDFC Bank',                      'Savings',  '5360', 'unknown',          NULL,             NULL,         'unknown', 0, NULL),
  ('hdfc_4680', 'Ajim Mohammad Head Cook Salary AC',        'AJIM MOHAMMAD HEAD COOK SALARY AC',        'AXIS BANK',                      'Savings',  '1634', 'salary',           NULL,             'head_cook',  'HE',      0, 'HE head cook'),
  ('hdfc_4680', 'AM Ruba Bharat Gas Vendor',                'AM RUBA BHARAT GAS VENDOR',                'STATE BANK OF INDIA',            'Current',  '6228', 'vendor_utility',   'lpg_gas',        NULL,         'mixed',   0, NULL),
  ('hdfc_4680', 'Asif Employee',                            'ASIF EMPLOYEE',                            'JAMMU AND KASHMIR BANK LIMITED', 'Savings',  '2696', 'salary',           NULL,             NULL,         'unknown', 0, NULL),
  ('hdfc_4680', 'B Naveen Kumar',                           'B NAVEEN KUMAR',                           'FEDERAL BANK',                   'Savings',  '1370', 'salary',           NULL,             'cfo',        'HQ',      0, 'CFO'),
  ('hdfc_4680', 'Coal Bhatti',                              'COAL BHATTI',                              'CENTRAL BANK OF INDIA',          'Savings',  '1842', 'vendor_food',      'coal',           NULL,         'HE',      0, 'HE biryani coal'),
  ('hdfc_4680', 'Galaxy Loose Biscuit Vendor Iqrar Pasha',  'GALAXY LOOSE BISCUIT VENDOR IQRAR PASHA',  'INDIAN OVERSEAS BANK',           'Savings',  '9910', 'vendor_food',      'biscuits',       NULL,         'NCH',     0, NULL),
  ('hdfc_4680', 'HKGN Mutton Noor',                         'HKGN MUTTON NOOR',                         'ICICI BANK LIMITED',             'Current',  '0542', 'vendor_food',      'mutton',         NULL,         'HE',      0, NULL),
  ('hdfc_4680', 'Jay And Jay Milk Powder Vendor',           'JAY AND JAY MILK POWDER VENDOR',           'AXIS BANK',                      'Current',  '2370', 'vendor_food',      'milk_powder',    NULL,         'NCH',     0, NULL),
  ('hdfc_4680', 'KM Haneef Federal Bank Account',           'KM HANEEF FEDERAL BANK ACCOUNT',           'FEDERAL BANK',                   'Savings',  '4486', 'unknown',          NULL,             NULL,         'unknown', 0, 'Related to KM Haneef'),
  ('hdfc_4680', 'KM Haneef HDFC Account',                   'KM HANEEF HDFC ACCOUNT',                   'HDFC Bank',                      'Savings',  '6600', 'unknown',          NULL,             NULL,         'unknown', 0, 'Related to KM Haneef'),
  ('hdfc_4680', 'MD Aktar Salary AC',                       'MD AKTAR SALARY AC',                       'AIRTEL PAYMENTS BANK LIMITED',   'Savings',  '4755', 'salary',           NULL,             NULL,         'unknown', 0, NULL),
  ('hdfc_4680', 'MD Kesmat SK Salary AC',                   'MD KESMAT SK SALARY AC',                   'PUNJAB NATIONAL BANK',           'Savings',  '4120', 'salary',           NULL,             NULL,         'unknown', 0, NULL),
  ('hdfc_4680', 'MN Chicken',                               'MN CHICKEN',                               'JAMMU AND KASHMIR BANK LIMITED', 'Current',  '0003', 'vendor_food',      'chicken',        NULL,         'HE',      0, NULL),
  ('hdfc_4680', 'Mohammed Ismail Salary AC',                'MOHAMMED ISMAIL SALARY AC',                'JAMMU AND KASHMIR BANK LIMITED', 'Savings',  '4806', 'salary',           NULL,             NULL,         'unknown', 0, NULL),
  ('hdfc_4680', 'Mudassir Pasha Charcoal Supplier',         'MUDASSIR PASHA CHARCOAL SUPPLIER',         'KOTAK MAHINDRA BANK LIMITED',    'Savings',  '2908', 'vendor_food',      'charcoal',       NULL,         'HE',      0, NULL),
  ('hdfc_4680', 'Mujib Tea Master Salary AC',               'MUJIB TEA MASTER SALARY AC',               'CANARA BANK',                    'Savings',  '3457', 'salary',           NULL,             'tea_master', 'NCH',     0, 'NCH tea master'),
  ('hdfc_4680', 'Nazeer Nadeem Bisleri Water Vendor',       'NAZEER NADEEM BISLERI WATER VENDOR',       'IDFC FIRST BANK LTD',            'Savings',  '0487', 'vendor_utility',   'water',          NULL,         'mixed',   0, NULL),
  ('hdfc_4680', 'Noim Uddin Salary AC',                     'NOIM UDDIN SALARY AC',                     'CENTRAL BANK OF INDIA',          'Savings',  '0798', 'salary',           NULL,             NULL,         'unknown', 0, NULL),
  ('hdfc_4680', 'Noor Ahmed Employee Salary AC',            'NOOR AHMED EMPLOYEE SALARY AC',            'INDIAN OVERSEAS BANK',           'Savings',  '9060', 'salary',           NULL,             NULL,         'unknown', 0, NULL),
  ('hdfc_4680', 'Royal Polymers Mats',                      'ROYAL POLYMERS MATS',                      'INDIAN BANK',                    'Savings',  '1720', 'vendor_packaging', 'mats_polymers',  NULL,         'mixed',   0, NULL),
  ('hdfc_4680', 'Shariff Departmental Store',               'SHARIFF DEPARTMENTAL STORE',               'HDFC Bank',                      'Savings',  '5789', 'vendor_food',      'grocery',        NULL,         'mixed',   0, NULL),
  ('hdfc_4680', 'Sheikh Faheemul Staff Salary',             'SHEIKH FAHEEMUL STAFF SALARY',             'KOTAK MAHINDRA BANK LIMITED',    'Savings',  '3961', 'salary',           NULL,             'ops',        'HQ',      0, 'Ops staff'),
  ('hdfc_4680', 'Sree Manjula Enterprises Biscuite Boxes',  'SREE MANJULA ENTERPRISES BISCUITE BOXES',  'IDBI BANK',                      'Current',  '8297', 'vendor_packaging', 'biscuit_boxes',  NULL,         'NCH',     0, NULL),
  ('hdfc_4680', 'Sri Krishna Enterprises Fire wood Vendor', 'SRI KRISHNA ENTERPRISES FIRE WOOD VENDOR', 'FEDERAL BANK',                   'Savings',  '1019', 'vendor_food',      'firewood',       NULL,         'HE',      0, NULL),
  ('hdfc_4680', 'Tanveer Ahmed Petty Cash Account',         'TANVEER AHMED PETTY CASH ACCOUNT',         'STATE BANK OF INDIA',            'Savings',  '8124', 'petty_cash',       NULL,             NULL,         'mixed',   0, NULL),
  ('hdfc_4680', 'Tanveer Ahmed Salary AC',                  'TANVEER AHMED SALARY AC',                  'STATE BANK OF INDIA',            'Savings',  '5086', 'salary',           NULL,             NULL,         'unknown', 0, NULL),
  ('hdfc_4680', 'Yashwant Jodha',                           'YASHWANT JODHA',                           'CANARA BANK',                    'Savings',  '9649', 'unknown',          NULL,             NULL,         'unknown', 0, 'Pending CAMS device enrollment per HR memory');
