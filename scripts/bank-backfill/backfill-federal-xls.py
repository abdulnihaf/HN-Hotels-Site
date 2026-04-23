#!/usr/bin/env python3
"""
backfill-federal-xls.py — convert a Federal Bank Account Statement .xls
into SQL INSERT OR IGNORE statements for the money_events table.

SCAFFOLD (2026-04-23): Federal NetBanking access is live but the XLS
column layout hasn't been observed yet. When the first statement is
exported:
  1. Run this script with --inspect to print the first 40 rows as-is.
  2. Update COLUMN_MAP + DATE_COL_NAMES to match Federal's headers.
  3. Re-run normally to emit SQL.

Usage:
    pip3 install --user xlrd pandas openpyxl
    python3 scripts/bank-backfill/backfill-federal-xls.py \\
        /path/to/Federal_Statement_XXXXX4510_DDMMYYYY.xls \\
        > data/bank/backfill-federal-4510.sql

    # Inspect first:
    python3 scripts/bank-backfill/backfill-federal-xls.py --inspect path.xls

    # Load:
    wrangler d1 execute hn-hiring --remote --file=data/bank/backfill-federal-4510.sql

Idempotent: (source, source_ref, direction, amount_paise, txn_at) is
the dedup key. Synthetic refs for null-ref rows are namespaced by the
statement's earliest-txn month (FED_YYYYMM_NNNN) so cross-statement
reruns don't collide.
"""

from __future__ import annotations
import sys, re, os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collections import defaultdict

import pandas as pd

IST = timezone(timedelta(hours=5, minutes=30))
INSTRUMENT = 'federal_sa_4510'
SOURCE = 'federal'

# Column map — UPDATE this once you've inspected a real Federal XLS.
# Common Federal columns include: Date | Narration | Chq./Ref.No. |
# Value Dt | Withdrawal Amt | Deposit Amt | Closing Balance. Confirm
# against actual export and adjust.
EXPECTED_HEADERS = ['date', 'narration', 'ref', 'value_dt',
                    'debit', 'credit', 'balance']

# Header-row detection hints — anchor tokens that almost always appear
# in Federal statement headers.
HEADER_ANCHORS = ['Narration', 'Withdrawal', 'Deposit', 'Closing Balance']


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Narration classifier — Federal-specific.
# Stub: handles obvious UPI/IMPS/NEFT/CHQ/salary patterns. Expand once
# real narrations are visible.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def classify(narration: str, direction: str = 'debit') -> dict:
    """Returns channel + counterparty hints for a Federal narration.
    source stays 'federal' always; aggregator tags go to settlement_platform.
    """
    n = str(narration).strip()
    base = _channel_only(n)
    base['settlement_platform'] = _platform_tag(n)
    return base


def _platform_tag(n: str) -> str | None:
    for pat, tag in [
        (re.compile(r'RAZORPAY',       re.I), 'razorpay'),
        (re.compile(r'ZOMATO',         re.I), 'zomato_delivery'),
        (re.compile(r'SWIGGY',         re.I), 'swiggy'),
        (re.compile(r'EAZY\s*DINER',   re.I), 'eazydiner'),
        (re.compile(r'PAYTM',          re.I), 'paytm'),
        (re.compile(r'POWERACCESS',    re.I), 'razorpay'),
    ]:
        if pat.search(n):
            return tag
    return None


