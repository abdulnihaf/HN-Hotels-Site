// Create App Store distribution profiles for Takht (iOS + watchOS)
// and install them into ~/Library/MobileDevice/Provisioning Profiles/
import { createSign } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { execSync } from 'child_process';

const KEY_ID = 'WSN6HFLA5F';
const ISSUER = 'e892dd20-b122-413b-9132-8687ca0c1ed5';
const P8_PATH = homedir() + '/.appstoreconnect/private_keys/AuthKey_WSN6HFLA5F.p8';
const IOS_BUNDLE = 'com.hnhotels.takht';
const WATCH_BUNDLE = 'com.hnhotels.takht.watchkitapp';
const TEAM = 'FZ58DQ52QS';
const PP_DIR = homedir() + '/Library/MobileDevice/Provisioning Profiles';

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

async function asc(path, method = 'GET', body = null) {
  const opts = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1/${path}`, opts);
  return res.json();
}

// 1. Get distribution certificate
console.log('1. Getting distribution certificate...');
const certs = await asc('certificates?filter[certificateType]=IOS_DISTRIBUTION&limit=5');
if (!certs.data?.length) { console.log('ERROR: No distribution cert found'); process.exit(1); }
const certId = certs.data[0].id;
const certName = certs.data[0].attributes.name;
console.log('   Cert:', certId, certName);

// 2. Ensure iOS bundle ID is registered
console.log('2. Getting/registering bundle IDs...');
let iosBundleId, watchBundleId;

const iosBids = await asc(`bundleIds?filter[identifier]=${IOS_BUNDLE}`);
if (iosBids.data?.length) {
  iosBundleId = iosBids.data[0].id;
  console.log('   iOS bundle ID:', iosBundleId, '(existing)');
} else {
  const reg = await asc('bundleIds', 'POST', { data: { type: 'bundleIds', attributes: { identifier: IOS_BUNDLE, name: 'Takht', platform: 'IOS', seedId: TEAM } } });
  iosBundleId = reg.data?.id;
  console.log('   iOS bundle ID registered:', iosBundleId);
}

// Register watch bundle ID
const watchBids = await asc(`bundleIds?filter[identifier]=${WATCH_BUNDLE}`);
if (watchBids.data?.length) {
  watchBundleId = watchBids.data[0].id;
  console.log('   Watch bundle ID:', watchBundleId, '(existing)');
} else {
  const reg = await asc('bundleIds', 'POST', { data: { type: 'bundleIds', attributes: { identifier: WATCH_BUNDLE, name: 'Takht Watch', platform: 'IOS', seedId: TEAM } } });
  watchBundleId = reg.data?.id;
  console.log('   Watch bundle ID registered:', watchBundleId);
}

// 3. Create iOS App Store profile
console.log('3. Creating iOS App Store provisioning profile...');
const iosProfile = await asc('profiles', 'POST', {
  data: {
    type: 'profiles',
    attributes: {
      name: 'Takht AppStore',
      profileType: 'IOS_APP_STORE'
    },
    relationships: {
      bundleId: { data: { type: 'bundleIds', id: iosBundleId } },
      certificates: { data: [{ type: 'certificates', id: certId }] },
      devices: { data: [] }
    }
  }
});

if (!iosProfile.data) {
  // Check if already exists
  console.log('   iOS profile creation:', JSON.stringify(iosProfile.errors ?? iosProfile));
  // Try to find existing
  const existing = await asc(`profiles?filter[bundleId]=${iosBundleId}&filter[profileType]=IOS_APP_STORE`);
  if (existing.data?.length) {
    console.log('   Found existing iOS profile:', existing.data[0].id);
    iosProfile.data = existing.data[0];
  } else {
    process.exit(1);
  }
}
console.log('   iOS profile:', iosProfile.data.id, iosProfile.data.attributes.name);

// 4. Create watchOS App Store profile
console.log('4. Creating watchOS App Store provisioning profile...');
let watchProfileId = null;
// Try WATCHOS_APP_STORE first, fall back to IOS_APP_STORE for embedded watch
const watchProfileBody = {
  data: {
    type: 'profiles',
    attributes: { name: 'Takht Watch AppStore', profileType: 'WATCHOS_APP_STORE' },
    relationships: {
      bundleId: { data: { type: 'bundleIds', id: watchBundleId } },
      certificates: { data: [{ type: 'certificates', id: certId }] },
      devices: { data: [] }
    }
  }
};
const watchProfile = await asc('profiles', 'POST', watchProfileBody);
if (!watchProfile.data) {
  console.log('   WATCHOS_APP_STORE failed:', JSON.stringify(watchProfile.errors ?? watchProfile));
  // Fall back to IOS_APP_STORE for the watch bundle
  watchProfileBody.data.attributes.profileType = 'IOS_APP_STORE';
  watchProfileBody.data.attributes.name = 'Takht Watch AppStore (iOS)';
  const watch2 = await asc('profiles', 'POST', watchProfileBody);
  if (!watch2.data) {
    console.log('   IOS_APP_STORE also failed:', JSON.stringify(watch2.errors ?? watch2));
    // Check existing
    const existing = await asc(`profiles?filter[bundleId]=${watchBundleId}&limit=5`);
    console.log('   Existing watch profiles:', JSON.stringify(existing.data?.map(p => p.attributes?.name + ' ' + p.attributes?.profileType) ?? []));
  } else {
    watchProfileId = watch2.data.id;
    console.log('   Watch profile (IOS_APP_STORE):', watchProfileId, watch2.data.attributes.name);
  }
} else {
  watchProfileId = watchProfile.data.id;
  console.log('   Watch profile (WATCHOS_APP_STORE):', watchProfileId, watchProfile.data.attributes.name);
}

// 5. Download and install iOS profile
console.log('5. Installing profiles...');
const iosProfileDetail = await asc(`profiles/${iosProfile.data.id}`);
const iosContent = Buffer.from(iosProfileDetail.data.attributes.profileContent, 'base64');
const iosPPPath = `${PP_DIR}/Takht_AppStore.mobileprovision`;
writeFileSync(iosPPPath, iosContent);
console.log('   iOS profile written to:', iosPPPath);

// Extract UUID from the provisioning profile
const iosUuid = iosProfileDetail.data.attributes.uuid;
console.log('   iOS profile UUID:', iosUuid);

let watchUuid = null;
if (watchProfileId) {
  const watchProfileDetail = await asc(`profiles/${watchProfileId}`);
  const watchContent = Buffer.from(watchProfileDetail.data.attributes.profileContent, 'base64');
  const watchPPPath = `${PP_DIR}/TakhtWatch_AppStore.mobileprovision`;
  writeFileSync(watchPPPath, watchContent);
  console.log('   Watch profile written to:', watchPPPath);
  watchUuid = watchProfileDetail.data.attributes.uuid;
  console.log('   Watch profile UUID:', watchUuid);
}

// 6. Write ExportOptions.plist with manual signing
console.log('6. Writing ExportOptions.plist with manual signing...');
const exportOptions = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>teamID</key>
    <string>${TEAM}</string>
    <key>signingStyle</key>
    <string>manual</string>
    <key>signingCertificate</key>
    <string>iPhone Distribution</string>
    <key>provisioningProfiles</key>
    <dict>
        <key>${IOS_BUNDLE}</key>
        <string>${iosUuid}</string>${watchUuid ? `
        <key>${WATCH_BUNDLE}</key>
        <string>${watchUuid}</string>` : ''}
    </dict>
    <key>uploadSymbols</key>
    <true/>
    <key>compileBitcode</key>
    <false/>
</dict>
</plist>`;
writeFileSync('/tmp/TakhtExportOptions.plist', exportOptions);
console.log('   Written /tmp/TakhtExportOptions.plist');
console.log('');
console.log('DONE. Run the export step now:');
console.log('xcodebuild -exportArchive -archivePath /tmp/TakhtApp.xcarchive -exportPath /tmp/TakhtApp-export -exportOptionsPlist /tmp/TakhtExportOptions.plist');
