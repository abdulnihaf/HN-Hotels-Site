#!/bin/bash
# Ship HN Naam + HN Takht to TestFlight — one command.
#
# RUN THIS IN A NORMAL macOS TERMINAL (not inside a sandbox), so codesign can reach the
# login keychain. Everything below is already set up:
#   - App records:  HN Takht (appId 6784121896, com.hnhotels.takht)
#                   HN Naam  (appId 6784122082, com.hnhotels.naam)
#   - Bundle IDs registered; distribution profiles installed in ~/Library/MobileDevice/Provisioning Profiles
#   - Signing cert: "iPhone Distribution: Abdul Nihaf (FZ58DQ52QS)"
#   - ASC API key:  ~/.appstoreconnect/private_keys/AuthKey_WSN6HFLA5F.p8
#
# Usage:   bash ios/ship-testflight.sh            # ships both
#          bash ios/ship-testflight.sh naam       # just Naam
#          bash ios/ship-testflight.sh takht      # just Takht
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEAM="FZ58DQ52QS"
IDENT="iPhone Distribution: Abdul Nihaf (FZ58DQ52QS)"
API_KEY="WSN6HFLA5F"
API_ISSUER="e892dd20-b122-413b-9132-8687ca0c1ed5"

ship() {           # name  dir          scheme    primary_bundle        "bundle1=Profile1;bundle2=Profile2"
  local NAME="$1" DIR="$2" SCHEME="$3" PRIMARY="$4" PROFILES="$5"
  local ARCH="/tmp/$NAME.xcarchive" EXPORT="/tmp/$NAME-export" PLIST="/tmp/$NAME-export.plist"
  echo ""; echo "############ $NAME ############"
  cd "$ROOT/$DIR"; xcodegen generate >/dev/null
  rm -rf "$ARCH" "$EXPORT"

  # primary profile name = the one matching the app's own bundle id
  local PRIMARY_PROFILE
  PRIMARY_PROFILE="$(echo "$PROFILES" | tr ';' '\n' | grep "^$PRIMARY=" | cut -d= -f2-)"

  echo ">> archive"
  xcodebuild -project "$SCHEME.xcodeproj" -scheme "$SCHEME" -configuration Release \
    -archivePath "$ARCH" -destination 'generic/platform=iOS' archive \
    CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="$TEAM" \
    PROVISIONING_PROFILE_SPECIFIER="$PRIMARY_PROFILE" CODE_SIGN_IDENTITY="$IDENT"

  echo ">> build export options"
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    echo '  <key>method</key><string>app-store-connect</string>'   # if Xcode complains, change to: app-store
    echo "  <key>teamID</key><string>$TEAM</string>"
    echo '  <key>signingStyle</key><string>manual</string>'
    echo '  <key>uploadSymbols</key><true/>'
    echo '  <key>provisioningProfiles</key><dict>'
    echo "$PROFILES" | tr ';' '\n' | while IFS='=' read -r b p; do
      [ -n "$b" ] && echo "    <key>$b</key><string>$p</string>"
    done
    echo '  </dict>'
    echo '</dict></plist>'
  } > "$PLIST"

  echo ">> export ipa"
  xcodebuild -exportArchive -archivePath "$ARCH" -exportPath "$EXPORT" -exportOptionsPlist "$PLIST"

  echo ">> upload to TestFlight"
  local IPA; IPA="$(ls "$EXPORT"/*.ipa | head -1)"
  xcrun altool --upload-app --type ios --file "$IPA" --apiKey "$API_KEY" --apiIssuer "$API_ISSUER" --show-progress
  echo "<< $NAME uploaded — App Store Connect > TestFlight will show it 'Processing' for a few minutes."
}

WHICH="${1:-both}"
if [ "$WHICH" = "naam" ] || [ "$WHICH" = "both" ]; then
  ship "HNNaam" "ios/NaamApp" "Naam" "com.hnhotels.naam" "com.hnhotels.naam=Naam AppStore"
fi
if [ "$WHICH" = "takht" ] || [ "$WHICH" = "both" ]; then
  ship "HNTakht" "ios/TakhtApp" "TakhtApp" "com.hnhotels.takht" \
       "com.hnhotels.takht=Takht AppStore;com.hnhotels.takht.watchkitapp=Takht Watch AppStore"
fi
echo ""; echo "ALL DONE. Open App Store Connect > your app > TestFlight, wait for 'Ready to Test',"
echo "then install from the TestFlight app on your iPhone."