def _channel_only(n: str) -> dict:
    # UPI / IMPS / NEFT / RTGS / CHQ — kept simple until real Federal
    # narrations are inspected. Federal often prefixes with "UPI/", "IMPS/".
    if re.search(r'\bUPI\b', n, re.I):  return dict(channel='upi', counterparty=_tidy(n), counterparty_ref=None, narration_tidy=n)
    if re.search(r'\bIMPS\b', n, re.I): return dict(channel='imps', counterparty=_tidy(n), counterparty_ref=None, narration_tidy=n)
    if re.search(r'\bNEFT\b', n, re.I): return dict(channel='neft', counterparty=_tidy(n), counterparty_ref=None, narration_tidy=n)
    if re.search(r'\bRTGS\b', n, re.I): return dict(channel='rtgs', counterparty=_tidy(n), counterparty_ref=None, narration_tidy=n)
    if re.search(r'\bCHQ|CHEQUE\b', n, re.I): return dict(channel='cheque', counterparty=_tidy(n), counterparty_ref=None, narration_tidy=n)
    if re.search(r'\bATM\b', n, re.I):  return dict(channel='atm', counterparty='ATM', counterparty_ref=None, narration_tidy=n)
    if re.search(r'INT\.|INTEREST', n, re.I): return dict(channel='interest', counterparty='FEDERAL BANK INTEREST', counterparty_ref=None, narration_tidy=n)
    if re.search(r'CHGS|CHARGE|GST|IGST|CGST|SGST', n, re.I):
        return dict(channel='charges', counterparty='FEDERAL BANK CHARGES', counterparty_ref=None, narration_tidy=n)
    return dict(channel='unknown', counterparty=_tidy(n)[:60], counterparty_ref=None, narration_tidy=n)


def _tidy(s: str) -> str:
    return re.sub(r'\s+', ' ', str(s)).strip()[:80]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# XLS → rows
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def inspect_xls(path: str) -> None:
    """Print the first 40 rows of the XLS raw for header-mapping review."""
    df = pd.read_excel(path, header=None)
    for i in range(min(40, len(df))):
        row = [str(v)[:30] for v in df.iloc[i].values]
        print(f'{i:>3}: {row}', file=sys.stderr)


def parse_xls(path: str) -> list[dict]:
    df = pd.read_excel(path, header=None)
    header_idx = None
    for i in range(min(40, len(df))):
        row = [str(v) for v in df.iloc[i].values]
        hits = sum(1 for anchor in HEADER_ANCHORS
                   for cell in row if anchor.lower() in cell.lower())
        if hits >= 2:
            header_idx = i
            break
    if header_idx is None:
        print('ERROR: could not locate header row in Federal XLS.', file=sys.stderr)
        print('Run with --inspect to see raw rows, then update EXPECTED_HEADERS.', file=sys.stderr)
        sys.exit(2)

    data = df.iloc[header_idx + 1:].copy()
    # EXPECTED_HEADERS must line up with Federal's column order. Adjust
    # if the observed order differs.
    if data.shape[1] < len(EXPECTED_HEADERS):
        print(f'ERROR: expected ≥{len(EXPECTED_HEADERS)} cols, got {data.shape[1]}', file=sys.stderr)
        sys.exit(2)
    data.columns = EXPECTED_HEADERS[:data.shape[1]] + \
                   [f'col_{i}' for i in range(data.shape[1] - len(EXPECTED_HEADERS))]

    # Accept DD/MM/YY or DD-MM-YYYY (Federal's common formats).
    date_mask = data['date'].apply(lambda x:
        isinstance(x, str) and bool(re.match(r'^\d{2}[\-/]\d{2}[\-/]\d{2,4}$', str(x).strip())))
    data = data[date_mask.values]

    # Namespace synthetic refs by earliest-txn YYYYMM.
    stmt_dates = []
    for _, r in data.iterrows():
        for fmt in ('%d/%m/%y', '%d/%m/%Y', '%d-%m-%y', '%d-%m-%Y'):
            try:
                stmt_dates.append(datetime.strptime(str(r['date']).strip(), fmt))
                break
            except ValueError:
                continue
    stmt_ns = (min(stmt_dates).strftime('%Y%m') if stmt_dates
               else datetime.fromtimestamp(os.path.getmtime(path)).strftime('%Y%m'))

    rows = []
    for row_idx, (_, r) in enumerate(data.iterrows()):
        date_str = str(r['date']).strip()
        narr = str(r['narration']).strip() if pd.notna(r['narration']) else ''
        ref = str(r['ref']).strip() if pd.notna(r['ref']) else None
        if ref and ref.strip('0') == '': ref = None
        if ref is None:
            ref = f'FED_{stmt_ns}_{row_idx:04d}'

        dr = _to_paise(r.get('debit'))
        cr = _to_paise(r.get('credit'))
        bal = _to_paise(r.get('balance'))
        if dr < 0: cr, dr = -dr, 0
        if cr < 0: dr, cr = -cr, 0
        if dr == 0 and cr == 0: continue

        direction = 'credit' if cr > 0 else 'debit'
        amount_paise = cr if direction == 'credit' else dr

        d = None
        for fmt in ('%d/%m/%y', '%d/%m/%Y', '%d-%m-%y', '%d-%m-%Y'):
            try:
                d = datetime.strptime(date_str, fmt).replace(tzinfo=IST); break
            except ValueError:
                continue

        cls = classify(narr, direction)

        rows.append(dict(
            txn_at=d.isoformat() if d else None,
            direction=direction,
            amount_paise=amount_paise,
            balance_paise_after=bal if bal > 0 else None,
            source=SOURCE,
            settlement_platform=cls.get('settlement_platform'),
            channel=cls['channel'],
            counterparty=cls['counterparty'],
            counterparty_ref=cls['counterparty_ref'],
            narration=narr[:400],
            source_ref=ref,
        ))
    return rows


