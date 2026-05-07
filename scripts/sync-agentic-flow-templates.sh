#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLATFORM_DIR="${AGENTIC_PLATFORM_DIR:-"${ROOT_DIR}/../agentic-workflow-platform"}"
OUTPUT_DIR="${ROOT_DIR}/fixtures/agentic-flow-templates"
PLATFORM_CP=""

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

build_platform_classpath() {
  local cp_file
  cp_file="$(mktemp)"

  (
    cd "$PLATFORM_DIR"
    mvn -q -pl src/capability-publish -am -DskipTests compile
    mvn -q -f src/capability-publish/pom.xml -DskipTests \
      dependency:build-classpath -Dmdep.outputFile="$cp_file"
  )

  PLATFORM_CP="$PLATFORM_DIR/src/capability-publish/target/classes"
  PLATFORM_CP="$PLATFORM_CP:$PLATFORM_DIR/src/activepieces-runtime-provider/target/classes"
  PLATFORM_CP="$PLATFORM_CP:$PLATFORM_DIR/src/capability-index/target/classes"
  PLATFORM_CP="$PLATFORM_CP:$PLATFORM_DIR/src/platform-tool-plane/target/classes"
  PLATFORM_CP="$PLATFORM_CP:$PLATFORM_DIR/src/workflow-runtime-provider/target/classes"
  PLATFORM_CP="$PLATFORM_CP:$PLATFORM_DIR/src/conversation-core/target/classes"
  PLATFORM_CP="$PLATFORM_CP:$PLATFORM_DIR/src/event-journal/target/classes"
  PLATFORM_CP="$PLATFORM_CP:$PLATFORM_DIR/src/platform-governance/target/classes"
  PLATFORM_CP="$PLATFORM_CP:$PLATFORM_DIR/src/platform-contracts/target/classes"
  PLATFORM_CP="$PLATFORM_CP:$(cat "$cp_file")"
  rm -f "$cp_file"
}

export_flow() {
  local bundle_name="$1"
  local output="$2"
  local capability_id="$3"
  local tmp
  tmp="$(mktemp)"

  java -cp "$PLATFORM_CP" \
    it.linksmt.agentic.workflow.platform.capability.publish.runtime.BundleApFlowExportMain \
    "$bundle_name" > "$tmp"

  jq -e --arg capability_id "$capability_id" '
    select(type == "object")
    | select(.metadata.platformCapabilityId == $capability_id)
    | select(.metadata.sourceOfTruth == "workflow.canonical")
    | select(.metadata.designerSource == "canonical-compiler")
    | select(.metadata.runtimeProviderId == "activepieces")
    | select(.metadata.canonicalHash | test("^[0-9a-f]{64}$"))
    | select(has("projectId") | not)
  ' "$tmp" > "$output"
  rm -f "$tmp"

  echo "wrote ${output#$ROOT_DIR/}"
}

require jq
require mvn
require java
mkdir -p "$OUTPUT_DIR"
build_platform_classpath

export_flow \
  "banking-account-closure" \
  "$OUTPUT_DIR/banking-account-closure.ap-flow.json" \
  "banking.accountClosure"

export_flow \
  "pa-gaia-commons" \
  "$OUTPUT_DIR/pa-gaia-commons.ap-flow.json" \
  "pa.gaiaCommonsAssistant"
