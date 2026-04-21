#!/usr/bin/env python3
"""
GST Search v2 — Uses the official GST portal's public API endpoints.
Searches for "Le Arabia" GSTINs by:
1. Directly querying known GSTINs via the GST portal
2. Brute-forcing PAN-based GSTINs across all states
3. Taxpayer search by name
"""

import json
import time
import requests
import re
from typing import Optional

# Suppress SSL warnings for older Python
import warnings
warnings.filterwarnings("ignore")

# ── Known Data ─────────────────────────────────────────────────────
KNOWN_PANS = ["BQRPN9730L", "AAHFL8416C"]
KNOWN_GSTINS = ["32BQRPN9730L1Z6", "29AAHFL8416C1ZA"]

STATE_CODES = {
    "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
    "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
    "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
    "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
    "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
    "16": "Tripura", "17": "Meghalaya", "18": "Assam",
    "19": "West Bengal", "20": "Jharkhand", "21": "Odisha",
    "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
    "26": "Dadra & Nagar Haveli and Daman & Diu",
    "27": "Maharashtra", "28": "Andhra Pradesh (Old)",
    "29": "Karnataka", "30": "Goa",
    "31": "Lakshadweep", "32": "Kerala",
    "33": "Tamil Nadu", "34": "Puducherry",
    "35": "Andaman & Nicobar", "36": "Telangana",
    "37": "Andhra Pradesh",
}

ALL_STATE_CODES = [f"{i:02d}" for i in range(1, 38)]

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
})


