#!/usr/bin/env python3
"""
backfill-hdfc-xls.py — convert an HDFC Account Statement .xls into SQL
INSERT OR IGNORE statements for the money_events table. Also classifies
each txn by channel + tries to match a known payee.

Usage:
    pip3 install --user xlrd pandas
    python3 scripts/bank-backfill/backfill-hdfc-xls.py \
        /path/to/Acct_Statement_XXXXXXXX4680_DDMMYYYY.xls \
        > data/bank/backfill-hdfc-4680.sql

    # Then load it into D1:
    wrangler d1 execute hn-hiring --remote --file=data/bank/backfill-hdfc-4680.sql

Idempotent: re-running dumps the same SQL; INSERT OR IGNORE on the money_events
unique indexes prevents duplicate rows. Safe to rerun after every statement
export until the live email pipeline takes over.

Output also goes to stderr as a human summary (top payees, totals, channel mix).
"""

from __future__ import annotations
import sys, re, json, os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collections import defaultdict

import pandas as pd

IST = timezone(timedelta(hours=5, minutes=30))

INSTRUMENT = 'hdfc_ca_4680'
SOURCE_DEFAULT = 'hdfc'
PAYEES_JSON = Path(__file__).resolve().parents[2] / 'data' / 'bank' / 'hdfc-payees-4680.json'


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Narration classifier — map HDFC's narration prefixes to our schema.
# Based on ~400 real txns from the 2026-02 to 2026-04 statement.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def classify(narration: str) -> dict:
    """Returns { source, channel, counterparty, counterparty_ref, narration_tidy } """
    n = str(narration).strip()

    # IMPS-<ref>-<counterparty>
    m = re.match(r'IMPS-(\d+)-(.+)', n)
    if m:
        cp = m.group(2).strip()
        if re.search(r'RAZORPAY', cp, re.I):
            return dict(source='razorpay', channel='imps',
                        counterparty='RAZORPAY SOFTWARE PVT LTD',
                        counterparty_ref=None, narration_tidy=n)
        return dict(source='hdfc', channel='imps',
                    counterparty=_tidy_name(cp),
                    counterparty_ref=None, narration_tidy=n)

    # CHQ PAID-CTS S<n>-<something>-<payee>
    m = re.match(r'CHQ\s+PAID[^-]*-[^-]*-(.+)', n)
    if m:
        return dict(source='hdfc', channel='cheque',
                    counterparty=_tidy_name(m.group(1)),
                    counterparty_ref=None, narration_tidy=n)

    # NEFT DR-<bank>-<payee>-<ref>
    m = re.match(r'NEFT\s+(?:DR|CR)-([^-]+)-(.+)', n)
    if m:
        return dict(source='hdfc', channel='neft',
                    counterparty=_tidy_name(m.group(2)),
                    counterparty_ref=m.group(1).strip(),
                    narration_tidy=n)

    # RTGS similar
    m = re.match(r'RTGS\s+(?:DR|CR)[- ]?(.+)', n)
    if m:
        return dict(source='hdfc', channel='rtgs',
                    counterparty=_tidy_name(m.group(1)),
                    counterparty_ref=None, narration_tidy=n)

    # UPI-<ref>-<name>-<vpa> OR TPT-<ref>-<name>
    m = re.match(r'(UPI|TPT|TPT-TO|TPT-FROM)[-/](.+)', n)
    if m:
        rest = m.group(2)
        parts = rest.split('-')
        cp = parts[1] if len(parts) > 1 else parts[0]
        vpa = None
        for p in parts:
            if '@' in p:
                vpa = p.strip()
                break
        return dict(source='hdfc', channel='upi',
                    counterparty=_tidy_name(cp),
                    counterparty_ref=vpa, narration_tidy=n)

    # POS / debit card
    m = re.match(r'POS[\s/]+\S+[\s/]+(.+)', n)
    if m:
        return dict(source='hdfc', channel='card',
                    counterparty=_tidy_name(m.group(1)),
                    counterparty_ref=None, narration_tidy=n)

    # ACH mandate (autopay — usually SIP / insurance / subscriptions)
    m = re.match(r'ACH\s+[A-Z]-\s*([^-]+)', n)
    if m:
        return dict(source='hdfc', channel='ach',
                    counterparty=_tidy_name(m.group(1)),
                    counterparty_ref=None, narration_tidy=n)

    # Clearing deposit CL<ref><name>  (opening deposits etc.)
    m = re.match(r'CL\d+([A-Z].*)', n)
    if m:
        return dict(source='hdfc', channel='clearing',
                    counterparty=_tidy_name(m.group(1)),
                    counterparty_ref=None, narration_tidy=n)

    # ATM cash withdrawal
    if re.search(r'\bATM\b', n, re.I):
        return dict(source='hdfc', channel='atm',
                    counterparty='ATM CASH WITHDRAWAL',
                    counterparty_ref=None, narration_tidy=n)

    # Charges / fees / GST
    if re.search(r'\b(CHGS|CHARGE|CHARGES|FEE|GST|TAX|SMS CHGS|AMC|MAB)\b', n, re.I):
        return dict(source='hdfc', channel='charges',
                    counterparty='HDFC BANK CHARGES',
                    counterparty_ref=None, narration_tidy=n)

    # Default fallback
    return dict(source='hdfc', channel='unknown',
                counterparty=_tidy_name(n[:60]),
                counterparty_ref=None, narration_tidy=n)


