# /ops/hr Contract Workflow — Engineering Spec

**Status:** Phase 1 (view-existing) ready; Phase 2 (new employee onboarding) specced for next session
**Audience:** Owner / engineering follow-up

---

## Phase 1 — View Contracts (Done in this session)

### What changed in code

| File | Change |
|---|---|
| `ops/hr/index.html` | Added `contractBadge()` function + invocation in employee row template |
| `schema-hr-contract.sql` | NEW — D1 migration for contract tracking columns |
| `/tmp/upload-contracts-to-drive.py` | NEW — local script to upload 31 PDFs to Drive |

### What you do to deploy Phase 1

```bash
# 1. Run D1 migration (adds 7 columns to hr_employees)
cd /Users/nihaf/Documents/Tech/HN-Hotels-Site
wrangler d1 execute <DB-NAME> --file=schema-hr-contract.sql

# 2. Get gcloud auth for Drive write access
gcloud auth application-default login --scopes='https://www.googleapis.com/auth/drive'

# 3. Upload 31 contracts to per-employee Drive folders
python3 /tmp/upload-contracts-to-drive.py
# Outputs:
#   /tmp/contract-upload-results.json
#   /tmp/contract-d1-migration.sql  (UPDATE statements with file IDs)

# 4. Apply the file IDs to D1
wrangler d1 execute <DB-NAME> --file=/tmp/contract-d1-migration.sql

# 5. Deploy /ops/hr (Cloudflare Pages auto-deploys on push to main)
git add ops/hr/index.html schema-hr-contract.sql
git commit -m "Add contract view badge + D1 schema for Leegality tracking"
git push
```

### What it looks like after deployment

Each employee row in `/ops/hr` now shows a "📄 Contract" badge:
- 🟡 **"📄 Contract pending"** — no PDF uploaded yet
- 🔵 **"📄 Contract Review"** — uploaded, click to open PDF in Drive, approve before sending
- 🟢 **"📄 Contract Approved"** — owner approved, ready for Leegality
- 🟣 **"📄 Contract eSign sent"** — sent to employee via Leegality
- ✓ **"📄 Contract Signed ✓"** — fully signed

Click the badge → opens PDF in new tab in Google Drive viewer. Owner reviews each, then approves via API or modal action.

---

## Phase 2 — New Employee Onboarding UX (Spec for next session)

### Goal

When you click `+ New` on /ops/hr to add an employee, the system should:
1. Capture all details in one form
2. Auto-classify which template (A/B/C) applies based on wage
3. Auto-generate the Letter + Service Rules + Form 11 PDF
4. Upload to Drive
5. Trigger Leegality eSign request
6. All in one click

This eliminates the multi-step process: add employee → manually generate doc → manually upload → manually send to Leegality.

### Form Fields (in modal)

```
┌──────────────────────────────────────────────────┐
│  Add New Employee — HN Hotels                     │
│                                                    │
│  IDENTITY                                          │
│  Legal Name (as Aadhaar) [____________________]   │
│  Known As / Nickname     [____________________]   │
│  Phone (Aadhaar-linked)  [____________________]   │
│  Aadhaar Number          [____________________]   │
│  DOB (DD/MM/YYYY)        [____________________]   │
│  Gender [Male ▾]                                   │
│                                                    │
│  ROLE & ESTABLISHMENT                              │
│  Establishment [Hamza Express ▾]                   │
│  Department    [HE - Kitchen ▾]                    │
│  Job Title     [Tandoor Cook ▾]                    │
│  Date of Joining [01/06/2026]                      │
│                                                    │
│  COMPENSATION                                      │
│  Pay Type [Monthly ⚪ | Contract (Daily Wage) ⚪]  │
│  ─────────────────────────────────────             │
│  IF Monthly:                                       │
│    Monthly CTC     [₹ ____]                        │
│    Auto-detected template: [Template ___]          │
│  IF Contract:                                      │
│    Daily Rate      [₹ ____ ]                       │
│    Monthly equivalent (30 days): ₹ _____           │
│                                                    │
│  CONTRACT EFFECTIVE FROM [01/06/2026]              │
│                                                    │
│  PROBATION                                         │
│  ☑ Apply 6-month probation per Service Rules §8   │
│                                                    │
│  Save & Generate Contract  [Save Only]             │
└──────────────────────────────────────────────────┘
```

### Auto-classification Logic (client-side)

