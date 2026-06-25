import { createSign } from 'crypto';
import { readFileSync } from 'fs';
import { homedir } from 'os';

const KEY_ID = 'WSN6HFLA5F';
const ISSUER = 'e892dd20-b122-413b-9132-8687ca0c1ed5';
const BUNDLE_ID = 'com.hnhotels.takht';
const P8_PATH = homedir() + '/.appstoreconnect/private_keys/AuthKey_WSN6HFLA5F.p8';

const pem = readFileSync(P8_PATH, 'utf8');

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
const payload = b64url(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' }));
const msg = `${header}.${payload}`;
const sign = createSign('SHA256');
sign.update(msg);
const derSig = sign.sign({ key: pem, dsaEncoding: 'ieee-p1363' });
const token = `${msg}.${derSig.toString('base64url')}`;

async function asc(path, method = 'GET', body = null) {
  const opts = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1/${path}`, opts);
  return res.json();
}

// 1. Check / register bundle ID
console.log('=== BUNDLE ID ===');
const bids = await asc(`bundleIds?filter[identifier]=${BUNDLE_ID}`);
let bundleFound = false;
for (const b of bids.data ?? []) {
  console.log('FOUND:', b.id, '| name=' + b.attributes.name + ' | platform=' + b.attributes.platform);
  bundleFound = true;
}
if (!bundleFound) {
  console.log('NOT FOUND — registering...');
  const reg = await asc('bundleIds', 'POST', {
    data: { type: 'bundleIds', attributes: { identifier: BUNDLE_ID, name: 'Takht', platform: 'IOS', seedId: 'FZ58DQ52QS' } }
  });
  if (reg.data) {
    console.log('Registered:', reg.data.id);
  } else {
    console.log('FAILED:', JSON.stringify(reg.errors ?? reg));
  }
}

// 2. Check app record
console.log('\n=== APP RECORD ===');
const apps = await asc(`apps?filter[bundleId]=${BUNDLE_ID}`);
if (apps.data?.length) {
  const a = apps.data[0];
  console.log('FOUND: app_id=' + a.id + ' | name=' + a.attributes.name);
  console.log('READY_FOR_UPLOAD: yes');
} else {
  console.log('NOT FOUND');
  console.log('READY_FOR_UPLOAD: no');
  console.log('');
  console.log('CREATE in App Store Connect (60-second UI step):');
  console.log('  1. appstoreconnect.apple.com → Apps → + → New App');
  console.log('  2. Platform: iOS');
  console.log('  3. Name: Takht');
  console.log('  4. Primary Language: English (India)');
  console.log('  5. Bundle ID: com.hnhotels.takht');
  console.log('  6. SKU: takht');
  console.log('  7. User Access: Full Access → Create');
  console.log('');
  console.log('Then let me know and I will archive + upload immediately.');
}