def _tidy_name(s: str) -> str:
    s = re.sub(r'\s+', ' ', str(s)).strip()
    s = re.sub(r'[-/]+$', '', s).strip()
    s = s.rstrip(' -/.')
    return s[:80]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Payee registry match — try to link a parsed counterparty to one of the
# 30 registered HDFC payees. Uses fuzzy substring + token match.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def load_payees() -> list:
    try:
        with open(PAYEES_JSON) as fh:
            return json.load(fh).get('payees', [])
    except Exception as e:
        print(f'# warn: payees file not found: {e}', file=sys.stderr)
        return []

def match_payee(counterparty: str, payees: list) -> dict | None:
    if not counterparty: return None
    cp_up = re.sub(r'[^A-Z0-9 ]+', ' ', counterparty.upper())
    cp_tokens = set(re.findall(r'[A-Z0-9]{3,}', cp_up))
    if not cp_tokens: return None
    best = None
    best_score = 0
    for p in payees:
        p_up = re.sub(r'[^A-Z0-9 ]+', ' ', p['name'].upper())
        p_tokens = set(re.findall(r'[A-Z0-9]{3,}', p_up))
        if not p_tokens: continue
        shared = cp_tokens & p_tokens
        # Score: share count weighted by inverse payee length (prefer tight matches)
        if not shared: continue
        score = len(shared) / max(1, len(p_tokens))
        if score > best_score and len(shared) >= 2:
            best_score = score
            best = p
    return best if best_score >= 0.5 else None


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# XLS → rows
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def parse_xls(path: str) -> list[dict]:
    df = pd.read_excel(path, header=None)
    # Locate the header row — has "Date" "Narration" "Withdrawal Amt." etc.
    header_idx = None
    for i in range(min(40, len(df))):
        row = [str(v) for v in df.iloc[i].values]
        if 'Narration' in row and any('Withdrawal' in r for r in row):
            header_idx = i
            break
    if header_idx is None:
        raise SystemExit('ERROR: could not locate header row in XLS')

    data = df.iloc[header_idx + 1:].copy()
    data.columns = ['date', 'narration', 'ref', 'value_dt', 'debit', 'credit', 'balance']
    # Keep only rows whose 'date' matches DD/MM/YY.
    date_mask = data['date'].apply(
        lambda x: isinstance(x, str) and bool(re.match(r'^\d{2}/\d{2}/\d{2}$', str(x).strip()))
    )
    data = data[date_mask.values]  # use .values to avoid index alignment quirks

    rows = []
    payees = load_payees()

    for _, r in data.iterrows():
        date_str = str(r['date']).strip()
        narr = str(r['narration']).strip() if pd.notna(r['narration']) else ''
        ref = str(r['ref']).strip() if pd.notna(r['ref']) else None
        if ref and ref.strip('0') == '': ref = None  # all zeros ref → null
        dr = _to_paise(r['debit'])
        cr = _to_paise(r['credit'])
        bal = _to_paise(r['balance'])

        if dr == 0 and cr == 0: continue
        direction = 'credit' if cr > 0 else 'debit'
        amount_paise = cr if direction == 'credit' else dr

        # Parse date → ISO at 00:00 IST. XLS doesn't give time; fallback to midnight.
        try:
            d = datetime.strptime(date_str, '%d/%m/%y').replace(tzinfo=IST)
        except ValueError:
            d = None

        cls = classify(narr)
        matched = match_payee(cls['counterparty'], payees)

        rows.append(dict(
            txn_at=d.isoformat() if d else None,
            direction=direction,
            amount_paise=amount_paise,
            balance_paise_after=bal if bal > 0 else None,
            source=cls['source'],
            channel=cls['channel'],
            counterparty=cls['counterparty'],
            counterparty_ref=cls['counterparty_ref'],
            narration=narr[:400],
            source_ref=ref,
            matched_payee_id=matched['id'] if matched else None,
            matched_payee_name=matched['name'] if matched else None,
            matched_payee_category=matched.get('category') if matched else None,
        ))
    return rows


