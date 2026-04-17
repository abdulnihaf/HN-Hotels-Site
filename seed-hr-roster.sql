-- HN Hotels — HR roster seed
-- Source: HN_Staff_Salary_Register (Sheet2) + HN_Staff_Bio_ID_Mapping CSVs
-- Applied: 2026-04-17
-- Notes:
--   * Rows 15 and 25 in the salary register are skipped numbers (previously terminated staff).
--   * Ameer Khan (row 39, bio 34): salary ₹16,000, start 2026-04-13, brand/role pending.
--   * 13 staff have NULL pin until enrolled in the CAMS F38+ device.
--   * daily_rate is carried from the sheet for Contract staff (package-based); Monthly = monthly_salary/30 computed in code.
--   * company_id: '1' = HN Hotels Pvt Ltd (HE), '10' = Nawabi Chai House (NCH), NULL = HQ/shared.

-- =====================================================================
-- A. AZEEM CONTRACT — HE Kitchen (₹9,100/day package, 10 people)
-- =====================================================================
INSERT INTO hr_employees (row_no, name, pin, brand_label, company_id, department_name, job_name, pay_type, monthly_salary, daily_rate, start_date, notes) VALUES
  (1,  'Azeem',         '12', 'HE', '1', 'HE - Kitchen', 'Head Chef',                  'Contract', 36000, 1200, NULL, 'Azeem contract lead'),
  (2,  'Rahim',         '23', 'HE', '1', 'HE - Kitchen', 'Tandoor Cook Lead',          'Contract', 33000, 1100, NULL, 'Azeem contract'),
  (3,  'Ramjan',        NULL, 'HE', '1', 'HE - Kitchen', 'Tandoor Assistant',          'Contract', 27000,  900, NULL, 'Azeem contract — bio ID pending'),
  (4,  'Nizam',         NULL, 'HE', '1', 'HE - Kitchen', 'Indian Assistant Cook',      'Contract', 27000,  900, NULL, 'Azeem contract — bio ID pending'),
  (5,  'Bikash',        '13', 'HE', '1', 'HE - Kitchen', 'Chinese Assistant Cook',     'Contract', 27000,  900, NULL, 'Azeem contract'),
  (6,  'Laden',         NULL, 'HE', '1', 'HE - Kitchen', 'Indian Helper',              'Contract', 21000,  700, NULL, 'Azeem contract — bio ID pending'),
  (7,  'Yahabu Khan',   NULL, 'HE', '1', 'HE - Kitchen', 'Chinese Helper',             'Contract', 21000,  700, NULL, 'Azeem contract — bio ID pending'),
  (8,  'Badol',         NULL, 'HE', '1', 'HE - Kitchen', 'Porotta Maker',              'Contract', 24000,  800, NULL, 'Azeem contract — bio ID pending'),
  (9,  'Paresh',        NULL, 'HE', '1', 'HE - Kitchen', 'Porotta Maker',              'Contract', 24000,  800, NULL, 'Azeem contract — bio ID pending'),
  (10, 'Anthony',       NULL, 'HE', '1', 'HE - Kitchen', 'Washer / Dishwasher',        'Contract', 18000,  600, NULL, 'Azeem contract — bio ID pending');

-- =====================================================================
-- B. TEA MASTER CONTRACT — NCH (₹3,000/day package, 2 people)
-- =====================================================================
INSERT INTO hr_employees (row_no, name, pin, brand_label, company_id, department_name, job_name, pay_type, monthly_salary, daily_rate, start_date, notes) VALUES
  (11, 'Mujib',         '10', 'NCH', '10', 'NCH - Kitchen', 'Irani Chai Master', 'Contract', 45000, 1500, NULL, 'Tea Master contract'),
  (12, 'Moin',          '5',  'NCH', '10', 'NCH - Kitchen', 'Irani Chai Master', 'Contract', 45000, 1500, NULL, 'Tea Master contract');

-- =====================================================================
-- C. HE MONTHLY STAFF (not in Azeem contract)
-- Row 15 is a deliberate gap (terminated staff).
-- =====================================================================
INSERT INTO hr_employees (row_no, name, pin, brand_label, company_id, department_name, job_name, pay_type, monthly_salary, daily_rate, start_date, notes) VALUES
  (13, 'SK Muntaz',     '7',  'HE', '1', 'HE - Service', 'Captain',                'Monthly', 25000, 833, NULL, NULL),
  (14, 'Noor Ahmed',    '15', 'HE', '1', 'HE - Counter', 'Cashier',                'Monthly', 25000, 833, NULL, NULL),
  (16, 'Faizan',        '4',  'HE', '1', 'HE - Service', 'Waiter / Steward',       'Monthly', 18000, 600, NULL, NULL),
  (17, 'Faisal Ali',    '8',  'HE', '1', 'HE - Support', 'Cleaner',                'Monthly', 18000, 600, NULL, NULL),
  (18, 'Hardev Prasad', '3',  'HE', '1', 'HE - Service', 'Waiter / Steward',       'Monthly', 18000, 600, NULL, NULL),
  (19, 'Dhiraj Kumar',  NULL, 'HE', '1', 'HE - Support', 'Cleaner',                'Monthly', 18000, 600, NULL, 'Bio ID pending');

