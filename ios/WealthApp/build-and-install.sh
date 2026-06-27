#!/bin/bash
set -e
PROJECT="/Users/nihaf/Documents/Tech.nosync/HN-Hotels-Site/ios/WealthApp/WealthApp.xcodeproj"
DERIVED="/tmp/wealthbuild"
TEAM="FZ58DQ52QS"

DASH_KEY=$(grep 'DASHBOARD_API_KEY' ~/.hn-assets.env | grep -v '^#' | head -1 | sed "s/.*='//;s/'.*$//")
if [ -n "$DASH_KEY" ]; then
  cat > /Users/nihaf/Documents/Tech.nosync/HN-Hotels-Site/ios/WealthApp/Wealth/Secrets.swift << 'SWIFT_END'
enum Secrets {
SWIFT_END
  echo "    static let dashboardKey = \"$DASH_KEY\"" >> /Users/nihaf/Documents/Tech.nosync/HN-Hotels-Site/ios/WealthApp/Wealth/Secrets.swift
  echo "}" >> /Users/nihaf/Documents/Tech.nosync/HN-Hotels-Site/ios/WealthApp/Wealth/Secrets.swift
  echo "Secrets.swift injected."
fi

UDID=$(xcrun xctrace list devices 2>/dev/null | grep -iE 'iphone' | grep -viE 'simulator' | sed -nE 's/.*\(([0-9A-Fa-f-]{25,})\).*/\1/p' | head -1)
CORE_ID=$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone/ && $3 ~ /^[0-9A-Fa-f-]{36}$/ {print $3; exit}')
echo "Device: $UDID / $CORE_ID"

xcodebuild \
  -project "$PROJECT" \
  -scheme Wealth \
  -configuration Debug \
  -destination "id=${UDID}" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM" \
  CODE_SIGN_STYLE=Automatic \
  build

APP=$(find "$DERIVED/Build/Products" -name "Wealth.app" ! -path "*simulator*" | head -1)
echo "Built: $APP"
TARGET="${CORE_ID:-$UDID}"
xcrun devicectl device install app --device "$TARGET" "$APP"
echo "INSTALLED on iPhone."
