#!/usr/bin/env python3
"""
Local Gmail bulk email sender for the May 2026 influencer cold-outreach campaign.

Architecture:
  1. Calls /api/influencer-outreach?action=create-batch with channel=email + limit=N
     This pre-allocates N rows in 'queued' status so they don't get re-claimed.
  2. For each row, sends via Gmail SMTP (with App Password).
  3. Posts back to /api/influencer-outreach?action=log with status='sent' for each
     successful send (or 'failed' with bounce_reason for failures).

ENV / .env.local required (in HN repo root):
  GMAIL_FROM        = nihaf@hnhotels.in
  GMAIL_APP_PASSWORD= <Google App Password — see https://myaccount.google.com/apppasswords>
  DASHBOARD_API_KEY = <same key as CF Worker secret>

Usage:
  python3 scripts/influencer_email_sender.py --limit 30
  python3 scripts/influencer_email_sender.py --limit 5 --dry-run

Rate limits:
  Gmail SMTP: 500 emails/day for personal, 2000/day for Workspace.
  Recommended: 30/day to keep delivery clean. Don't hit "burst" pace — slow drip.
"""
import argparse
import json
import os
import smtplib
import sys
import time
import urllib.request
from datetime import datetime
from email.mime.text import MIMEText
from email.utils import formataddr, make_msgid

API_BASE = "https://hnhotels.in/api/influencer-outreach"
ENV_FILE = "/Users/nihaf/Documents/Tech/HN-Hotels-Site/.env.local"
SLEEP_BETWEEN = 8  # seconds between sends — Gmail prefers throttled delivery

def load_env(path=ENV_FILE):
    env = {}
    if not os.path.exists(path): return env
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"): continue
            if "=" not in line: continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def log(m): print(f"[{datetime.now().strftime('%H:%M:%S')}] {m}", flush=True)

def post(url, body, key=None, headers=None):
    h = {"Content-Type": "application/json"}
    if key:    h["X-Dashboard-Key"] = key
    if headers: h.update(headers)
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=h, method="POST")
    return json.load(urllib.request.urlopen(req, timeout=30))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=20, help="max sends this run")
    ap.add_argument("--dry-run", action="store_true", help="claim batch but don't actually send")
    args = ap.parse_args()

    env = load_env()
    key = env.get("DASHBOARD_API_KEY")
    sender = env.get("GMAIL_FROM") or "nihaf@hnhotels.in"
    pwd = env.get("GMAIL_APP_PASSWORD")
    if not key:
        log("MISSING DASHBOARD_API_KEY in .env.local"); sys.exit(1)
    if not pwd and not args.dry_run:
        log("MISSING GMAIL_APP_PASSWORD in .env.local"); sys.exit(1)

    log(f"Claiming batch of {args.limit} from API ...")
    batch = post(API_BASE + "?action=create-batch",
                 {"channel": "email", "limit": args.limit}, key=key)
    items = batch.get("batch", [])
    log(f"Got {len(items)} queued sends")
    if not items: return

    if args.dry_run:
        for it in items:
            print(f"  [DRY] @{it['username']} → {it['recipient']} · subj: {it['subject']}")
            print(f"        body[0..200]: {it['body'][:200]}…")
        log("Dry-run complete — no sends.")
        return

    # Connect SMTP
    log("Connecting to smtp.gmail.com:587 ...")
    try:
        smtp = smtplib.SMTP("smtp.gmail.com", 587, timeout=30)
        smtp.starttls()
        smtp.login(sender, pwd)
    except Exception as e:
        log(f"SMTP login failed: {e}"); sys.exit(1)
    log("SMTP connected")

    sent = 0; failed = 0
    for it in items:
        u = it["username"]; to = it["recipient"]; subj = it["subject"]; body = it["body"]
        token = it["token"]
        try:
            msg = MIMEText(body, "plain", "utf-8")
            msg["Subject"] = subj
            msg["From"] = formataddr(("Nihaf · Hamza Express (Est. 1918)", sender))
            msg["To"] = to
            msg["Reply-To"] = sender
            msg_id = make_msgid(domain="hnhotels.in")
            msg["Message-ID"] = msg_id
            smtp.send_message(msg)

            # Log success
            post(API_BASE + "?action=log", {
                "username": u, "channel": "email",
                "status": "sent", "recipient": to,
                "template_used": "cold_email_v1",
                "subject": subj, "message_text": body,
                "outreach_token": token,
                "provider": "gmail", "provider_msg_id": msg_id,
                "tier_assigned": it.get("tier"),
                "cover_offer": it.get("cover_offer"),
                "niche_tag": it.get("niche_tag"),
                "actor": "email_sender_local",
            }, key=key)
            sent += 1
            log(f"  ✓ @{u} → {to}")
        except Exception as e:
            failed += 1
            log(f"  ✗ @{u} → {to}  err: {e}")
            try:
                post(API_BASE + "?action=log", {
                    "username": u, "channel": "email",
                    "status": "failed", "recipient": to,
                    "bounce_reason": str(e)[:200],
                    "outreach_token": token,
                    "provider": "gmail",
                    "actor": "email_sender_local",
                }, key=key)
            except: pass
        time.sleep(SLEEP_BETWEEN)

    smtp.quit()
    log(f"\nDone — sent {sent} · failed {failed}")

if __name__ == "__main__":
    main()
