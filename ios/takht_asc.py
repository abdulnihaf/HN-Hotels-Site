import time, base64, json, urllib.request, os
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from cryptography.hazmat.primitives.asymmetric.ec import ECDSA
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

KEY_ID = "WSN6HFLA5F"
ISSUER = "e892dd20-b122-413b-9132-8687ca0c1ed5"
P8_PATH = os.path.expanduser("~/.appstoreconnect/private_keys/AuthKey_WSN6HFLA5F.p8")
BUNDLE_ID = "com.hnhotels.takht"

with open(P8_PATH, "rb") as f:
    private_key = f.read()

key = load_pem_private_key(private_key, password=None)
now = int(time.time())
hdr = json.dumps({"alg":"ES256","kid":KEY_ID,"typ":"JWT"}).encode()
pay = json.dumps({"iss":ISSUER,"iat":now,"exp":now+1200,"aud":"appstoreconnect-v1"}).encode()
header = base64.urlsafe_b64encode(hdr).rstrip(b'=')
payload = base64.urlsafe_b64encode(pay).rstrip(b'=')
msg = header + b'.' + payload
sig_der = key.sign(msg, ECDSA(SHA256()))
r, s = decode_dss_signature(sig_der)
raw = r.to_bytes(32,'big') + s.to_bytes(32,'big')
token = (msg + b'.' + base64.urlsafe_b64encode(raw).rstrip(b'=')).decode()

def asc(path, method="GET", body=None):
    url = "https://api.appstoreconnect.apple.com/v1/" + path
    hdrs = {"Authorization": "Bearer " + token}
    if body:
        hdrs["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    else:
        data = None
    req = urllib.request.Request(url, headers=hdrs, data=data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"error": e.code, "body": e.read().decode()}

# 1. Bundle ID
print("=== BUNDLE ID ===")
bids = asc("bundleIds?filter[identifier]=" + BUNDLE_ID)
bid_data = bids.get("data", [])
if bid_data:
    b = bid_data[0]
    print("FOUND:", b["id"], "name=" + b["attributes"]["name"])
else:
    print("NOT FOUND — registering...")
    result = asc("bundleIds", method="POST", body={
        "data": {"type": "bundleIds", "attributes": {
            "identifier": BUNDLE_ID, "name": "Takht",
            "platform": "IOS", "seedId": "FZ58DQ52QS"
        }}
    })
    if "data" in result:
        print("Registered:", result["data"]["id"])
    else:
        print("FAILED:", result)

# 2. App record
print("=== APP RECORD ===")
apps = asc("apps?filter[bundleId]=" + BUNDLE_ID)
app_data = apps.get("data", [])
if app_data:
    a = app_data[0]
    print("FOUND: app_id=" + a["id"] + " name=" + a["attributes"]["name"])
else:
    print("NOT FOUND")
    print("CREATE in ASC UI: appstoreconnect.apple.com > Apps > + > New App")
    print("  Platform: iOS | Name: Takht | Bundle: com.hnhotels.takht | SKU: takht")
