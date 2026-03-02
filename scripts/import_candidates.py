#!/usr/bin/env python3
"""
Import ALL candidates into D1 hn-hiring database.
Sources: Master DB CSV + APNA Cleaner XLSX + APNA Waiter XLSX
Applies role mapping logic from accurate_segment.py + merge_new_candidates.py
Outputs SQL files for wrangler d1 execute
"""

import csv, json, os, re, sys
from pathlib import Path

# ── Config ──
MASTER_CSV = "/Users/nihaf/Downloads/HN Hotels MASTER DB - Master.csv"
APNA_CLEANER = "/Users/nihaf/Downloads/Cleaner - Bengaluru.xlsx"
APNA_WAITER = "/Users/nihaf/Downloads/Waiter _ Steward - Bengaluru.xlsx"
OUTPUT_DIR = "/Users/nihaf/Documents/Tech/HN-Hotels-Site"
BLACKLIST = {"6300884055","8310682942","8971411805","7411583498","8123730695",
             "9945369498","8867423853","7019640837","9845786498","7892591498",
             "7619197498","6364890498","9036278498","7349738498","8217536498",
             "8073591498","7760923498","9164520498"}

# ── 17 Standard Roles ──
STANDARD_ROLES = [
    "Indian Cook", "Tandoor Cook", "Chinese Cook", "Fried Chicken Cook",
    "Shawarma Cook", "Juice Maker", "Shawaya Cook", "Mandi Cook",
    "Supervisor", "Cashier", "Captain", "Waiter", "Kitchen Helper",
    "Cleaner", "Washer", "Tea Master", "Fried Snacks Cook"
]

# ── Role Mapping: APNA DB role → HE standard role ──
PRIMARY_ROLE_MAP = {
    "Operations Manager":       "Captain",
    "Shift Supervisor":         "Supervisor",
    "Captain":                  "Captain",
    "Cashier":                  "Cashier",
    "Waiter / Steward":         "Waiter",
    "Counter Boy / Server":     "Waiter",
    "Irani Chai Master":        "Tea Master",
    "Juice & Mojitos Maker":    "Juice Maker",
    "Kitchen Helper":           "Kitchen Helper",
    "Cleaner":                  "Cleaner",
    "Shawarma Maker":           "Shawarma Cook",
    "Grill / Shawaya Maker":    "Shawaya Cook",
    "Tandoor Cook Assistant":   "Tandoor Cook",
    "Tandoor Cook Lead":        "Tandoor Cook",
    "Indian Cook Lead":         "Indian Cook",
    "Indian Cook Assistant":    "Indian Cook",
    "Chinese Cook Lead":        "Chinese Cook",
    "Chinese Cook Assistant":   "Chinese Cook",
    "FC / Hamza Bites Cook":    "Fried Chicken Cook",
    "Quick Bites / Display Creator": "Fried Snacks Cook",
    "Porotta Maker":            "Indian Cook",
    # APNA applied roles
    "Cleaner - Bengaluru":      "Cleaner",
    "Waiter _ Steward - Bengaluru": "Waiter",
}

# ── Title keyword → role override ──
TITLE_OVERRIDES = [
    (["shawarma"],              "Shawarma Cook"),
    (["shawaya", "grill"],      "Shawaya Cook"),
    (["tandoor", "tandoori"],   "Tandoor Cook"),
    (["juice", "mojito", "bartender"], "Juice Maker"),
    (["chinese", "wok"],        "Chinese Cook"),
    (["fried chicken", "fc cook", "fryer"], "Fried Chicken Cook"),
    (["mandi", "mandhi"],       "Mandi Cook"),
    (["tea master", "chai"],    "Tea Master"),
    (["snack", "display"],      "Fried Snacks Cook"),
    (["dishwash", "washer", "vessel"], "Washer"),
    (["indian cook", "south indian", "north indian"], "Indian Cook"),
    (["captain", "floor manager", "restaurant manager"], "Captain"),
    (["cashier", "billing"],    "Cashier"),
    (["waiter", "steward", "server"], "Waiter"),
    (["cleaner", "housekeep", "janitor", "sweeper"], "Cleaner"),
    (["supervisor", "shift lead"], "Supervisor"),
    (["helper", "kitchen helper", "commi"], "Kitchen Helper"),
]

# ── Salary map ──
SALARY_MAP = {
    "Shawarma Cook": "₹30,000", "Shawaya Cook": "₹30,000",
    "Indian Cook": "₹25,000", "Tandoor Cook": "₹25,000",
    "Chinese Cook": "₹25,000", "Mandi Cook": "₹25,000",
    "Captain": "₹22,000", "Cashier": "₹22,000", "Supervisor": "₹22,000",
    "Fried Chicken Cook": "₹21,000", "Fried Snacks Cook": "₹20,000",
    "Tea Master": "₹20,000",
    "Juice Maker": "₹18,000", "Waiter": "₹18,000",
    "Kitchen Helper": "₹18,000", "Cleaner": "₹18,000",
    "Washer": "₹18,000",
}