```javascript
function determineTemplate(payType, monthlyEquivalent) {
  if (payType === 'Contract' && monthlyEquivalent <= 21000) {
    return monthlyEquivalent === 21000 ? 'B' : 'A';  // wage bump or ESI restructure
  }
  if (payType === 'Monthly' && monthlyEquivalent <= 21000) {
    return monthlyEquivalent === 21000 ? 'B' : 'A';
  }
  return 'C';  // above ESI ceiling
}
```

### Backend Flow on "Save & Generate Contract"

```
Client → POST /api/hr-admin?action=add-employee-with-contract
              { all form fields }
                  ↓
Worker (functions/api/hr-admin.js):
  1. INSERT INTO hr_employees (...) VALUES (...)
  2. Create employee Drive folder (use Drive API)
  3. Generate contract PDF (call new endpoint /api/generate-contract)
       - Loads template (A/B/C) based on auto-classification
       - Fills with employee data
       - Service Rules with their pay_type variant (Monthly/Contract)
       - Form 11 with their personal details
       - Output: PDF blob
  4. Upload PDF to Drive folder
  5. Update employee row: contract_drive_id, contract_status='pending_review'
  6. Optional: trigger Leegality eSign send
       - call Leegality API (when integrated)
       - update leegality_doc_id, leegality_sent_at
       - status → 'sent_leegality'
  7. Return employee record + contract URL
                  ↓
Client: refresh employee list, show "Contract generated + sent" toast
```

### Code Files to Build (next session)

1. **`functions/api/hr-admin.js`** — add new actions:
   - `add-employee-with-contract` (the main flow)
   - `generate-contract` (loads templates, generates PDF)
   - `approve-contract` (owner approval after review)
   - `send-to-leegality` (triggers eSign)

2. **`functions/api/_lib/contract-generator.js`** — new module:
   - Port the JavaScript generator from `/tmp/hn-letters-build/generate-final.js`
   - Make it run in Cloudflare Worker context (no fs, use ArrayBuffer)
   - Outputs PDF blob → Drive upload

3. **`ops/hr/index.html`** — modal enhancements:
   - Add Pay Type radio + auto-determine template
   - Add "Save & Generate Contract" button
   - Loading state while contract generates
   - Show generated contract URL on success

4. **`functions/api/leegality-webhook.js`** — Leegality status webhook:
   - Receives signature events
   - Updates `contract_status` and `leegality_signed_at`
   - Triggers downstream automation (ESIC IP enrollment, etc.)

### Estimated Build Time (next session)

| Component | Time |
|---|---|
| Port docx-js generator to Worker context | 2-3 hrs (docx-js works in V8; needs ArrayBuffer adapter) |
| Drive API upload from Worker | 1 hr |
| Leegality API integration | 1-2 hrs |
| /ops/hr modal UI changes | 1-2 hrs |
| Webhook + status sync | 1 hr |
| Testing end-to-end | 1-2 hrs |
| **Total** | **7-11 hours** |

This is a real engineering project. Best done in a focused session with the user available for testing.

---

## Phase 3 — Bulk Operations (post-Phase 2)

Once Phase 2 is live:

| Action | Bulk capability |
|---|---|
| Send all `pending_review` contracts to Leegality | One button: "Approve all + send to Leegality" |
| Re-send to non-responders after 7 days | Cron job + Leegality reminder API |
| Generate contract amendments (annual revisions, salary changes) | Versioned templates |
| Auto-archive on employee exit | Move Drive folder to "Archived/" subfolder |

---

## Quick-Reference Glossary

| Term | Meaning |
|---|---|
| **contract_drive_id** | Google Drive file ID of the signed/unsigned PDF |
| **contract_status** | State machine: not_uploaded → pending_review → approved → sent_leegality → signed |
| **leegality_doc_id** | Leegality's internal doc ID for tracking signature status |
| **leegality_signed_pdf_id** | Drive file ID of the SIGNED PDF (after Leegality returns it) |
| **contract_effective_date** | "Effective from" date on the offer letter (e.g., 2026-05-01) |

---

## Status Right Now (after this session)

- ✅ Phase 1 code changes in repo (UI badge + SQL migration ready to deploy)
- ✅ Per-employee PDFs ready at `~/Desktop/HN_Hotels_Compliance_Letters_2026-05-07/Per_Employee_Bundles/`
- ✅ Upload script ready at `/tmp/upload-contracts-to-drive.py`
- ⏳ Phase 1 deployment requires: D1 migration + Drive auth + script run + Cloudflare push (~15 min)
- ⏳ Phase 2 is specced; next session
