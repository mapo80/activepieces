#!/bin/bash
# Run the estinzione e2e suite one spec file at a time, with a cooldown
# between files. Avoids cumulative load on the LLM bridge → claude-cli
# pipeline that triggers spurious timeouts when files run back-to-back.
#
# Usage: bash scripts/run-estinzione-e2e.sh

set -e
cd "$(dirname "$0")/.."

PASS_FILES=0
FAIL_FILES=0
TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_FLAKY=0
SUMMARY=""

SPEC_FILES=(
  "scenarios/ce/flows/interactive-flow/estinzione-chat-ciao.local.spec.ts"
  "scenarios/ce/flows/interactive-flow/estinzione-chat.local.spec.ts"
  "scenarios/ce/flows/interactive-flow/estinzione-chat-multiturn.local.spec.ts"
  "scenarios/ce/flows/interactive-flow/estinzione-chat-multiturn-api.local.spec.ts"
  "scenarios/ce/flows/interactive-flow/estinzione.local.spec.ts"
)

cd packages/tests-e2e
mkdir -p /tmp/estinzione-results

for SPEC in "${SPEC_FILES[@]}"; do
  NAME=$(basename "$SPEC" .local.spec.ts)
  echo "═══════════════════════════════════════════════════════════"
  echo "  RUN: $NAME"
  echo "═══════════════════════════════════════════════════════════"
  OUT_FILE="/tmp/estinzione-results/${NAME}.log"
  E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
    npx playwright test "$SPEC" --workers=1 --retries=2 --reporter=line 2>&1 | tee "$OUT_FILE" || true

  PASS=$(grep -oE "[0-9]+ passed" "$OUT_FILE" | tail -1 | grep -oE "[0-9]+" || echo "0")
  FAIL=$(grep -oE "[0-9]+ failed" "$OUT_FILE" | tail -1 | grep -oE "[0-9]+" || echo "0")
  FLAKY=$(grep -oE "[0-9]+ flaky" "$OUT_FILE" | tail -1 | grep -oE "[0-9]+" || echo "0")
  TOTAL_PASS=$((TOTAL_PASS + PASS))
  TOTAL_FAIL=$((TOTAL_FAIL + FAIL))
  TOTAL_FLAKY=$((TOTAL_FLAKY + FLAKY))

  if [ "$FAIL" = "0" ] || [ -z "$FAIL" ]; then
    PASS_FILES=$((PASS_FILES + 1))
    SUMMARY="$SUMMARY\n  ✓ $NAME — $PASS pass, $FLAKY flaky"
  else
    FAIL_FILES=$((FAIL_FILES + 1))
    SUMMARY="$SUMMARY\n  ✗ $NAME — $PASS pass / $FAIL fail / $FLAKY flaky"
  fi

  echo "  $NAME → pass=$PASS fail=$FAIL flaky=$FLAKY"
  echo "  Cooldown 30s before next spec to let bridge cool…"
  sleep 30
done

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ESTINZIONE SUITE FINAL"
echo "═══════════════════════════════════════════════════════════"
echo -e "$SUMMARY"
echo ""
echo "  Files: $PASS_FILES passed / $FAIL_FILES failed"
echo "  Tests: $TOTAL_PASS passed / $TOTAL_FAIL failed / $TOTAL_FLAKY flaky"
echo "  Logs: /tmp/estinzione-results/"

if [ "$FAIL_FILES" -gt 0 ]; then exit 1; fi
exit 0
