#!/bin/bash
# dev-start.sh — orchestrator for the agentic-workflow-provider dev-stack.
#
# Layout (E07): Postgres + Redis run as Docker containers on the host network
# so production wiring is mirrored. AP itself runs locally via `npm run dev`
# (turbo: web :4200 + api :3000 + worker + engine). The Java side
# `activepieces-runtime-provider` and the Playwright suite both target this
# stack.
#
# Pre-flight: kill stale processes on dev ports (4200 web, 3000 api) and
#             tear down any prior turbo / tsx orphans.
#
# RUN:           ./dev-start.sh
# Skip Docker:   USE_LOCAL_DB=true ./dev-start.sh   (assume pg/redis already up)
# Skip AP:       START_AP=false ./dev-start.sh      (only infra)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

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
    if [ "${USE_LOCAL_DB:-false}" != "true" ]; then
        echo "  Stopping docker compose (postgres + redis)"
        ( cd "$REPO_DIR" && docker compose -f docker-compose.dev.yml down ) || true
    fi
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── kill stale processes on dev ports ────────────────────────────────────────
kill_port() {
    local port="$1"
    local label="$2"
    local pids
    pids=$(lsof -ti:"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "  ⚠ Port $port ($label) busy by PID(s): $pids — killing"
        echo "$pids" | xargs -I{} kill -TERM {} 2>/dev/null || true
        sleep 1
        pids=$(lsof -ti:"$port" 2>/dev/null || true)
        if [ -n "$pids" ]; then
            echo "$pids" | xargs -I{} kill -9 {} 2>/dev/null || true
        fi
    fi
}

echo "  ──────────────────────────────────────────"
echo "  Pre-flight: killing stale processes on dev ports"
echo "  ──────────────────────────────────────────"
kill_port 4200 "AP web"
kill_port 3000 "AP api"
pkill -f "tsx.*packages/server/api" 2>/dev/null || true
pkill -f "tsx.*packages/server/worker" 2>/dev/null || true
pkill -f "turbo run serve" 2>/dev/null || true
sleep 1

# ── Docker compose up postgres + redis ───────────────────────────────────────
if [ "${USE_LOCAL_DB:-false}" != "true" ]; then
    echo ""
    echo "  ──────────────────────────────────────────"
    echo "  Starting Postgres + Redis via docker compose"
    echo "  ──────────────────────────────────────────"
    if ! docker info > /dev/null 2>&1; then
        echo "  ✗ Docker daemon non in esecuzione — avvia Docker Desktop e riprova"
        echo "    Oppure: USE_LOCAL_DB=true ./dev-start.sh per skippare Docker"
        exit 1
    fi
    docker compose -f "$REPO_DIR/docker-compose.dev.yml" up -d db redis

    echo "  Waiting for Postgres readiness ..."
    for i in $(seq 1 30); do
        if docker compose -f "$REPO_DIR/docker-compose.dev.yml" exec -T db \
                pg_isready -U postgres -d activepieces > /dev/null 2>&1; then
            echo "  ✓ Postgres ready"
            break
        fi
        sleep 2
        if [ "$i" -eq 30 ]; then
            echo "  ✗ Postgres not ready after 60s — abort"
            exit 1
        fi
    done

    echo "  Waiting for Redis readiness ..."
    for i in $(seq 1 15); do
        if docker compose -f "$REPO_DIR/docker-compose.dev.yml" exec -T redis \
                redis-cli ping 2>/dev/null | grep -q PONG; then
            echo "  ✓ Redis ready"
            break
        fi
        sleep 1
        if [ "$i" -eq 15 ]; then
            echo "  ✗ Redis not ready after 15s — abort"
            exit 1
        fi
    done
fi

# ── Activepieces dev-stack (api + worker + web + engine via turbo) ──────────
if [ "${START_AP:-true}" = "true" ]; then
    echo ""
    echo "  ──────────────────────────────────────────"
    echo "  Starting Activepieces dev-stack via turbo"
    echo "  Frontend: http://localhost:4200"
    echo "  API:      http://localhost:3000"
    echo "  ──────────────────────────────────────────"

    cd "$REPO_DIR"
    if [ ! -d node_modules ]; then
        echo "  Running 'npm install' (first run, ~10-15 min) ..."
        npm install
    fi

    npm run dev &
    DEV_STACK_PID=$!
    PIDS+=($DEV_STACK_PID)
    wait $DEV_STACK_PID
fi
