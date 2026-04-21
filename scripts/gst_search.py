#!/usr/bin/env python3
"""
Search for GST registrations related to "Le Arabia Restaurant"
across Indian states using public GST lookup APIs.

Known PANs:
  - BQRPN9730L (Naznin Niyaf - proprietorship)
  - AAHFL8416C (Le Arabia Foods - partnership firm)

Known GSTINs:
  - 32BQRPN9730L1Z6 (Kerala, INACTIVE)
  - 29AAHFL8416C1ZA (Karnataka, active)
"""

import json
import time
import requests
from typing import Optional

# ── Configuration ──────────────────────────────────────────────────
KNOWN_PANS = ["BQRPN9730L", "AAHFL8416C"]
KNOWN_GSTINS = ["32BQRPN9730L1Z6", "29AAHFL8416C1ZA"]

# Indian state codes for GSTIN prefix
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

# All 37 state codes to try for PAN-based GSTIN generation
ALL_STATE_CODES = [f"{i:02d}" for i in range(1, 38)]


def gstin_from_pan(state_code: str, pan: str, entity_num: str = "1", checksum: str = "") -> str:
    """
    Generate a partial GSTIN from state code + PAN.
    Full format: SSPPPPPPPPPPNZC
    SS = state code, P*10 = PAN, N = entity number, Z = 'Z' default, C = checksum
    """
    return f"{state_code}{pan}{entity_num}Z{checksum}"


def lookup_gstin_master_india(gstin: str) -> Optional[dict]:
    """
    Look up GSTIN using the public GST API (master.india.gov.in style).
    Returns taxpayer details if found.
    """
    url = f"https://commonapi.mastersindia.co/commonapis/searchgstin?gstin={gstin}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Accept": "application/json",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("error") is False or data.get("data"):
                return data
    except Exception as e:
        pass
    return None


def lookup_gstin_knowyourgst(gstin: str) -> Optional[dict]:
    """
    Look up GSTIN via KnowYourGST-style public endpoint.
    """
    url = f"https://appyflow.in/api/verifyGST?gstNo={gstin}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Accept": "application/json",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("taxpayerInfo"):
                return data
    except Exception as e:
        pass
    return None


def lookup_gstin_sheet2api(gstin: str) -> Optional[dict]:
    """
    Look up GSTIN via an alternate public verification API.
    """
    url = f"https://sheet.gstincheck.co.in/check/{gstin}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("flag"):
                return data
    except Exception as e:
        pass
    return None