def parse_salary(s):
    """Parse salary string to monthly number."""
    if not s: return 0
    s = str(s).lower().strip()
    s = s.replace(",", "").replace("₹", "").replace("rs", "").replace("inr", "")
    s = s.replace("per month", "").replace("/month", "").replace("p.m", "").strip()
    m = re.search(r"(\d+\.?\d*)\s*k", s)
    if m: return int(float(m.group(1)) * 1000)
    m = re.search(r"(\d+)", s)
    if m:
        v = int(m.group(1))
        return v if v > 500 else v * 1000  # "35" → 35000, "35000" → 35000
    return 0

def determine_role(row):
    """Determine HE standard role from candidate data."""
    # Check current title for keyword overrides
    title = (row.get("Current Job Title") or "").lower()
    prev_title = (row.get("Previous Job Title") or "").lower()
    skills = (row.get("Skills") or "").lower()
    all_text = f"{title} {prev_title} {skills}"

    for keywords, role in TITLE_OVERRIDES:
        for kw in keywords:
            if kw in title:
                return role

    # Primary role map
    db_role = row.get("Role") or row.get("Job Applied For") or ""
    if db_role in PRIMARY_ROLE_MAP:
        return PRIMARY_ROLE_MAP[db_role]

    # Check previous title keywords
    for keywords, role in TITLE_OVERRIDES:
        for kw in keywords:
            if kw in prev_title:
                return role

    # Skill-based
    for keywords, role in TITLE_OVERRIDES:
        for kw in keywords:
            if kw in skills:
                return role

    # All Roles field
    all_roles = (row.get("All Roles") or "").lower()
    role_priority = ["shawarma", "shawaya", "grill", "tandoor", "indian cook",
                     "chinese cook", "captain", "cashier", "juice", "waiter",
                     "cleaner", "helper", "tea", "fried"]
    for rp in role_priority:
        if rp in all_roles:
            for keywords, role in TITLE_OVERRIDES:
                for kw in keywords:
                    if kw == rp or rp in kw:
                        return role

    # Default: Kitchen Helper
    return "Kitchen Helper"

def clean_name(name):
    """Clean candidate first name."""
    if not name: return ""
    name = re.sub(r'^(HE|OLC|NCH|CPT|WTR|CSH|JM|KH|CLN)-?\w*-?\d*\s*', '', str(name)).strip()
    name = re.sub(r'^(Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Md\.?|Sk\.?|Sheikh)\s+', '', name, flags=re.IGNORECASE).strip()
    parts = name.split()
    first = parts[0] if parts else name
    first = first.strip().title()
    if len(first) <= 1 or not first.isalpha():
        return ""
    return first

def clean_title(title):
    """Clean job title."""
    if not title: return ""
    title = str(title).strip()
    # Take first title if comma-separated
    if "," in title:
        title = title.split(",")[0].strip()
    # Smart title case preserving F&B terms
    preserve = {"F&B", "CDP", "DCDP", "QSR", "KFC", "CCD", "GM", "AGM"}
    words = title.split()
    result = []
    for w in words:
        if w.upper() in preserve:
            result.append(w.upper())
        else:
            result.append(w.title())
    return " ".join(result)[:60]

def clean_company(company):
    """Clean company name."""
    if not company: return ""
    company = str(company).strip()
    # Strip legal suffixes
    company = re.sub(r'\s*(Pvt\.?\s*Ltd\.?|Private\s+Limited|Limited|LLP|Inc\.?|Corp\.?)\.?\s*$', '', company, flags=re.IGNORECASE).strip()
    if len(company) <= 1: return ""
    return company[:60]

def is_bangalore(city):
    """Check if city is Bangalore."""
    if not city: return False
    c = str(city).lower().strip()
    return any(x in c for x in ["bangalore", "bengaluru", "bangalor", "blr"])

def escape_sql(s):
    if s is None: return ""
    return str(s).replace("'", "''")

# ═══════════════════════════════════════
# MAIN
# ═══════════════════════════════════════
print("=" * 60)
print("Candidate Database Import → D1")
print("=" * 60)

