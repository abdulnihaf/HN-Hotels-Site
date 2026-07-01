#!/bin/bash
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$HERE/WealthApp.xcodeproj"
DERIVED="/tmp/wealthbuild"
TEAM="FZ58DQ52QS"
SCHEME="WealthApp"
PREFERRED_CORE_ID="${WEALTH_DEVICE_CORE_ID:-0EEE75EE-0499-5DD7-A0E8-E150A7CEDBA3}"

DASH_KEY=$(grep 'DASHBOARD_API_KEY' ~/.hn-assets.env | grep -v '^#' | head -1 | sed "s/.*='//;s/'.*$//")
if [ -n "$DASH_KEY" ]; then
  cat > "$HERE/Wealth/Secrets.swift" << 'SWIFT_END'
enum Secrets {
SWIFT_END
  echo "    static let dashboardKey = \"$DASH_KEY\"" >> "$HERE/Wealth/Secrets.swift"
  echo "}" >> "$HERE/Wealth/Secrets.swift"
  echo "Secrets.swift injected."
fi

cd "$HERE"
xcodegen generate

CORE_ID=""
for attempt in 1 2 3 4 5; do
  DEVICES="$(xcrun devicectl list devices 2>/dev/null || true)"
  if echo "$DEVICES" | awk -v id="$PREFERRED_CORE_ID" '$0 ~ id && $0 !~ /unavailable/ && ($0 ~ /available/ || $0 ~ /connected/) {found=1} END {exit found ? 0 : 1}'; then
    CORE_ID="$PREFERRED_CORE_ID"
    break
  fi
  sleep 2
done

if [ -z "$CORE_ID" ]; then
  echo "Preferred Wealth iPhone is not available: $PREFERRED_CORE_ID"
  echo "$DEVICES" | awk '/iPhone/ {print}'
  echo "Refusing to install onto a different iPhone. Set WEALTH_DEVICE_CORE_ID explicitly to override."
  exit 2
fi
echo "Device core id: $CORE_ID"

xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Debug \
  -destination "generic/platform=iOS" \
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
