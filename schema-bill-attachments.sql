-- HN Hotels — Bill Attachments registry (generic, cross-kind)
-- Tracks every bill / receipt photo uploaded via /ops/purchase/view/
-- (and any future bill-upload surface).  Source of truth for "what's
-- been uploaded", independent of Odoo ACL quirks on ir.attachment.
--
-- One row per uploaded file.  Multiple rows per entry_kind+entry_odoo_id
-- are fine (a PO can have multiple invoices, a bill can have front+back).
--
-- Provides the Drive view URL for each bill so the ledger UI can link
-- directly to the file in Google Drive without bouncing through Odoo.

CREATE TABLE IF NOT EXISTS bill_attachments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_kind          TEXT NOT NULL,                     -- PO | Expense | Bill
  entry_odoo_id       INTEGER NOT NULL,                  -- id in the corresponding Odoo model
  brand               TEXT,                              -- HE | NCH | HQ
  entry_date          TEXT,                              -- the entry's own date (YYYY-MM-DD) — convenience
  entry_amount        REAL,                              -- amount of the parent entry — convenience
  odoo_attachment_id  INTEGER,                           -- ir.attachment.id in Odoo (write-through)
  drive_file_id       TEXT,                              -- Google Drive file id
  drive_view_url      TEXT,                              -- https://drive.google.com/... clickable link
  drive_folder_path   TEXT,                              -- e.g. "2026-04/2026-04-20/NCH"
  filename            TEXT,
  mimetype            TEXT,
  file_size_kb        INTEGER,
  uploaded_by_pin     TEXT,
  uploaded_by_name    TEXT,
  uploaded_at         TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bill_att_entry    ON bill_attachments(entry_kind, entry_odoo_id);
CREATE INDEX IF NOT EXISTS idx_bill_att_uploaded ON bill_attachments(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_att_brand    ON bill_attachments(brand, entry_date);
