-- HN Hotels HR — per-employee week_off override (Apr 19 2026)
-- Previously week-off came from hr_shift_rules keyed on (brand, pay_type),
-- which forced every HQ Monthly employee to have the same Sunday off. That's
-- wrong: Nihaf/Basheer/Tanveer/Naveen work 7 days; only Zoya has Sunday off.
--
-- Adds an employee-level override. If hr_employees.week_off_day is set (not NULL),
-- it takes precedence over the shift rule. NULL → fall back to shift rule.
-- Also clears the HQ shift-rule week_off so unassigned HQ staff default to 'none'.
--
-- Run: wrangler d1 execute DB --remote --file schema-hr-per-employee-weekoff.sql

ALTER TABLE hr_employees ADD COLUMN week_off_day TEXT;

-- Zoya keeps Sunday off
UPDATE hr_employees SET week_off_day = 'sunday' WHERE pin = '35';

-- HQ shift rule default drops Sunday — it's no longer applied to everyone
UPDATE hr_shift_rules SET week_off = 'none' WHERE brand_label = 'HQ';
