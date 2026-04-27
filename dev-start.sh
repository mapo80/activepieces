#!/bin/bash
# dev-start.sh — orchestratore del dev-stack INTERACTIVE_FLOW.
#
# Pre-flight: killa qualsiasi processo già listening sulle porte dev
# (3000 API, 4200 frontend, 8787 bridge, 8000 AEP) + processi orfani
# noti (tsx watch, turbo, uvicorn).
#
# Avvia (se richiesto) bridge LLM + AEP backend, poi `npm run dev` (turbo:
# web + api + engine + worker).
#
# Variabili d'ambiente opzionali:
#   START_CLAUDE_BRIDGE=true   — avvia claude-code-openai-bridge su :8787
#   START_AEP=true             — avvia AEP backend (FastAPI) su :8000
#   AP_LLM_VIA_BRIDGE=true     — propagato a turbo: il command layer usa
#                                VercelAIAdapter via bridge (default off →
#                                MockProviderAdapter).
#
# RUN
#   START_CLAUDE_BRIDGE=true START_AEP=true AP_LLM_VIA_BRIDGE=true ./dev-start.sh
#
# Stop: Ctrl+C — la trap pulisce i processi figli (bridge, AEP, turbo).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
BRIDGE_DIR="$(cd "$REPO_DIR/.." && pwd -P)/claude-code-openai-bridge"
AEP_DIR="$(cd "$REPO_DIR/.." && pwd -P)/agentic-engine-platform"

BRIDGE_URL="http://localhost:8787"
AEP_URL="http://localhost:8000"
FRONTEND_URL="http://localhost:4200"

PIDS=()
cleanup() {
    echo ""
    echo "  ──────────────────────────────────────────"
    echo "  Stopping dev-stack (PIDs: ${PIDS[*]:-none})"
    echo "  ──────────────────────────────────────────"
    for pid in "${PIDS[@]:-}"; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── Kill anything already listening on the ports we need ────────────────────
# Risolve il problema "address already in use" e processi orfani da run
# precedenti (es. tsx watch zombie, AEP/bridge da sessioni passate).
kill_port() {
    local port="$1"
    local label="$2"
    local pids
    pids=$(lsof -ti:"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "  ⚠ Port $port ($label) busy by PID(s): $pids — killing"
        echo "$pids" | xargs -I{} kill -TERM {} 2>/dev/null || true
        sleep 1
        # Force-kill any survivor
        pids=$(lsof -ti:"$port" 2>/dev/null || true)
        if [ -n "$pids" ]; then
            echo "$pids" | xargs -I{} kill -9 {} 2>/dev/null || true
        fi
    fi
}

echo "  ──────────────────────────────────────────"
echo "  Pre-flight: killing any stale processes on dev ports"
echo "  ──────────────────────────────────────────"
kill_port 3000 "API"
kill_port 4200 "frontend"
kill_port 8787 "bridge"
kill_port 8000 "AEP"
# Kill known orphan node/python processes by command pattern (turbo, tsx
# watch, uvicorn, etc.). Idempotent — silently no-op if not running.
pkill -f "tsx.*packages/server/api/src/bootstrap" 2>/dev/null || true
pkill -f "tsx.*packages/server/worker/src/bootstrap" 2>/dev/null || true
pkill -f "turbo run serve" 2>/dev/null || true
pkill -f "uvicorn.*app.main:app" 2>/dev/null || true
pkill -f "claude-code-openai-bridge" 2>/dev/null || true
sleep 2

wait_for_url() {
    local url="$1"
    local label="$2"
    local timeout_s="${3:-60}"
    local elapsed=0
    echo "  Waiting for $label on $url ..."
    while [ "$elapsed" -lt "$timeout_s" ]; do
        if curl -sf "$url" > /dev/null 2>&1; then
            echo "  ✓ $label ready"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    echo "  ⚠ $label /health did not reach 'ok' within ${timeout_s}s — it may still be loading."
    return 0
}

# ── Bridge (claude-code-openai-bridge) ──────────────────────────────────────
if [ "${START_CLAUDE_BRIDGE:-false}" = "true" ]; then
    if curl -sf "$BRIDGE_URL/health" > /dev/null 2>&1; then
        echo "  ✓ Bridge already running on $BRIDGE_URL"
    elif [ -d "$BRIDGE_DIR" ]; then
        echo "  Starting Claude Code OpenAI bridge: $BRIDGE_URL"
        ( cd "$BRIDGE_DIR" && npm run dev ) &
        PIDS+=($!)
        wait_for_url "$BRIDGE_URL/health" "bridge" 30
    else
        echo "  ⚠ START_CLAUDE_BRIDGE=true but $BRIDGE_DIR not found — skipping"
    fi
fi

# ── AEP backend (banking MCP tools + FastAPI) ───────────────────────────────
if [ "${START_AEP:-false}" = "true" ]; then
    if curl -sf "$AEP_URL/mcp/health" > /dev/null 2>&1; then
        echo "  ✓ AEP backend already running on $AEP_URL"
    elif [ -d "$AEP_DIR" ] && [ -x "$AEP_DIR/start.sh" ]; then
        echo "  Starting AEP backend: $AEP_URL  (agentic-engine-platform + MCP /mcp)"
        ( cd "$AEP_DIR" && ./start.sh be 2>&1 ) &
        PIDS+=($!)
        wait_for_url "$AEP_URL/mcp/health" "AEP" 60
    else
        echo "  ⚠ START_AEP=true but $AEP_DIR/start.sh not found — skipping"
    fi
fi

# ── Activepieces dev-stack (api + worker + web + engine via turbo) ──────────
echo ""
echo "  ──────────────────────────────────────────"
echo "  Starting Activepieces dev-stack via turbo"
if [ "${AP_LLM_VIA_BRIDGE:-false}" = "true" ]; then
    echo "  AP_LLM_VIA_BRIDGE=true → command layer uses VercelAIAdapter (bridge)"
else
    echo "  AP_LLM_VIA_BRIDGE not set → command layer uses MockProviderAdapter"
    echo "    Set 'export AP_LLM_VIA_BRIDGE=true' to use real LLM via bridge."
    echo "    Then in any INTERACTIVE_FLOW action select provider"
    echo "    'custom' + model 'claude-cli' for fieldExtractor and/or"
    echo "    questionGenerator."
fi
echo "  ──────────────────────────────────────────"
echo ""

cd "$REPO_DIR"
exec npm run dev
