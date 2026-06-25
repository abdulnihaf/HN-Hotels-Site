#!/usr/bin/env bash
# Build NazarApp for iOS simulator and report result.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
DERIVED="$HOME/Library/Developer/NazarBuild/DerivedData"
mkdir -p "$DERIVED"

echo "=== NazarApp Simulator Build ==="

# Generate xcodeproj if xcodegen is available (idempotent)
if command -v xcodegen >/dev/null 2>&1 && [ -f "$PROJECT_DIR/project.yml" ]; then
    echo "[xcodegen] Generating project from project.yml..."
    xcodegen generate --spec "$PROJECT_DIR/project.yml" --project "$PROJECT_DIR"
    echo "[xcodegen] Done."
fi

xcodebuild \
    -project "$PROJECT_DIR/NazarApp.xcodeproj" \
    -scheme NazarApp \
    -sdk iphonesimulator \
    -destination "generic/platform=iOS Simulator" \
    -configuration Debug \
    -derivedDataPath "$DERIVED" \
    CODE_SIGNING_ALLOWED=NO \
    build 2>&1