-- =====================================================================
-- D. NCH MONTHLY STAFF
-- Row 25 is a deliberate gap (terminated staff).
-- =====================================================================
INSERT INTO hr_employees (row_no, name, pin, brand_label, company_id, department_name, job_name, pay_type, monthly_salary, daily_rate, start_date, notes) VALUES
  (20, 'MD Kesmat',       '14', 'NCH', '10', 'NCH - Counter', 'Cashier',          'Monthly', 19000, 633, NULL, 'Cashier / Captain dual role'),
  (21, 'Nafees Ahmed',    NULL, 'NCH', '10', 'NCH - Counter', 'Cashier',          'Monthly', 25000, 833, NULL, 'Bio ID pending'),
  (22, 'B Aadil Ahmed',   '25', 'NCH', '10', 'NCH - Support', 'Kitchen Helper',   'Monthly', 18000, 600, NULL, 'Cleaner / Helper dual'),
  (23, 'MD Aktar',        '29', 'NCH', '10', 'NCH - Kitchen', 'Washer / Dishwasher','Monthly',18000, 600, NULL, NULL),
  (24, 'Sabir Ahmed',     '24', 'NCH', '10', 'NCH - Service', 'Runner',           'Monthly', 18000, 600, NULL, NULL),
  (26, 'Somesh',          NULL, 'NCH', '10', 'NCH - Kitchen', 'Washer / Dishwasher','Monthly',18000, 600, NULL, 'Bio ID pending'),
  (27, 'MD Reyaj Ali',    '26', 'NCH', '10', 'NCH - Support', 'Cleaner',          'Monthly', 18000, 600, NULL, NULL),
  (28, 'Dhananjay Singh', '27', 'NCH', '10', 'NCH - Support', 'Cleaner',          'Monthly', 18000, 600, NULL, 'Cleaner / Runner'),
  (29, 'Noim Uddin',      '33', 'NCH', '10', 'NCH - Support', 'Cleaner',          'Monthly', 18000, 600, NULL, NULL),
  (30, 'MD Maqbool',      '30', 'NCH', '10', 'NCH - Support', 'Cleaner',          'Monthly', 18000, 600, NULL, NULL);

-- =====================================================================
-- E. OFFICE / CORE TEAM (HQ — shared company, no payroll deductions on office)
-- =====================================================================
INSERT INTO hr_employees (row_no, name, pin, brand_label, company_id, department_name, job_name, pay_type, monthly_salary, daily_rate, start_date, notes) VALUES
  (31, 'Abdul Khader Nihaf', '1',  'HQ', NULL, 'HN - Office', 'Managing Director',        'Monthly', 30000, 1000, NULL, 'Founder / MD'),
  (32, 'B Naveen Kumar',     '2',  'HQ', NULL, 'HN - Office', 'CFO',                      'Monthly', 30000, 1000, NULL, NULL),
  (33, 'Zoya Ahmed',         NULL, 'HQ', NULL, 'HN - Office', 'Office Executive',         'Monthly', 20000,  667, NULL, 'PA & Administrator — bio ID pending'),
  (34, 'Yash',               NULL, 'HQ', NULL, 'HN - Office', 'Office Executive',         'Monthly', 15000,  500, NULL, 'CTO (technical) — bio ID pending'),
  (35, 'Basheer',            '22', 'HQ', NULL, 'HN - Office', 'General Manager',          'Monthly', 25000, NULL, NULL, 'GM Ops / Sales / Marketing — daily rate TBD'),
  (36, 'Tanveer Ahmed',      '9',  'HQ', NULL, 'HN - Office', 'General Manager',          'Monthly', 30000, 1000, NULL, 'GM Ops'),
  (37, 'Faheem',             '11', 'HQ', NULL, 'HN - Office', 'Office Executive',         'Monthly', 25000,  833, NULL, 'Asst Manager Sales & Marketing'),
  (38, 'Waseem',             NULL, 'HQ', NULL, 'HN - Office', 'Office Executive',         'Monthly', 25000,  833, NULL, 'Asst Manager Ops — bio ID pending');

-- =====================================================================
-- F. NEW HIRE — Ameer Khan (joined 2026-04-13)
-- =====================================================================
INSERT INTO hr_employees (row_no, name, pin, brand_label, company_id, pay_type, monthly_salary, daily_rate, start_date, notes) VALUES
  (39, 'Ameer Khan', '34', 'TBD', NULL, 'TBD', 16000, 533.33, '2026-04-13',
   'New hire 13-Apr-2026. Brand (HE/NCH) and role TBD — update before Odoo sync.');

-- Verify
SELECT brand_label, COUNT(*) AS n,
       SUM(CASE WHEN pin IS NOT NULL THEN 1 ELSE 0 END) AS enrolled,
       SUM(CASE WHEN pin IS NULL THEN 1 ELSE 0 END) AS pending_bio
FROM hr_employees
GROUP BY brand_label
ORDER BY brand_label;
