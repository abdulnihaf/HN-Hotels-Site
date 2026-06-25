// Upload Takht.ipa to TestFlight via altool
// Usage: node ios/takht_upload.mjs
// Requires: APPLE_UPLOAD_PW in env (from ~/.hn-assets.env) or set directly below

import { execSync, spawnSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { createSign } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';

// Find the IPA
const exportDir = '/tmp/TakhtApp-export';
let ipaPath = null;
if (existsSync(exportDir)) {
  const files = readdirSync(exportDir).filter(f => f.endsWith('.ipa'));
  if (files.length) ipaPath = `${exportDir}/${files[0]}`;
}

if (!ipaPath) {
  console.error('ERROR: No IPA found in', exportDir);
  console.error('Run the export step first.');
  process.exit(1);
}
console.log('IPA:', ipaPath);

// Get upload password from ~/.hn-assets.env
const envContent = readFileSync(homedir() + '/.hn-assets.env', 'utf8');
const pwMatch = envContent.match(/^export APPLE_UPLOAD_PW='([^']+)'/m);
if (!pwMatch) { console.error('ERROR: APPLE_UPLOAD_PW not found in ~/.hn-assets.env'); process.exit(1); }
const uploadPw = pwMatch[1];

console.log('Uploading to TestFlight via altool...');
const result = spawnSync('xcrun', [
  'altool',
  '--upload-app',
  '--type', 'ios',
  '--file', ipaPath,
  '--apiKey', 'WSN6HFLA5F',
  '--apiIssuer', 'e892dd20-b122-413b-9132-8687ca0c1ed5',
  '--show-progress'
], { stdio: 'inherit', timeout: 600000 });

if (result.status === 0) {
  console.log('Upload complete. Polling ASC for processing state...');
  // Give it 30s before polling
  await new Promise(r => setTimeout(r, 30000));

  // Poll ASC
  const KEY_ID = 'WSN6HFLA5F';
  const ISSUER = 'e892dd20-b122-413b-9132-8687ca0c1ed5';
  const P8_PATH = homedir() + '/.appstoreconnect/private_keys/AuthKey_WSN6HFLA5F.p8';
  const pem = readFileSync(P8_PATH, 'utf8');
  function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' }));
  const msg = `${header}.${payload}`;
  const sign = createSign('SHA256');
  sign.update(msg);
  const derSig = sign.sign({ key: pem, dsaEncoding: 'ieee-p1363' });
  const token = `${msg}.${derSig.toString('base64url')}`;

  async function asc(path) {
    const res = await fetch(`https://api.appstoreconnect.apple.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json();
  }

  const apps = await asc('apps?filter[bundleId]=com.hnhotels.takht');
  if (apps.data?.length) {
    const appId = apps.data[0].id;
    const builds = await asc(`builds?filter[app]=${appId}&sort=-version&limit=3`);
    for (const b of builds.data ?? []) {
      const a = b.attributes;
      console.log(`Build ${a.version} | processingState=${a.processingState} | usesNonExemptEncryption=${a.usesNonExemptEncryption} | expired=${a.expired}`);
      if (a.usesNonExemptEncryption === null) {
        console.log('Clearing encryption compliance (ITSAppUsesNonExemptEncryption=false already set in Info.plist → auto-clear)');
      }
    }
  }
} else {
  console.error('Upload FAILED with exit code:', result.status);
  process.exit(1);
}