def _to_paise(v) -> int:
    if v is None: return 0
    if isinstance(v, float) and pd.isna(v): return 0
    try: return int(round(float(v) * 100))
    except (ValueError, TypeError): return 0


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SQL emission
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def sql_escape(s):
    if s is None: return 'NULL'
    return "'" + str(s).replace("'", "''") + "'"

def num(v):
    if v is None: return 'NULL'
    return str(int(v))

def emit_sql(rows: list[dict]) -> str:
    out = []
    out.append(f'-- Auto-generated from Federal Bank statement, {datetime.now().isoformat()}')
    out.append(f'-- {len(rows)} transactions for {INSTRUMENT}')
    out.append('')
    received_at_iso = datetime.now(IST).isoformat()
    for r in rows:
        out.append(
            'INSERT OR IGNORE INTO money_events\n'
            '  (source, instrument, source_ref, direction, amount_paise,\n'
            '   balance_paise_after, channel, counterparty, counterparty_ref,\n'
            '   narration, txn_at, received_at, parse_status,\n'
            '   settlement_platform, notes)\n'
            'VALUES ('
            f"'{SOURCE}', '{INSTRUMENT}', "
            f'{sql_escape(r["source_ref"])}, '
            f'{sql_escape(r["direction"])}, '
            f'{num(r["amount_paise"])}, '
            f'{num(r["balance_paise_after"])}, '
            f'{sql_escape(r["channel"])}, '
            f'{sql_escape(r["counterparty"])}, '
            f'{sql_escape(r["counterparty_ref"])}, '
            f'{sql_escape(r["narration"])}, '
            f'{sql_escape(r["txn_at"])}, '
            f"'{received_at_iso}', "
            "'parsed', "
            f'{sql_escape(r.get("settlement_platform"))}, '
            f"'backfill');"
        )
    out.append('')
    out.append(f"UPDATE money_source_health SET last_event_at='{received_at_iso}', "
               "last_checked_at=CURRENT_TIMESTAMP, status='healthy' "
               f"WHERE source='{SOURCE}' AND instrument='{INSTRUMENT}';")
    return '\n'.join(out)


def main():
    if len(sys.argv) < 2:
        print('usage: backfill-federal-xls.py <path-to-xls> [--inspect]', file=sys.stderr)
        sys.exit(2)
    if '--inspect' in sys.argv:
        path = next(a for a in sys.argv[1:] if not a.startswith('--'))
        inspect_xls(path)
        return
    rows = parse_xls(sys.argv[1])
    print(emit_sql(rows))
    print(f'# Federal: {len(rows)} rows emitted', file=sys.stderr)


if __name__ == '__main__':
    main()