# ── Read Master CSV ──
print("\n[1/4] Reading Master DB...")
with open(MASTER_CSV, encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    master = list(reader)
print(f"  → {len(master)} candidates")

# ── Read APNA XLSX ──
print("\n[2/4] Reading APNA exports...")
try:
    import openpyxl
except ImportError:
    print("  Installing openpyxl...")
    os.system(f"{sys.executable} -m pip install openpyxl -q")
    import openpyxl

apna_candidates = []
for xlsx_path, applied_role in [(APNA_CLEANER, "Cleaner"), (APNA_WAITER, "Waiter")]:
    if not os.path.exists(xlsx_path):
        print(f"  ⚠ Not found: {xlsx_path}")
        continue
    wb = openpyxl.load_workbook(xlsx_path, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    headers = [str(h).strip() if h else f"col_{i}" for i, h in enumerate(rows[0])]
    for row in rows[1:]:
        d = dict(zip(headers, row))
        # Map APNA columns to master format
        phone = str(d.get("Phone number") or "").replace(" ", "").replace("+91", "")
        phone = re.sub(r'\D', '', phone)[-10:]
        if len(phone) != 10: continue
        apna_candidates.append({
            "Phone": phone,
            "Name": d.get("Candidate Name") or "",
            "Role": applied_role,
            "City": d.get("Candidate city") or d.get("Job city") or "Bangalore",
            "Age": str(d.get("Age") or ""),
            "Gender": str(d.get("Gender") or "").lower()[:1],
            "Education": d.get("Education") or "",
            "Highest Degree": d.get("Highest Degree") or "",
            "English Level": d.get("English Level") or "",
            "Years of Experience": d.get("Experience") or "",
            "Current Job Title": d.get("Current Job role") or "",
            "Current Company": d.get("Current Company") or "",
            "Previous Job Title": "",
            "Previous Company": "",
            "Current Salary": "",
            "Expected Salary": "",
            "Skills": d.get("Assets") or "",
            "All Roles": applied_role,
            "Is WA Accessible": "",
            "Job Applied For": applied_role,
            "Sources List": "APNA",
            "_source": "apna",
        })
    wb.close()
    print(f"  → {xlsx_path.split('/')[-1]}: {len([c for c in apna_candidates if c.get('Role') == applied_role])} candidates")

# ── Deduplicate ──
print("\n[3/4] Deduplicating & mapping roles...")
seen_phones = set()
all_candidates = []

# Master first
for row in master:
    phone = re.sub(r'\D', '', str(row.get("Phone") or ""))[-10:]
    if len(phone) != 10 or phone in seen_phones or phone in BLACKLIST:
        continue
    seen_phones.add(phone)
    row["Phone"] = phone
    row["_source"] = "master"
    all_candidates.append(row)

# Then APNA (deduped)
apna_new = 0
for row in apna_candidates:
    phone = row["Phone"]
    if phone in seen_phones or phone in BLACKLIST:
        continue
    seen_phones.add(phone)
    all_candidates.append(row)
    apna_new += 1

print(f"  → Master: {len(all_candidates) - apna_new}, APNA new: {apna_new}")
print(f"  → Total unique: {len(all_candidates)}")

# ── Assign roles and build records ──
role_counts = {}
records = []

for row in all_candidates:
    phone = row["Phone"]
    he_role = determine_role(row)
    salary = SALARY_MAP.get(he_role, "₹18,000")

    name = row.get("Name") or ""
    first_name = clean_name(name)
    title = clean_title(row.get("Current Job Title") or "")
    company = clean_company(row.get("Current Company") or "")
    city = row.get("City") or ""
    is_blr = is_bangalore(city)
    exp = row.get("Years of Experience") or ""
    current_salary = parse_salary(row.get("Current Salary") or "")
    source = row.get("_source") or row.get("Sources List") or ""

    # Personalization readiness
    has_personalization = bool(first_name and title and company)

    records.append({
        "phone": phone,
        "name": escape_sql(name),
        "first_name": escape_sql(first_name),
        "he_role": escape_sql(he_role),
        "he_salary": escape_sql(salary),
        "db_role": escape_sql(row.get("Role") or ""),
        "current_title": escape_sql(title),
        "current_company": escape_sql(company),
        "previous_title": escape_sql(row.get("Previous Job Title") or ""),
        "previous_company": escape_sql(row.get("Previous Company") or ""),
        "city": escape_sql(city),
        "is_bangalore": 1 if is_blr else 0,
        "experience": escape_sql(exp),
        "current_salary": current_salary,
        "skills": escape_sql((row.get("Skills") or "")[:200]),
        "english_level": escape_sql(row.get("English Level") or ""),
        "education": escape_sql(row.get("Education") or ""),
        "age": escape_sql(row.get("Age") or ""),
        "gender": escape_sql(row.get("Gender") or ""),
        "has_personalization": 1 if has_personalization else 0,
        "source": escape_sql(source),
        "wa_accessible": escape_sql(row.get("Is WA Accessible") or ""),
    })

    role_counts[he_role] = role_counts.get(he_role, 0) + 1

# ── Print role distribution ──
print("\n  Role distribution:")
for role in sorted(role_counts.keys(), key=lambda r: -role_counts[r]):
    print(f"    {role:25s} {role_counts[role]:>5}")
print(f"    {'TOTAL':25s} {len(records):>5}")

# ── Generate SQL ──
print("\n[4/4] Generating SQL files...")

# Schema
schema_sql = """-- Candidates table for hn-hiring D1
-- Run: wrangler d1 execute hn-hiring --remote --file=schema-candidates.sql

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  first_name TEXT,
  he_role TEXT NOT NULL,
  he_salary TEXT,
  db_role TEXT,
  current_title TEXT,
  current_company TEXT,
  previous_title TEXT,
  previous_company TEXT,
  city TEXT,
  is_bangalore INTEGER DEFAULT 0,
  experience TEXT,
  current_salary INTEGER DEFAULT 0,
  skills TEXT,
  english_level TEXT,
  education TEXT,
  age TEXT,
  gender TEXT,
  has_personalization INTEGER DEFAULT 0,
  source TEXT,
  wa_accessible TEXT,
  campaign_status TEXT DEFAULT 'none',
  last_campaign_id INTEGER,
  last_contacted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (last_campaign_id) REFERENCES campaigns(id)
);

CREATE INDEX IF NOT EXISTS idx_candidates_phone ON candidates(phone);
CREATE INDEX IF NOT EXISTS idx_candidates_role ON candidates(he_role);
CREATE INDEX IF NOT EXISTS idx_candidates_bangalore ON candidates(is_bangalore);
CREATE INDEX IF NOT EXISTS idx_candidates_personalization ON candidates(has_personalization);
CREATE INDEX IF NOT EXISTS idx_candidates_campaign_status ON candidates(campaign_status);
"""

with open(os.path.join(OUTPUT_DIR, "schema-candidates.sql"), "w") as f:
    f.write(schema_sql)
print(f"  → schema-candidates.sql")

# Data in batches
BATCH_SIZE = 80
batch_num = 0
batch = []

for r in records:
    batch.append(
        f"INSERT OR IGNORE INTO candidates "
        f"(phone, name, first_name, he_role, he_salary, db_role, "
        f"current_title, current_company, previous_title, previous_company, "
        f"city, is_bangalore, experience, current_salary, skills, "
        f"english_level, education, age, gender, has_personalization, source, wa_accessible) "
        f"VALUES ('{r['phone']}', '{r['name']}', '{r['first_name']}', '{r['he_role']}', '{r['he_salary']}', '{r['db_role']}', "
        f"'{r['current_title']}', '{r['current_company']}', '{r['previous_title']}', '{r['previous_company']}', "
        f"'{r['city']}', {r['is_bangalore']}, '{r['experience']}', {r['current_salary']}, '{r['skills']}', "
        f"'{r['english_level']}', '{r['education']}', '{r['age']}', '{r['gender']}', {r['has_personalization']}, '{r['source']}', '{r['wa_accessible']}');"
    )

    if len(batch) >= BATCH_SIZE:
        batch_num += 1
        fname = f"import-candidates-{batch_num:02d}.sql"
        with open(os.path.join(OUTPUT_DIR, fname), "w") as f:
            f.write(f"-- Candidates batch {batch_num}\n")
            f.write("\n".join(batch) + "\n")
        batch = []

if batch:
    batch_num += 1
    fname = f"import-candidates-{batch_num:02d}.sql"
    with open(os.path.join(OUTPUT_DIR, fname), "w") as f:
        f.write(f"-- Candidates batch {batch_num}\n")
        f.write("\n".join(batch) + "\n")

print(f"  → {batch_num} batch files (import-candidates-01.sql .. {batch_num:02d}.sql)")

# Link already-sent candidates
link_sql = """-- Link candidates to already-sent messages
-- Run after candidates are imported

UPDATE candidates SET campaign_status = 'sent', last_contacted_at = '2026-03-01 13:30:00'
WHERE phone IN (SELECT phone FROM messages WHERE status IN ('sent', 'delivered', 'read'));

UPDATE candidates SET last_campaign_id = (
  SELECT m.campaign_id FROM messages m WHERE m.phone = candidates.phone ORDER BY m.id DESC LIMIT 1
) WHERE campaign_status = 'sent';
"""
with open(os.path.join(OUTPUT_DIR, "link-candidates-campaigns.sql"), "w") as f:
    f.write(link_sql)
print(f"  → link-candidates-campaigns.sql")

print(f"\n✅ Done! Run in order:")
print(f"   1. wrangler d1 execute hn-hiring --remote --file=schema-candidates.sql")
print(f"   2. wrangler d1 execute hn-hiring --remote --file=import-candidates-XX.sql (01-{batch_num:02d})")
print(f"   3. wrangler d1 execute hn-hiring --remote --file=link-candidates-campaigns.sql")
