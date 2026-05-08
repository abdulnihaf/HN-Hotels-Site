#!/usr/bin/env bash
# verify-no-drift.sh — tripwire for protected surfaces in HN Hotels Wealth Engine.
#
# Categorizes git-diff between baseline tag and current origin/main into:
#   🔴 PROTECTED-ZONE drift (intelligence/cron/API/schema changes — BLOCKING)
#   🟡 ADDITIVE drift (new API endpoints in trading.js — review required)
#   🟢 COSMETIC drift (HTML/CSS/UI — safe)
#
# See trading/_context/18-PROTECTED-SURFACES.md for the full boundary.
#
# Exit codes: 0 = clean (no 🔴), 2 = 🔴 protected drift detected, 3 = git error.

set -u

BASELINE_TAG="${TRIPWIRE_BASELINE:-tripwire-baseline-2026-05-06-eod}"
BASELINE_SHA_FALLBACK="2949372"   # if tag missing, use this SHA
TARGET="${TRIPWIRE_TARGET:-origin/main}"

# Resolve repo root (allow running from any subdirectory).
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: not inside a git repository"
  exit 3
}
cd "$REPO_ROOT" || exit 3

git fetch origin --tags --quiet 2>/dev/null || true

# Resolve baseline ref — prefer tag, fall back to known-good SHA.
if git rev-parse --verify "${BASELINE_TAG}" >/dev/null 2>&1; then
  BASELINE_REF="${BASELINE_TAG}"
elif git rev-parse --verify "${BASELINE_SHA_FALLBACK}" >/dev/null 2>&1; then
  BASELINE_REF="${BASELINE_SHA_FALLBACK}"
  echo "ℹ️  Tag '${BASELINE_TAG}' not found; using SHA fallback ${BASELINE_SHA_FALLBACK}"
else
  echo "ERROR: cannot resolve baseline (neither tag nor SHA found)"
  exit 3
fi

echo "=================================================================="
echo "  TRIPWIRE — protected-surfaces drift check"
echo "  Baseline: ${BASELINE_REF}"
echo "  Target:   ${TARGET}"
echo "=================================================================="
echo ""

# Get all changed files
ALL_CHANGED="$(git diff --name-only "${BASELINE_REF}..${TARGET}" 2>/dev/null)" || {
  echo "ERROR: could not run git diff. Is ${TARGET} fetched?"
  exit 3
}

if [ -z "${ALL_CHANGED}" ]; then
  echo "✅ CLEAN — no files changed since baseline."
  echo ""
  exit 0
fi

# Categorize each path
PROTECTED=()
ADDITIVE=()
COSMETIC=()
UNCLASSIFIED=()

while IFS= read -r path; do
  case "${path}" in
    wealth-engine/workers/*|wealth-engine/_shared/*|wealth-engine/migrations/*)
      PROTECTED+=("${path}")
      ;;
    functions/api/trading.js)
      # Special handling: NEW switch case + NEW function = additive (allowed),
      # modifying EXISTING code = protected.  Heuristic: count - vs + lines.
      # If only additions and no deletions, it's additive.
      DEL=$(git diff "${BASELINE_REF}..${TARGET}" -- "${path}" | grep -c '^-[^-]' || true)
      if [ "${DEL}" -eq 0 ]; then
        ADDITIVE+=("${path}")
      else
        PROTECTED+=("${path}  (has ${DEL} deletions — possibly modifying existing code)")
      fi
      ;;
    functions/api/*)
      # Other API files — treat as protected unless explicitly NEW
      if git ls-tree -r "${BASELINE_REF}" --name-only | grep -qx "${path}"; then
        PROTECTED+=("${path}")
      else
        ADDITIVE+=("${path}  (new file)")
      fi
      ;;
    trading/_context/*)
      ADDITIVE+=("${path}")
      ;;
    trading/*.html|trading/**/*.html|trading/sw.js|trading/manifest.json|trading/icons/*|trading/_lib/*.js)
      COSMETIC+=("${path}")
      ;;
    *)
      UNCLASSIFIED+=("${path}")
      ;;
  esac
done <<< "${ALL_CHANGED}"

# Report
EXIT=0

if [ "${#PROTECTED[@]}" -gt 0 ]; then
  echo "🔴 PROTECTED-ZONE DRIFT (${#PROTECTED[@]} files) — BLOCKING"
  for p in "${PROTECTED[@]}"; do
    echo "   ${p}"
  done
  echo ""
  EXIT=2
fi

if [ "${#ADDITIVE[@]}" -gt 0 ]; then
  echo "🟡 ADDITIVE DRIFT (${#ADDITIVE[@]} files) — review required"
  for p in "${ADDITIVE[@]}"; do
    echo "   ${p}"
  done
  echo "   (these should be NEW switch cases / NEW functions / additive context docs only)"
  echo ""
fi

if [ "${#COSMETIC[@]}" -gt 0 ]; then
  echo "🟢 COSMETIC DRIFT (${#COSMETIC[@]} files) — safe"
  for p in "${COSMETIC[@]}"; do
    echo "   ${p}"
  done
  echo ""
fi

if [ "${#UNCLASSIFIED[@]}" -gt 0 ]; then
  echo "⚪ UNCLASSIFIED (${#UNCLASSIFIED[@]} files) — manual review"
  for p in "${UNCLASSIFIED[@]}"; do
    echo "   ${p}"
  done
  echo ""
fi

echo "=================================================================="
if [ "${EXIT}" -eq 0 ]; then
  if [ "${#ADDITIVE[@]}" -gt 0 ] || [ "${#UNCLASSIFIED[@]}" -gt 0 ]; then
    echo "🟡 NO PROTECTED DRIFT, but additive/unclassified changes need review"
  else
    echo "✅ CLEAN — only cosmetic changes since baseline"
  fi
else
  echo "🔴 BLOCKING — protected-zone drift detected. See trading/_context/18-PROTECTED-SURFACES.md"
fi
echo "=================================================================="

exit "${EXIT}"