def compute_gstin_checksum(gstin_12: str) -> str:
    """Compute GSTIN check digit using Luhn mod 36."""
    chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    factor = 1
    total = 0
    for ch in gstin_12:
        digit = chars.index(ch.upper())
        factor = 2 if factor == 1 else 1
        digit = factor * digit
        digit = (digit // 36) + (digit % 36)
        total += digit
    remainder = total % 36
    return chars[(36 - remainder) % 36]


def generate_gstins_for_pan(pan: str, entity_nums=("1", "2", "3")) -> list[str]:
    """Generate candidate GSTINs for a PAN across all states."""
    candidates = []
    for sc in ALL_STATE_CODES:
        for en in entity_nums:
            partial = f"{sc}{pan}{en}Z"
            check = compute_gstin_checksum(partial)
            candidates.append(partial + check)
    return candidates


def lookup_gstin_gstportal(gstin: str) -> Optional[dict]:
    """
    Query the official GST portal's public search.
    This hits the same backend as https://services.gst.gov.in/services/searchtp
    """
    # Method 1: Direct API
    try:
        url = f"https://services.gst.gov.in/services/api/search/taxpayerByGstin"
        resp = SESSION.get(url, params={"gstin": gstin}, timeout=15, verify=False)
        if resp.status_code == 200:
            data = resp.json()
            if data and isinstance(data, dict) and data.get("gstin"):
                return data
    except Exception:
        pass

    # Method 2: Alternate public endpoint
    try:
        url = f"https://gstverify.c-cit.co.in/api/v2/search/{gstin}"
        resp = SESSION.get(url, timeout=15, verify=False)
        if resp.status_code == 200:
            data = resp.json()
            if data and data.get("gstin"):
                return data
    except Exception:
        pass

    return None


def lookup_via_cleartax(gstin: str) -> Optional[dict]:
    """Try ClearTax's public GST search."""
    try:
        url = f"https://gst.cleartax.in/api/gstins/{gstin}"
        resp = SESSION.get(url, timeout=15, verify=False)
        if resp.status_code == 200:
            data = resp.json()
            if data and (data.get("gstin") or data.get("gstNumber")):
                return data
    except Exception:
        pass
    return None


def lookup_via_gstzen(gstin: str) -> Optional[dict]:
    """Try GSTZen's public lookup."""
    try:
        url = f"https://www.gstzen.in/api/gstin/{gstin}"
        resp = SESSION.get(url, timeout=15, verify=False)
        if resp.status_code == 200:
            data = resp.json()
            if data and data.get("gstin"):
                return data
    except Exception:
        pass
    return None


def lookup_via_einvoice(gstin: str) -> Optional[dict]:
    """Try the e-invoice portal's public GSTIN search."""
    try:
        url = f"https://einvoice1.gst.gov.in/Others/GetGSTINDetails"
        resp = SESSION.post(url, json={"gstin": gstin}, timeout=15, verify=False)
        if resp.status_code == 200:
            data = resp.json()
            if data and data.get("Status") == 1:
                return data
    except Exception:
        pass
    return None


def multi_lookup(gstin: str) -> Optional[dict]:
    """Try multiple sources for a GSTIN lookup."""
    for fn in [lookup_gstin_gstportal, lookup_via_cleartax, lookup_via_einvoice]:
        result = fn(gstin)
        if result:
            return {"source": fn.__name__, "data": result}
        time.sleep(0.2)
    return None


def normalize_result(raw: dict) -> dict:
    """Normalize results from different APIs into a common format."""
    source = raw.get("source", "")
    data = raw.get("data", {})

    # Most APIs use similar field names from the GST portal
    info = {
        "gstin": data.get("gstin") or data.get("gstNumber", ""),
        "legal_name": data.get("lgnm") or data.get("legalName", ""),
        "trade_name": data.get("tradeNam") or data.get("tradeName", ""),
        "status": data.get("sts") or data.get("status", ""),
        "reg_date": data.get("rgdt") or data.get("registrationDate", ""),
        "cancel_date": data.get("cxdt") or data.get("cancellationDate", ""),
        "type": data.get("dty") or data.get("ctb") or data.get("constitutionOfBusiness", ""),
        "state_jurisdiction": data.get("stj") or data.get("stateJurisdiction", ""),
        "center_jurisdiction": data.get("ctj") or data.get("centerJurisdiction", ""),
        "nature_of_business": data.get("nba") or data.get("natureOfBusiness", []),
        "source": source,
    }

    # Extract address
    pradr = data.get("pradr") or data.get("principalAddress", {})
    if isinstance(pradr, dict):
        info["address"] = pradr.get("adr") or pradr.get("address", "")
    elif isinstance(pradr, str):
        info["address"] = pradr
    else:
        info["address"] = ""

    return info


def main():
    print("=" * 70)
    print("LE ARABIA RESTAURANT — GST REGISTRATION SEARCH v2")
    print("=" * 70)
    print("Using multiple public GST lookup endpoints...")

    all_found = {}

    # ── Step 1: Check known GSTINs ────────────────────────────────
    print("\n[1] Verifying KNOWN GSTINs...")
    for gstin in KNOWN_GSTINS:
        sc = gstin[:2]
        sname = STATE_CODES.get(sc, sc)
        print(f"\n  → {gstin} ({sname})")
        result = multi_lookup(gstin)
        if result:
            info = normalize_result(result)
            all_found[gstin] = info
            print(f"    ✓ Legal: {info['legal_name']}")
            print(f"      Trade: {info['trade_name']}")
            print(f"      Status: {info['status']}")
            print(f"      Type: {info['type']}")
            print(f"      Address: {info['address'][:80]}...")
            print(f"      Reg: {info['reg_date']}")
            print(f"      Source: {info['source']}")
        else:
            print(f"    ✗ No data returned (APIs may require captcha/auth)")
        time.sleep(1)

    # ── Step 2: Brute-force PAN-based GSTINs ──────────────────────
    print("\n[2] Checking PAN-derived GSTINs across all states...")

    # Priority states (where outlets are known + nearby states)
    priority_states = ["29", "32", "33", "27", "36", "07", "09", "24", "28", "37", "30"]

    for pan in KNOWN_PANS:
        print(f"\n  PAN: {pan}")

        # Generate only entity_num=1 first (most common), then 2
        for entity_num in ["1", "2"]:
            for sc in priority_states + [s for s in ALL_STATE_CODES if s not in priority_states]:
                partial = f"{sc}{pan}{entity_num}Z"
                check = compute_gstin_checksum(partial)
                gstin = partial + check

                if gstin in all_found or gstin in KNOWN_GSTINS:
                    continue

                sname = STATE_CODES.get(sc, sc)
                result = multi_lookup(gstin)
                if result:
                    info = normalize_result(result)
                    if info.get("gstin"):
                        all_found[gstin] = info
                        print(f"\n  ★ NEW GSTIN: {gstin} ({sname})")
                        print(f"    Legal: {info['legal_name']}")
                        print(f"    Trade: {info['trade_name']}")
                        print(f"    Status: {info['status']}")
                        print(f"    Type: {info['type']}")
                        print(f"    Address: {info['address'][:100]}")
                        print(f"    Reg: {info['reg_date']}")
                else:
                    # Print progress every 10 states
                    if ALL_STATE_CODES.index(sc) % 10 == 0:
                        print(f"    ...checked up to state {sc} ({sname}), entity {entity_num}")

                time.sleep(0.4)

    # ── Summary ───────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print(f"FINAL RESULTS: {len(all_found)} GST registration(s) found")
    print("=" * 70)

    for gstin in sorted(all_found.keys()):
        info = all_found[gstin]
        sc = gstin[:2]
        sname = STATE_CODES.get(sc, sc)
        pan = gstin[2:12]
        print(f"\n  GSTIN:       {gstin}")
        print(f"  PAN:         {pan}")
        print(f"  State:       {sname}")
        print(f"  Legal Name:  {info.get('legal_name', 'N/A')}")
        print(f"  Trade Name:  {info.get('trade_name', 'N/A')}")
        print(f"  Status:      {info.get('status', 'N/A')}")
        print(f"  Type:        {info.get('type', 'N/A')}")
        print(f"  Reg Date:    {info.get('reg_date', 'N/A')}")
        print(f"  Cancel Date: {info.get('cancel_date', 'N/A')}")
        print(f"  Address:     {info.get('address', 'N/A')}")
        print(f"  Business:    {info.get('nature_of_business', 'N/A')}")

    # Save
    with open("gst_results_le_arabia_v2.json", "w") as f:
        json.dump(all_found, f, indent=2, default=str)
    print(f"\nResults saved to gst_results_le_arabia_v2.json")

    # Also print what we KNOW but couldn't verify
    unverified = [g for g in KNOWN_GSTINS if g not in all_found]
    if unverified:
        print(f"\n⚠ Could not verify {len(unverified)} known GSTIN(s) via API:")
        for g in unverified:
            print(f"  - {g}")
        print("  (These may require manual verification on services.gst.gov.in)")


if __name__ == "__main__":
    main()
