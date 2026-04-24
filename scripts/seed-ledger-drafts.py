#!/usr/bin/env python3
"""
HN Ledger — Backfill draft generator.

Reads Tally's DayBook.xlsx export, filters to expense rows in the target
window (Feb 3 2026 → Apr 1 2026), maps each Tally account to the ledger
product we seeded in seed-ledger.sql, and emits SQL INSERTs for 'draft'
entries. Naveen then opens each one, fills qty+UOM+brand+vendor+photo,
and flips status → 'final'.

Idempotent: uses UNIQUE(tally_voucher_ref) — re-running does nothing.

Usage:
  python3 scripts/seed-ledger-drafts.py \
      --daybook ~/Downloads/DayBook.xlsx \
      --out seed-ledger-drafts.sql

Requires: openpyxl
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("pip install openpyxl")


# ── Date window ──
START = datetime(2026, 2, 3)
END   = datetime(2026, 4, 1)

# HE didn't start operations until Feb 27 — anything before that is NCH.
HE_START = datetime(2026, 2, 27)


# ── Tally account → (category_id, product_name) ──
# product_name must match seed-ledger.sql exactly.
ACCOUNT_MAP: dict[str, tuple[int, str]] = {
    # Raw Materials (1)
    'Chicken Purchase':                           (1, 'Chicken Purchase'),
    'Chicken Cutlet Purchase':                    (1, 'Chicken Cutlet Purchase'),
    'Mutton Purchase':                            (1, 'Mutton Purchase'),
    'Sajid - Brain Purchase':                     (1, 'Brain Purchase (Sajid)'),
    'Milk Purchase':                              (1, 'Milk Purchase'),
    'Milk Powder Purchase':                       (1, 'Milk Powder Purchase'),
    'Butter Purchase':                            (1, 'Butter Purchase'),
    'Ghee Purchase':                              (1, 'Ghee Purchase'),
    'Buns Purchase':                              (1, 'Buns Purchase'),
    'Rumali Roti':                                (1, 'Rumali Roti'),
    'Tea Powder Purchase':                        (1, 'Tea Powder Purchase'),
    'Oil Purchase':                               (1, 'Oil Purchase'),
    'Onion Purchase':                             (1, 'Onion Purchase'),
    'Vegitables, Fruits, Dairy, Staff Food':      (1, 'Vegetables / Fruits / Dairy / Staff Food'),
    'Groceries, Oils & Masalas Etc. - Shariff Store': (1, 'Groceries / Oils / Masalas — Shariff Store'),
    'Galaxy Bakery - Biscuts':                    (1, 'Biscuits — Galaxy Bakery'),
    'Osmania Loose Biscut Supply':                (1, 'Biscuits — Osmania (Loose)'),
    'Karachi Bakery - Biscuits':                  (1, 'Biscuits — Karachi Bakery'),
    'Nilofer - Biscuits':                         (1, 'Biscuits — Nilofer'),
    'Samosa Purchase':                            (1, 'Samosa Purchase'),
    'Cool Drinks Purchase':                       (1, 'Cool Drinks Purchase'),
    'Soft Drinks':                                (1, 'Soft Drinks'),
    'Horlicks & Boost & Coffee':                  (1, 'Horlicks / Boost / Coffee'),
    'Shawarma Raw materials':                     (1, 'Shawarma Raw Materials'),
    'Haleem Equipment & Items':                   (1, 'Haleem Raw Materials'),
    'Charcoal Purchase':                          (1, 'Charcoal Purchase'),
    'Cooking Wood':                               (1, 'Cooking Wood'),
    'Raw Material Purchase':                      (1, 'Raw Material Purchase (uncategorised)'),

    # Salaries (2)
    'Salary Expenses - Aadil':                    (2, 'Salary — Aadil'),
    'Salary Expenses - Ajim':                     (2, 'Salary — Ajim'),
    'Salary Expenses - Amin':                     (2, 'Salary — Amin'),
    'Salary Expenses - Ansu':                     (2, 'Salary — Ansu'),
    'Salary Expenses - Ashif':                    (2, 'Salary — Ashif'),
    'Salary Expenses - Bhasheer Bhai':            (2, 'Salary — Bhasheer'),
    'Salary Expenses - Cleaning Boys':            (2, 'Salary — Cleaning Boys'),
    'Salary Expenses - Dananjay':                 (2, 'Salary — Dananjay'),
    'Salary Expenses - Deeraj Kumar':             (2, 'Salary — Deeraj Kumar'),
    'Salary Expenses - Fahim':                    (2, 'Salary — Fahim'),
    'Salary Expenses - Faizal Ali':               (2, 'Salary — Faizal Ali'),
    'Salary Expenses - Faizan':                   (2, 'Salary — Faizan'),
    'Salary Expenses - Farooq':                   (2, 'Salary — Farooq'),
    'Salary Expenses - Farzaib':                  (2, 'Salary — Farzaib'),
    'Salary Expenses - Hamza':                    (2, 'Salary — Hamza'),
    'Salary Expenses - Hardev Singh':             (2, 'Salary — Hardev Singh'),
    'Salary Expenses - Jafar, Jahangeer, Aroop':  (2, 'Salary — Jafar / Jahangeer / Aroop'),
    'Salary Expenses - Kismat':                   (2, 'Salary — Kismat'),
    'Salary Expenses - Makbul':                   (2, 'Salary — Makbul'),
    'Salary Expenses - MD Akthar':                (2, 'Salary — MD Akthar'),
    'Salary Expenses - Mujib':                    (2, 'Salary — Mujib'),
    'Salary Expenses - Mumtaz':                   (2, 'Salary — Mumtaz'),
    'Salary Expenses - Nafeez Supervisor':        (2, 'Salary — Nafeez (Supervisor)'),
    'Salary Expenses - Nasim':                    (2, 'Salary — Nasim'),
    'Salary Expenses - Naveen Kumar':             (2, 'Salary — Naveen Kumar'),
    'Salary Expenses - Abdul Khader Nihaf':       (2, 'Salary — Nihaf (Abdul Khader)'),
    'Salary Expenses - Noim':                     (2, 'Salary — Noim'),
    'Salary Expenses - Noor':                     (2, 'Salary — Noor'),
    'Salary Expenses - Osim Akram SK':            (2, 'Salary — Osim Akram SK'),
    'Salary Expenses - Ranjan':                   (2, 'Salary — Ranjan'),
    'Salary Expenses - Riyaz':                    (2, 'Salary — Riyaz'),
    'Salary Expenses - Shabir':                   (2, 'Salary — Shabir'),
    'Salary Expenses - Sheru Khan':               (2, 'Salary — Sheru Khan'),
    'Salary Expenses - Somesh':                   (2, 'Salary — Somesh'),
    'Salary Expenses - Tabarak':                  (2, 'Salary — Tabarak'),
    'Salary Expenses - Tanveer Ahmed':            (2, 'Salary — Tanveer Ahmed'),
    'Salary Expenses - Velu':                     (2, 'Salary — Velu'),
    'Salary Expenses - Wasim':                    (2, 'Salary — Wasim'),
    'Salary Expenses - Yashwant Jodha':           (2, 'Salary — Yashwant Jodha'),
    'Salary Expenses - Zoya':                     (2, 'Salary — Zoya'),
    'Eid Bonus':                                  (2, 'Eid Bonus'),
    'Staff Bonus':                                (2, 'Staff Bonus'),
    'Payroll Commission':                         (2, 'Payroll Commission'),

    # Utilities (4)
    'Electricity Expenses':                       (4, 'Electricity Bill'),
    'Gas Cylinders':                              (4, 'Gas Cylinders'),
    'Gas Regulator Tap':                          (4, 'Gas Regulator Tap'),
    'Water Bottles':                              (4, 'Water Bottles'),
    'Water Cans':                                 (4, 'Water Cans'),
    'Water Pipes 30 Feet':                        (4, 'Water Pipes'),
    'Lan Connection Labour':                      (4, 'LAN / Cabling Labour'),

    # Operations / Petty (5)
    'Disposable Materials':                       (5, 'Disposable Materials'),
    'Cleaning Materials':                         (5, 'Cleaning Materials'),
    'Dust Bins':                                  (5, 'Dust Bins'),
    'Tissue Paper Bandal':                        (5, 'Tissue Paper Bundle'),
    'Tissue Paper Holders':                       (5, 'Tissue Paper Holders'),
    'Storage Cans':                               (5, 'Storage Cans'),
    'Stationary Purchase':                        (5, 'Stationery Purchase'),
    'Office Staff Food & Snacks':                 (5, 'Office Staff Food & Snacks'),
    'Staff Wellfare, Medicine Etc.':              (5, 'Staff Welfare / Medicine'),
    'Staff Wellfare - Tea Master':                (5, 'Staff Welfare — Tea Master'),
    'Floor Mats':                                 (5, 'Floor Mats'),
    'Floor Sleeping mat for Staff':               (5, 'Floor Sleeping Mat for Staff'),
    'Tea Cloth':                                  (5, 'Tea Cloth'),
    'Tea and coffee tokens':                      (5, 'Tea / Coffee Tokens'),
    'Cutting Board':                              (5, 'Cutting Board'),
    'Thermal Printer Rolls':                      (5, 'Thermal Printer Rolls'),
    'Knife Sharpener':                            (5, 'Knife Sharpener'),
    'No Smoking Boards':                          (5, 'No Smoking Boards'),
    'Table Number Signs':                         (5, 'Table Number Signs'),
    'Wiper and tap':                              (5, 'Wiper & Tap'),
    'Spaner Set':                                 (5, 'Spanner Set'),
    'News Paper':                                 (5, 'Newspaper'),
    'Iftar - Expenses':                           (5, 'Iftar Expenses'),
    'Misc. Expenses':                             (5, 'Misc. Petty Cash'),
    'Refund - Customer':                          (5, 'Refund — Customer'),
    'Double side tapes':                          (5, 'Double-side Tape'),
    'Uniform Purchase':                           (5, 'Uniform Purchase'),

    # Maintenance & Repair (6)
    'Deep Cleaning Expenses':                     (6, 'Deep Cleaning'),
    'Welder Expenses':                            (6, 'Welder Labour'),
    'Electrician Labour':                         (6, 'Electrician Labour'),
    'Electrical adapter':                         (6, 'Electrical Adapter'),
    'Malar Expenses':                             (6, 'Malar Expenses'),
    'Shaheen Expenses':                           (6, 'Shaheen Expenses'),
    'Garbage Expenses':                           (6, 'Garbage / Waste Disposal'),
    'BBMP Commission':                            (6, 'BBMP Commission'),

    # Marketing & Promotion (7)
    'Business Promotion Expenses':                (7, 'Business Promotion'),
    'Printing Expenses':                          (7, 'Printing (Flyers / Cards)'),
    'QR Codes Printing':                          (7, 'QR Codes Printing'),

    # Tech, SaaS & Banking (8)
    'Claude AI Subscription Charges':             (8, 'Claude AI Subscription'),
    'Federal Bank Charges':                       (8, 'Federal Bank Charges'),
    'HDFC Bank Charges':                          (8, 'HDFC Bank Charges'),
    'Naveen Bank Charges':                        (8, 'Naveen Bank Charges'),
    'Razorpay Gateway Charges':                   (8, 'Razorpay Gateway Charges'),
    'Paytm Charges':                              (8, 'Paytm Charges'),

    # Compliance & Legal (9)
    'Sparksol MCA Filings':                       (9, 'Sparksol MCA Filings'),

    # Police & Hafta (10)
    'Police Payment':                             (10, 'Police Payment'),

    # Transport & Logistics (12)
    'Rapido, Porter & Trasportation Expenses':    (12, 'Rapido / Porter / Transport'),
    'Petrol & Diesel Expenses':                   (12, 'Petrol & Diesel'),

    # Owner / Family Drawings (13)
    'Nihaf Expenses':                             (13, 'Nihaf — Personal Expenses'),
    'Tanveer Paid Out':                           (13, 'Tanveer — Paid Out'),
    'Juhaina Haneef - Withdrawal A/c':            (13, 'Juhaina Haneef — Withdrawal'),
    'Juvairia Haneef - Withdrawal A/c':           (13, 'Juvairia Haneef — Withdrawal'),
    'KM Haneef - Withdrawal A/c':                 (13, 'KM Haneef — Withdrawal'),

    # Capex & Equipment (11) — usually one-off purchases that did hit the period
    'Key Board & Other Accessories':              (11, 'Keyboard & Accessories'),
    'Windows Mini PC':                            (11, 'Windows Mini PC'),
    'Printer - Epson M30iii':                     (11, 'Epson M30iii Printer'),
    'Amazon Fire stick':                          (11, 'Amazon Fire Stick'),
    'Screen Guard for KDS':                       (11, 'Screen Guard for KDS'),
    'Coal Bhatti':                                (11, 'Coal Bhatti'),
    'Sreyans Printer':                            (11, 'Sreyans Printer'),
    'Acer Monitors':                              (11, 'Acer Monitor'),
    'AMS Monitors':                               (11, 'AMS Monitor'),
    'Wifi adapter':                               (11, 'Wifi Adapter'),
    'Android KDS Imin':                           (11, 'Android KDS (Imin)'),
    'Coin Box Purchase':                          (11, 'Coin Box'),
    'Tea Cups & Saucer':                          (11, 'Tea Cups & Saucer'),
    'Tea Equipment & Items':                      (11, 'Tea Equipment & Items'),
    'Cams Biometric System':                      (11, 'CAMS Biometric System'),
    'PC Mounts':                                  (11, 'PC Mount'),
    '6 to 16 Adapter':                            (11, '6-to-16 Adapter'),
    'Wifi Dongle':                                (11, 'Wifi Dongle'),
    'CCTV Cameras 8 Nos':                         (11, 'CCTV Camera'),
    'Thermal Printer - Barcode':                  (11, 'Thermal Barcode Printer'),
    'Barcode Scanner':                            (11, 'Barcode Scanner'),
    'Wifi Extender':                              (11, 'Wifi Extender'),
    'VGA Cables':                                 (11, 'VGA Cable'),
    'Weight Machine':                             (11, 'Weight Machine'),
    'Ceiling Mount 4 Nos':                        (11, 'Ceiling Mount'),
    'Extra Pipes for KDS':                        (11, 'Extra Pipes for KDS'),
    'Mixers':                                     (11, 'Mixer'),
    'Door Purchase & Fitting':                    (11, 'Door Purchase & Fitting'),
    'Air Condition':                              (11, 'Air Conditioner'),
    'Parking Stands - Iron':                      (11, 'Parking Stand (Iron)'),
    'Woven Purchase':                             (11, 'Woven Purchase'),
    'Godraj Locker':                              (11, 'Godraj Locker'),
    'Ethernet Connector':                         (11, 'Ethernet Connector'),

    # Utilities (4) — installations
    'Jio Wifi Installation':                      (4, 'Internet — Jio Wifi'),
    'ACT Fiber Net Installation':                 (4, 'Internet — ACT Fibre'),
    'BESCOM':                                     (4, 'Electricity Bill'),

    # Compliance (9)
    'Food Licence 2 Nos Nawabi & hamza express':  (9, 'FSSAI / Food Licence'),

    # Marketing (7)
    'Swiggy Zomato On Boarding (Nawabi, Express, Hamza)': (7, 'Swiggy / Zomato Onboarding'),

    # Vendor-named accounts that are really expenses (Tally duplication)
    'Shariff Departmental Store':                 (1, 'Groceries / Oils / Masalas — Shariff Store'),
    'M N Chicken':                                (1, 'Chicken Purchase'),
    'Security Deposti For Milk can':              (14, 'Uncategorised / Review'),
}

# Accounts to explicitly IGNORE — they are balance-sheet / payable / receivable
# entries, not P&L expenses. Quiet skip, don't warn.
SKIP_ACCOUNTS = {
    'Uncleared Collections',
    'Cash - Naveen',
    'Razorpay Receivables',
    'Paytm Receivables',
    'Nawabi Chai Complimentary',
    'Hamza Express Complimentary',
    'Mujib Paid Out',            # already tracked elsewhere
    'Bank Transfer in Transit',
}
# Any account ending with " - Salary Payable" OR " Salary Payable" is a liability
# accrual offsetting the actual "Salary Expenses - NAME" expense — skip it silently.


def sql_escape(s: str | None) -> str:
    if s is None:
        return 'NULL'
    return "'" + str(s).replace("'", "''") + "'"


def infer_brand(d: datetime) -> str | None:
    """NCH only before Feb 27; after that we leave it blank for Naveen to pick."""
    return 'NCH' if d < HE_START else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--daybook', required=True, type=Path)
    ap.add_argument('--out', required=True, type=Path)
    args = ap.parse_args()

    if not args.daybook.exists():
        sys.exit(f"DayBook not found: {args.daybook}")

    wb = openpyxl.load_workbook(args.daybook, data_only=True)
    ws = wb['Day Book']

    rows = []
    unmapped: dict[str, int] = {}
    for row in ws.iter_rows(values_only=True):
        if not row or not row[0] or not isinstance(row[0], datetime):
            continue
        d = row[0]
        if d < START or d > END:
            continue
        acc = row[1]
        debit = row[5] or 0
        if not acc or debit <= 0:
            continue
        if acc in SKIP_ACCOUNTS or acc.endswith('- Salary Payable') or acc.endswith(' Salary Payable'):
            continue
        if acc not in ACCOUNT_MAP:
            unmapped[acc] = unmapped.get(acc, 0) + 1
            continue

        cat_id, product_name = ACCOUNT_MAP[acc]
        vch_no = str(row[4]) if row[4] is not None else ''
        narration = row[2] or ''
        vch_type = row[3] or ''

        date_str = d.strftime('%Y-%m-%d')
        brand = infer_brand(d)
        # Composite key for idempotency: date + vch_no + amount
        tally_ref = f"{date_str}_{vch_type}_{vch_no}_{debit}"

        rows.append({
            'date': date_str,
            'brand': brand,
            'cat_id': cat_id,
            'product_name': product_name,
            'amount': float(debit),
            'voucher': vch_no,
            'narration': narration.strip(),
            'tally_account': acc,
            'tally_ref': tally_ref,
        })

    # Emit SQL
    with args.out.open('w') as f:
        f.write('-- HN Ledger — Tally backfill drafts (auto-generated)\n')
        f.write(f'-- Window: {START.date()} → {END.date()}\n')
        f.write(f'-- Source: {args.daybook.name}\n')
        f.write(f'-- Rows: {len(rows)}\n')
        f.write(f'-- Unmapped Tally accounts: {len(unmapped)}\n')
        f.write('-- Idempotent: UNIQUE(tally_voucher_ref) prevents dupes.\n')
        f.write('-- Run: wrangler d1 execute DB --remote --file=seed-ledger-drafts.sql\n\n')

        for r in rows:
            # Look up product_id by (category_id, name)
            # We use a subquery so this works even if product IDs shift later.
            notes = ''
            if r['narration']:
                notes = f"Tally narration: {r['narration']}"
            brand_sql = sql_escape(r['brand']) if r['brand'] else 'NULL'
            f.write(
                "INSERT OR IGNORE INTO ledger_entries "
                "(entry_date, brand, category_id, product_id, quantity, uom, amount, "
                "voucher_number, notes, status, tally_voucher_ref, tally_account_name, recorded_by) "
                f"VALUES ({sql_escape(r['date'])}, {brand_sql}, {r['cat_id']}, "
                f"(SELECT id FROM ledger_products WHERE category_id = {r['cat_id']} AND name = {sql_escape(r['product_name'])}), "
                f"0, '', {r['amount']}, {sql_escape(r['voucher'])}, {sql_escape(notes)}, "
                f"'draft', {sql_escape(r['tally_ref'])}, {sql_escape(r['tally_account'])}, 'tally-import');\n"
            )

    print(f"Wrote {len(rows)} draft inserts to {args.out}")
    if unmapped:
        print(f"\n{len(unmapped)} unmapped Tally accounts (will NOT be imported):")
        for acc, n in sorted(unmapped.items(), key=lambda x: -x[1]):
            print(f"  {n:4d}  {acc}")
        print("\nEither map them in ACCOUNT_MAP or skip — they're not expense accounts.")


if __name__ == '__main__':
    main()
