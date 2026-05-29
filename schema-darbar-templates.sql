-- ════════════════════════════════════════════════════════════════════════
-- Darbar — DLT (Fast2SMS) template registry pre-seed.
-- Rows stored under the WABA template name so comms-core lookupDltTemplate()
-- resolves 1:1. status='pending' + dlt_template_id='TBD' → sends skip gracefully
-- (ready:false) until the owner registers each on the DLT portal and flips it via
-- /api/comms?action=update-dlt-template. entity = HN HOTELS PE 1401667060000079296,
-- header HNHTLS. {#var#} placeholders render in order.
-- Apply: wrangler d1 execute hn-hiring --remote --file=schema-darbar-templates.sql
-- ════════════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO dlt_templates (template_name, dlt_template_id, entity_id, header, category, body_template, status, variable_count, notes) VALUES
('darbar_missed_exit_v1','TBD','1401667060000079296','HNHTLS','service',
 'Hi {#var#}, aapne aaj kaam khatam hone par punch nahi kiya. Ye missed-punch ke roop me darj hai. Kal punch out yaad rakhna. - HN Hotels',
 'pending', 1,
 'Staff nudge: forgot exit punch. var1=name. Fires at day-close+30m for odd-count/open-shift.'),

('darbar_absent_v1','TBD','1401667060000079296','HNHTLS','service',
 'Hi {#var#}, abhi tak aapka punch nahi dikha. Kaam pe ho ya aaj chhutti? - HN Hotels',
 'pending', 1,
 'Staff nudge: no punch by brand check-time (HE 14:00 / NCH 10:00). var1=name.'),

('darbar_break_open_v1','TBD','1401667060000079296','HNHTLS','service',
 'Hi {#var#}, aapka break-return punch nahi mila. Wapas aane par punch karna yaad rakhein. - HN Hotels',
 'pending', 1,
 'Staff nudge: break-out with no return after ~90m. var1=name.'),

('darbar_departed_confirm_v1','TBD','1401667060000079296','HNHTLS','service',
 'HN Hotels: {#var#} ne {#var#} din se punch nahi kiya ({#var#}). Owner please confirm exit ya leave.',
 'pending', 3,
 'Owner alert: departed-staff. var1=name var2=days var3=brand. (Owner can also act in-app.)'),

('darbar_ghost_pin_v1','TBD','1401667060000079296','HNHTLS','service',
 'HN Hotels: PIN {#var#} {#var#} baar punch kar raha hai ({#var#} din) par roster me naam nahi hai. Owner please naam dein.',
 'pending', 3,
 'Owner alert: ghost identity. var1=pin var2=punches var3=days.');

SELECT template_name, status, dlt_template_id FROM dlt_templates WHERE template_name LIKE 'darbar_%';