def compute_gstin_checksum(gstin_12: str) -> str:
    """
    Compute the check digit (13th character) of a GSTIN.
    Based on the Luhn mod 36 algorithm used by GSTN.
    """
    chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    factor = 1
    total = 0
    code_point_count = 36  # length of chars

    for i in range(len(gstin_12)):
        digit = chars.index(gstin_12[i].upper())
        factor = 2 if factor == 1 else 1
        digit = factor * digit
        digit = (digit // code_point_count) + (digit % code_point_count)
        total += digit

    remainder = total % code_point_count
    check_code_point = (code_point_count - remainder) % code_point_count
    return chars[check_code_point]


def generate_candidate_gstins(pan: str) -> list[str]:
    """
    Generate all possible GSTINs for a PAN across all Indian states.
    Entity numbers 1-9 are possible, but 1 is most common.
    """
    candidates = []
    for sc in ALL_STATE_CODES:
        for entity_num in ["1", "2", "3"]:  # Check entity numbers 1-3
            partial = f"{sc}{pan}{entity_num}Z"
            check = compute_gstin_checksum(partial)
            full_gstin = partial + check
            candidates.append(full_gstin)
    return candidates


def search_by_trade_name(name: str) -> list[dict]:
    """
    Search for GSTINs by trade name using public search APIs.
    """
    results = []
    # Try the public taxpayer search
    url = f"https://commonapi.mastersindia.co/commonapis/taxpayersearch?name={name}&state_cd=all"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Accept": "application/json",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("data"):
                results.extend(data["data"] if isinstance(data["data"], list) else [data["data"]])
    except Exception:
        pass
    return results


def lookup_single_gstin(gstin: str) -> Optional[dict]:
    """Try multiple APIs to look up a single GSTIN."""
    # Try API 1
    result = lookup_gstin_sheet2api(gstin)
    if result and result.get("flag"):
        return result

    time.sleep(0.3)

    # Try API 2
    result = lookup_gstin_knowyourgst(gstin)
    if result and result.get("taxpayerInfo"):
        return result

    return None


def extract_info(result: dict) -> dict:
    """Extract key fields from a GST lookup result."""
    info = {}

    # Handle sheet.gstincheck format
    if result.get("data"):
        d = result["data"]
        info = {
            "gstin": d.get("gstin", ""),
            "legal_name": d.get("lgnm", ""),
            "trade_name": d.get("tradeNam", ""),
            "status": d.get("sts", ""),
            "registration_date": d.get("rgdt", ""),
            "cancellation_date": d.get("cxdt", ""),
            "state": d.get("stj", ""),
            "type": d.get("dty", "") or d.get("ctb", ""),
            "address": d.get("pradr", {}).get("adr", "") if isinstance(d.get("pradr"), dict) else "",
            "nature_of_business": d.get("nba", []),
            "last_filed_return": d.get("lstupdt", ""),
        }

    # Handle taxpayerInfo format
    elif result.get("taxpayerInfo"):
        t = result["taxpayerInfo"]
        info = {
            "gstin": t.get("gstin", ""),
            "legal_name": t.get("lgnm", ""),
            "trade_name": t.get("tradeNam", ""),
            "status": t.get("sts", ""),
            "registration_date": t.get("rgdt", ""),
            "type": t.get("dty", "") or t.get("ctb", ""),
            "address": t.get("pradr", {}).get("adr", "") if isinstance(t.get("pradr"), dict) else "",
        }

    return info


def main():
    print("=" * 70)
    print("LE ARABIA RESTAURANT — GST REGISTRATION SEARCH")
    print("=" * 70)

    all_found = {}

    # ── Step 1: Look up known GSTINs ──────────────────────────────
    print("\n[1] Looking up KNOWN GSTINs...")
    for gstin in KNOWN_GSTINS:
        print(f"\n  Checking {gstin}...")
        result = lookup_single_gstin(gstin)
        if result:
            info = extract_info(result)
            if info:
                all_found[gstin] = info
                print(f"  ✓ FOUND: {info.get('trade_name', 'N/A')} | {info.get('legal_name', 'N/A')}")
                print(f"    Status: {info.get('status', 'N/A')}")
                print(f"    Type: {info.get('type', 'N/A')}")
                print(f"    Address: {info.get('address', 'N/A')}")
                print(f"    Reg Date: {info.get('registration_date', 'N/A')}")
        else:
            print(f"  ✗ Not found or API unavailable")
        time.sleep(1)

    # ── Step 2: Generate & check PAN-based GSTINs ─────────────────
    print("\n[2] Generating candidate GSTINs from known PANs...")
    for pan in KNOWN_PANS:
        candidates = generate_candidate_gstins(pan)
        print(f"\n  PAN: {pan} — {len(candidates)} candidates generated")

        # Skip already-known ones
        candidates = [c for c in candidates if c not in KNOWN_GSTINS and c not in all_found]

        for i, gstin in enumerate(candidates):
            state_code = gstin[:2]
            state_name = STATE_CODES.get(state_code, f"Code {state_code}")

            # Show progress for first entity number only
            entity = gstin[12]
            if entity == "1" and int(state_code) % 5 == 1:
                print(f"    Checking state {state_code} ({state_name})...")

            result = lookup_single_gstin(gstin)
            if result:
                info = extract_info(result)
                if info and info.get("gstin"):
                    all_found[gstin] = info
                    print(f"\n  ★ NEW GSTIN FOUND: {gstin}")
                    print(f"    State: {state_name}")
                    print(f"    Trade Name: {info.get('trade_name', 'N/A')}")
                    print(f"    Legal Name: {info.get('legal_name', 'N/A')}")
                    print(f"    Status: {info.get('status', 'N/A')}")
                    print(f"    Type: {info.get('type', 'N/A')}")
                    print(f"    Address: {info.get('address', 'N/A')}")
                    print(f"    Reg Date: {info.get('registration_date', 'N/A')}")

            time.sleep(0.5)  # Rate limiting

    # ── Step 3: Trade name search ─────────────────────────────────
    print("\n[3] Searching by trade name 'Le Arabia'...")
    trade_results = search_by_trade_name("Le Arabia")
    if trade_results:
        print(f"  Found {len(trade_results)} results from trade name search")
        for r in trade_results:
            gstin = r.get("gstin", "")
            if gstin and gstin not in all_found:
                print(f"\n  ★ NEW from trade search: {gstin}")
                # Look up full details
                detail = lookup_single_gstin(gstin)
                if detail:
                    info = extract_info(detail)
                    all_found[gstin] = info
                    print(f"    Trade Name: {info.get('trade_name', 'N/A')}")
                    print(f"    Legal Name: {info.get('legal_name', 'N/A')}")
                    print(f"    Status: {info.get('status', 'N/A')}")
                time.sleep(0.5)
    else:
        print("  No results from trade name search API")

    # ── Summary ───────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print(f"SUMMARY: Found {len(all_found)} GST registration(s)")
    print("=" * 70)

    for gstin, info in sorted(all_found.items()):
        state_code = gstin[:2]
        state_name = STATE_CODES.get(state_code, f"Code {state_code}")
        print(f"\n  GSTIN: {gstin}")
        print(f"  State: {state_name}")
        print(f"  Legal Name: {info.get('legal_name', 'N/A')}")
        print(f"  Trade Name: {info.get('trade_name', 'N/A')}")
        print(f"  Status: {info.get('status', 'N/A')}")
        print(f"  Type: {info.get('type', 'N/A')}")
        print(f"  Reg Date: {info.get('registration_date', 'N/A')}")
        print(f"  Cancel Date: {info.get('cancellation_date', 'N/A')}")
        print(f"  Address: {info.get('address', 'N/A')}")
        print(f"  Business: {info.get('nature_of_business', 'N/A')}")

    # Save results to JSON
    output_file = "gst_results_le_arabia.json"
    with open(output_file, "w") as f:
        json.dump(all_found, f, indent=2, default=str)
    print(f"\nResults saved to {output_file}")


if __name__ == "__main__":
    main()
