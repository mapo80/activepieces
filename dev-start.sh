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
# Variabili d'ambiente opzionali (default = TRUE, avvia tutto):
#   START_CLAUDE_BRIDGE=false  — NON avvia claude-code-openai-bridge
#   START_AEP=false            — NON avvia AEP backend (richiede Docker)
#   AP_LLM_VIA_BRIDGE=false    — usa MockProviderAdapter invece del bridge
#
# Pre-requisiti per AEP:
#   - Docker daemon UP (Postgres + Keycloak girano in container)
#   - Lo script gestisce kill+start di Postgres :5432, Keycloak :8081,
#     backend FastAPI :8000.
#
# RUN (default = avvia bridge + AEP-infra-Docker + AEP-backend + dev-stack)
#   ./dev-start.sh
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
kill_port 8000 "AEP backend"
# Kill known orphan node/python processes by command pattern (turbo, tsx
# watch, uvicorn, etc.). Idempotent — silently no-op if not running.
pkill -f "tsx.*packages/server/api/src/bootstrap" 2>/dev/null || true
pkill -f "tsx.*packages/server/worker/src/bootstrap" 2>/dev/null || true
pkill -f "turbo run serve" 2>/dev/null || true
pkill -f "uvicorn.*app.main:app" 2>/dev/null || true
pkill -f "claude-code-openai-bridge" 2>/dev/null || true
# Kill AEP backend processes by command pattern (FastAPI uvicorn,
# eventuali zombie del precedente start.sh be).
pkill -f "agentic-engine-platform/backend" 2>/dev/null || true
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
if [ "${START_CLAUDE_BRIDGE:-true}" = "true" ]; then
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
# Richiede Docker daemon UP per Postgres + Keycloak. Lo script AEP
# `./start.sh be` avvia SOLO il backend FastAPI; `./start.sh infra`
# avvia Docker. Eseguiamo entrambi in sequenza.
if [ "${START_AEP:-true}" = "true" ]; then
    if curl -sf "$AEP_URL/mcp/health" > /dev/null 2>&1; then
        echo "  ✓ AEP backend already running on $AEP_URL"
    elif [ ! -d "$AEP_DIR" ] || [ ! -x "$AEP_DIR/start.sh" ]; then
        echo "  ✗ START_AEP=true but $AEP_DIR/start.sh not found — ABORT"
        exit 1
    else
        # 1. Verifica che Docker daemon sia UP
        if ! docker info > /dev/null 2>&1; then
            echo "  ✗ Docker daemon non in esecuzione — necessario per AEP infra (Postgres + Keycloak)"
            echo "    Avvia Docker Desktop e rilancia ./dev-start.sh"
            echo "    Oppure: START_AEP=false ./dev-start.sh per skip AEP."
            exit 1
        fi

        # 2. Avvia infra Docker (idempotente)
        echo "  Starting AEP infra (Docker: Postgres + Keycloak)"
        ( cd "$AEP_DIR" && ./start.sh infra ) || {
            echo "  ✗ AEP infra start failed — ABORT"
            exit 1
        }

        # 3. Avvia backend FastAPI in foreground subprocess (per cleanup trap)
        echo "  Starting AEP backend: $AEP_URL  (agentic-engine-platform + MCP /mcp)"
        ( cd "$AEP_DIR" && ./start.sh be ) &
        PIDS+=($!)

        # 4. Wait su /mcp/health con timeout esteso (Postgres+Keycloak warm-up
        #    + FastAPI startup possono richiedere 60-90s al primo avvio)
        wait_for_url "$AEP_URL/mcp/health" "AEP backend" 120
        if ! curl -sf "$AEP_URL/mcp/health" > /dev/null 2>&1; then
            echo "  ✗ AEP backend non risponde su /mcp/health entro 120s — ABORT"
            exit 1
        fi
    fi
fi

# ── Activepieces dev-stack (api + worker + web + engine via turbo) ──────────
echo ""
echo "  ──────────────────────────────────────────"
echo "  Starting Activepieces dev-stack via turbo"
export AP_LLM_VIA_BRIDGE="${AP_LLM_VIA_BRIDGE:-true}"
if [ "$AP_LLM_VIA_BRIDGE" = "true" ]; then
    echo "  AP_LLM_VIA_BRIDGE=true → command layer uses VercelAIAdapter (bridge)"
else
    echo "  AP_LLM_VIA_BRIDGE=false → command layer uses MockProviderAdapter"
    echo "    To re-enable real LLM: unset AP_LLM_VIA_BRIDGE or set to 'true'."
    echo "    Then in any INTERACTIVE_FLOW action select provider"
    echo "    'custom' + model 'claude-cli' for fieldExtractor and/or"
    echo "    questionGenerator."
fi
echo "  ──────────────────────────────────────────"
echo ""

cd "$REPO_DIR"
# Subprocess + wait (non `exec`) così la trap EXIT cleanup-a anche
# bridge e AEP quando l'utente fa Ctrl+C.
npm run dev &
DEV_STACK_PID=$!
PIDS+=($DEV_STACK_PID)
wait $DEV_STACK_PID
