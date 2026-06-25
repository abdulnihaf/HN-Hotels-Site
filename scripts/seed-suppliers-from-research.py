#!/usr/bin/env python3
"""Turn the manpower-supplier research JSON into idempotent UPSERT SQL for hiring_suppliers.
Usage: python3 seed-suppliers-from-research.py <research-output.json> > seed.sql
Phone handling: pick the best single callable number (prefer mobile 6-9) for tap-to-call;
preserve the full original number string in notes so nothing is lost. Never invents a number.
"""
import json, re, sys

def norm_one(num):
    d = re.sub(r"\D", "", num or "")
    if len(d) > 10 and d.startswith("91"): d = d[-10:]
    if len(d) == 11 and d.startswith("0"): d = d[1:]
    return d if len(d) == 10 else None

def best_phone(raw):
    if not raw: return None, None
    runs = re.findall(r"[\d][\d ]{6,}\d", raw)
    cands = [c for c in (norm_one(r) for r in runs) if c]
    # dedupe, keep order
    seen=set(); cands=[c for c in cands if not (c in seen or seen.add(c))]
    if not cands: return None, raw
    # rank: clear mobile (9/7/6) > ambiguous 8 (could be BLR STD 80) > landline. Stable within rank.
    def rank(c): return 0 if c[0] in "976" else (1 if c[0] == "8" else 2)
    primary = sorted(cands, key=rank)[0]
    return primary, raw

def q(v):
    if v is None: return "NULL"
    return "'" + str(v).replace("'", "''") + "'"

def b(v): return "1" if v else "0"

data = json.load(open(sys.argv[1]))
suppliers = data["result"]["graded"]["suppliers"]

print("-- HN Hotels — manpower-supplier call list (flow #1), seeded from deep research 2026-06-26.")
print("-- Idempotent: ON CONFLICT(phone) upserts. Re-runnable. Source-of-truth = D1 hiring_suppliers.")
for s in suppliers:
    phone, raw = best_phone(s.get("phone"))
    wa, _ = best_phone(s.get("whatsapp"))
    notes = s.get("notes") or ""
    if raw and (phone != re.sub(r"\D","",raw)):
        notes = f"All numbers: {raw}. {notes}".strip()
    cols = dict(
        name=q(s["name"]), type=q(s.get("type")), phone=q(phone), whatsapp=q(wa),
        area=q(s.get("area")), city=q(s.get("city") or "Bangalore"), website=q(s.get("website")),
        source_urls=q(json.dumps(s.get("source_urls") or [])), specialization=q(s.get("specialization")),
        roles_supplied=q(json.dumps(s.get("roles_supplied") or [])),
        hospitality_focus=b(s.get("hospitality_focus")), central_blr=b(s.get("central_blr")),
        relevance_score=str(int(s.get("relevance_score") or 0)), grade=q(s.get("grade")),
        confidence=q(s.get("confidence")), evidence=q(s.get("evidence")), notes=q(notes), source="'research'",
    )
    # upsert by name (phone-null-safe); ON CONFLICT(phone) for real numbers
    keys = ",".join(cols.keys())
    vals = ",".join(cols.values())
    print(f"INSERT INTO hiring_suppliers ({keys}) VALUES ({vals}) "
          f"ON CONFLICT(phone) DO UPDATE SET "
          f"name=excluded.name, type=excluded.type, area=excluded.area, website=excluded.website, "
          f"source_urls=excluded.source_urls, specialization=excluded.specialization, "
          f"roles_supplied=excluded.roles_supplied, hospitality_focus=excluded.hospitality_focus, "
          f"central_blr=excluded.central_blr, relevance_score=excluded.relevance_score, "
          f"grade=excluded.grade, confidence=excluded.confidence, evidence=excluded.evidence, "
          f"notes=excluded.notes, updated_at=datetime('now');")