def _to_paise(v) -> int:
    if v is None: return 0
    if isinstance(v, float) and pd.isna(v): return 0
    try:
        return int(round(float(v) * 100))
    except (ValueError, TypeError):
        return 0


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
    out.append(f'-- Auto-generated from HDFC account statement, {datetime.now().isoformat()}')
    out.append(f'-- {len(rows)} transactions — INSERT OR IGNORE is idempotent against')
    out.append(f'-- money_events(source, source_ref) and')
    out.append(f'-- money_events(source, instrument, direction, amount_paise, txn_at).')
    out.append('')
    out.append('BEGIN TRANSACTION;')
    out.append('')
    received_at_iso = datetime.now(IST).isoformat()

    for r in rows:
        notes = ''
        if r.get('matched_payee_name'):
            notes = f'matched: {r["matched_payee_name"]}'
            if r.get('matched_payee_category'):
                notes += f' [{r["matched_payee_category"]}]'
        out.append(
            'INSERT OR IGNORE INTO money_events\n'
            '  (source, instrument, source_ref, direction, amount_paise,\n'
            '   balance_paise_after, channel, counterparty, counterparty_ref,\n'
            '   narration, txn_at, received_at, parse_status, notes)\n'
            'VALUES ('
            f'{sql_escape(r["source"])}, '
            f"'{INSTRUMENT}', "
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
            f'{sql_escape(notes)});'
        )

    out.append('')
    out.append(f"UPDATE money_source_health SET last_event_at='{received_at_iso}', "
               "last_checked_at=CURRENT_TIMESTAMP, status='healthy' "
               f"WHERE source='hdfc' AND instrument='{INSTRUMENT}';")
    out.append('')
    out.append('COMMIT;')
    return '\n'.join(out)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Summary (stderr)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def print_summary(rows: list[dict]):
    if not rows:
        print('# no rows', file=sys.stderr)
        return
    credits = sum(r['amount_paise'] for r in rows if r['direction'] == 'credit')
    debits  = sum(r['amount_paise'] for r in rows if r['direction'] == 'debit')
    n_c = sum(1 for r in rows if r['direction'] == 'credit')
    n_d = sum(1 for r in rows if r['direction'] == 'debit')

    by_channel = defaultdict(lambda: [0, 0, 0, 0])
    for r in rows:
        c = by_channel[r['channel']]
        c[0] += 1
        if r['direction'] == 'credit':
            c[1] += 1
            c[2] += r['amount_paise']
        else:
            c[3] += r['amount_paise']

    by_cp = defaultdict(lambda: [0, 0, 0, set()])
    for r in rows:
        k = r.get('matched_payee_name') or r['counterparty']
        c = by_cp[k]
        c[0] += 1
        if r['direction'] == 'credit': c[1] += r['amount_paise']
        else: c[2] += r['amount_paise']
        c[3].add(r['channel'])

    matched = sum(1 for r in rows if r.get('matched_payee_id'))
    unmatched = len(rows) - matched

    dates = [r['txn_at'] for r in rows if r['txn_at']]
    first = min(dates) if dates else '?'
    last  = max(dates) if dates else '?'

    print(f'# txns: {len(rows)}   matched payees: {matched}  unmatched: {unmatched}', file=sys.stderr)
    print(f'# range: {first} → {last}', file=sys.stderr)
    print(f'# credits: ₹{credits/100:>14,.2f}  ({n_c} txns)', file=sys.stderr)
    print(f'# debits:  ₹{debits/100:>14,.2f}  ({n_d} txns)', file=sys.stderr)
    print(f'# net:     ₹{(credits-debits)/100:>14,.2f}', file=sys.stderr)
    print('#', file=sys.stderr)
    print('# channel breakdown:', file=sys.stderr)
    for ch, (n, nc, cr, dr) in sorted(by_channel.items(), key=lambda kv: -kv[1][0]):
        print(f'#   {ch:<10} {n:>4}x   in ₹{cr/100:>12,.2f}   out ₹{dr/100:>12,.2f}', file=sys.stderr)
    print('#', file=sys.stderr)
    print('# top 20 counterparties (by txn count):', file=sys.stderr)
    top = sorted(by_cp.items(), key=lambda kv: -kv[1][0])[:20]
    for name, (count, cr, dr, chans) in top:
        gross = cr if cr > dr else dr
        arrow = 'CR' if cr > dr else 'DR'
        chan_str = ','.join(sorted(chans))[:20]
        print(f'#   {name[:48]:<48}  {chan_str:<20}  {arrow} ₹{gross/100:>14,.2f}  ({count}x)', file=sys.stderr)


def main():
    if len(sys.argv) < 2:
        print('usage: backfill-hdfc-xls.py <path-to-xls>', file=sys.stderr)
        sys.exit(2)
    rows = parse_xls(sys.argv[1])
    print(emit_sql(rows))
    print_summary(rows)


if __name__ == '__main__':
    main()
