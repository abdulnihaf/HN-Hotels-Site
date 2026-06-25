-- Hiring role registry seed — matches Darbar Odoo jobs to creative taxonomy.
-- Run after schema-hiring-roles.sql. Safe to re-run (INSERT OR REPLACE).

INSERT OR REPLACE INTO hiring_roles (role_key, label, brand, creative_key, poster_url, default_package, always_need, priority_score, churn_rank, template_name, odoo_job_names) VALUES
('cleaner', 'Cleaner', 'both', 'C23', 'https://hnhotels.in/media/wa/he/CR02-HiringPoster-AllPositions.jpeg', '₹14,000–16,000/month + food + weekly off', 1, 95, 1, 'hn_hiring_v1', '["Cleaner"]'),
('dishwasher', 'Washer / Dishwasher', 'both', 'C22', 'https://hnhotels.in/media/wa/he/CR02-HiringPoster-AllPositions.jpeg', '₹14,000–16,000/month + food + weekly off', 1, 95, 2, 'hn_hiring_v1', '["Washer / Dishwasher"]'),
('waiter', 'Waiter / Steward', 'both', 'C19', 'https://hnhotels.in/media/wa/he/C19%20FB%20Restaurant%20Waiter.png', '₹16,000–20,000/month + food + tips', 1, 85, 3, 'hn_hiring_v1', '["Waiter / Steward","Service Boy","Counter Boy / Server"]'),
('kitchen_helper', 'Kitchen Helper', 'both', 'C08', 'https://hnhotels.in/media/wa/he/CR02-HiringPoster-AllPositions.jpeg', '₹15,000–18,000/month + food + stay', 1, 80, 4, 'hn_hiring_v1', '["Kitchen Helper","Chai Maker Helper"]'),
('cashier', 'Cashier', 'both', 'C13', 'https://hnhotels.in/media/wa/he/CR02-HiringPoster-AllPositions.jpeg', '₹16,000–20,000/month + food', 0, 70, 5, 'hn_hiring_v1', '["Cashier"]'),
('supervisor', 'Supervisor', 'both', 'C09', 'https://hnhotels.in/media/wa/he/CR02-HiringPoster-AllPositions.jpeg', '₹20,000–25,000/month + food', 0, 65, 6, 'hn_hiring_v1', '["Shift Supervisor"]'),
('captain', 'Captain', 'both', 'C10', 'https://hnhotels.in/media/wa/he/CR02-HiringPoster-AllPositions.jpeg', '₹18,000–22,000/month + food + tips', 0, 60, 7, 'hn_hiring_v1', '["Captain"]'),
('indian_cook', 'Indian Cook', 'both', 'C01', 'https://hnhotels.in/media/wa/he/CR01-WA-All%20Cooks.png', '₹20,000–30,000/month + food + stay', 0, 55, 8, 'hn_hiring_v1', '["Indian Cook Lead","Indian Cook Assistant","Assistant Cook","Porotta Maker","Rumali Maker"]'),
('chinese_cook', 'Chinese Cook', 'he', 'C01', 'https://hnhotels.in/media/wa/he/CR01-WA-All%20Cooks.png', '₹20,000–30,000/month + food + stay', 0, 55, 9, 'hn_hiring_v1', '["Chinese Cook Lead","Chinese Cook Assistant"]'),
('tandoor_cook', 'Tandoor Cook', 'he', 'C17', 'https://hnhotels.in/media/wa/he/CR01-WA-All%20Cooks.png', '₹20,000–30,000/month + food + stay', 0, 55, 10, 'hn_hiring_v1', '["Tandoor Cook Lead","Tandoor Cook Assistant"]'),
('grill_shawaya', 'Grill / Shawaya Maker', 'he', 'C05', 'https://hnhotels.in/media/wa/he/CR01-WA-All%20Cooks.png', '₹20,000–28,000/month + food + stay', 0, 55, 11, 'hn_hiring_v1', '["Grill / Shawaya Maker","FC / Hamza Bites Cook"]'),
('shawarma_maker', 'Shawarma Maker', 'he', 'C06', 'https://hnhotels.in/media/wa/he/CR01-WA-All%20Cooks.png', '₹18,000–24,000/month + food + stay', 0, 55, 12, 'hn_hiring_v1', '["Shawarma Maker"]'),
('tea_master', 'Irani Chai Master', 'nch', 'C02', 'https://hnhotels.in/media/wa/he/C02-WA%20Irani%20Tea%20Setup.png', '₹18,000–24,000/month + food', 0, 55, 13, 'hn_hiring_v1', '["Irani Chai Master"]'),
('juice_maker', 'Juice Maker', 'he', 'C04', 'https://hnhotels.in/media/wa/he/CO4-FB%20Juice%20Master.png', '₹18,000–24,000/month + food', 0, 55, 14, 'hn_hiring_v1', '["Juice & Mojitos Maker"]'),
('display_creator', 'Quick Bites / Display Creator', 'he', 'C08', 'https://hnhotels.in/media/wa/he/CR02-HiringPoster-AllPositions.jpeg', '₹18,000–24,000/month + food', 0, 50, 15, 'hn_hiring_v1', '["Quick Bites / Display Creator"]'),
('runner', 'Runner', 'both', 'C10', 'https://hnhotels.in/media/wa/he/CR02-HiringPoster-AllPositions.jpeg', '₹15,000–18,000/month + food', 0, 50, 16, 'hn_hiring_v1', '["Runner"]'),
('manager', 'Operations Manager', 'both', 'C11', 'https://hnhotels.in/media/wa/he/CR02-HiringPoster-AllPositions.jpeg', '₹30,000–45,000/month + incentives', 0, 50, 17, 'hn_hiring_v1', '["Operations Manager","General Manager"]'),
('office_exec', 'Office Executive', 'he', 'C11', 'https://hnhotels.in/media/wa/he/CR02-HiringPoster-AllPositions.jpeg', '₹18,000–24,000/month', 0, 40, 18, 'hn_hiring_v1', '["Office Executive"]');
