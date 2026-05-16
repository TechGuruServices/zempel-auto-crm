#!/usr/bin/env bash
# ============================================================
# Zempel Auto Parts CRM — Full-Stack Deploy Script v3.1.0
# ============================================================
# Deploys all three tiers:
#   1. Python FastAPI service → Render (via Docker)
#   2. CF Worker proxy        → Cloudflare Workers
#   3. Frontend PWA           → Cloudflare Pages
#
# Prerequisites:
#   - wrangler CLI installed and authenticated
#   - Render CLI or git push to trigger Render deploy
#   - All secrets configured (see wrangler_secrets.sh)
#
# Usage:
#   chmod +x deploy/deploy.sh
#   ./deploy/deploy.sh [--skip-python] [--skip-worker] [--skip-pages]
# ============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# ── Parse Flags ───────────────────────────────────────────────
SKIP_PYTHON=false
SKIP_WORKER=false
SKIP_PAGES=false

for arg in "$@"; do
  case "$arg" in
    --skip-python) SKIP_PYTHON=true ;;
    --skip-worker) SKIP_WORKER=true ;;
    --skip-pages)  SKIP_PAGES=true ;;
    --help|-h)
      echo "Usage: deploy.sh [--skip-python] [--skip-worker] [--skip-pages]"
      exit 0
      ;;
  esac
done

echo "═══════════════════════════════════════════════════════════"
echo "  Zempel Auto Parts CRM — Deploy (${TIMESTAMP})"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 1. Python Service (Render) ────────────────────────────────
if [ "$SKIP_PYTHON" = false ]; then
  echo "▶ [1/3] Python service — pushing to trigger Render deploy..."
  cd "${REPO_ROOT}"

  # Validate Dockerfile exists
  if [ ! -f "python-service/Dockerfile" ]; then
    echo "  ✗ python-service/Dockerfile not found!"
    exit 1
  fi

  # Validate pyproject.toml
  if [ ! -f "python-service/pyproject.toml" ]; then
    echo "  ✗ python-service/pyproject.toml not found!"
    exit 1
  fi

  echo "  ✓ Python service files validated"
  echo "  ℹ Render auto-deploys on git push to main branch."
  echo "    Run: git add -A && git commit -m 'deploy: python-service ${TIMESTAMP}' && git push origin main"
  echo ""
else
  echo "▷ [1/3] Python service — SKIPPED"
  echo ""
fi

# ── 2. Cloudflare Worker Proxy ────────────────────────────────
if [ "$SKIP_WORKER" = false ]; then
  echo "▶ [2/3] Cloudflare Worker proxy — deploying..."
  cd "${REPO_ROOT}/cloudflare-proxy"

  # Validate worker source
  if [ ! -f "worker_routes.js" ]; then
    echo "  ✗ cloudflare-proxy/worker_routes.js not found!"
    exit 1
  fi

  # Create wrangler.toml if not present
  if [ ! -f "wrangler.toml" ]; then
    echo "  ℹ Creating wrangler.toml for proxy worker..."
    cat > wrangler.toml << 'TOML'
name = "zempel-rockauto-proxy"
main = "worker_routes.js"
compatibility_date = "2026-05-01"
compatibility_flags = ["nodejs_compat"]
workers_dev = true

[observability]
enabled = true

# Create KV namespace first: wrangler kv namespace create PROXY_KV
# Then paste the returned id below.
# [[kv_namespaces]]
# binding = "PROXY_KV"
# id = "REPLACE_WITH_KV_NAMESPACE_ID"
TOML
    echo "  ⚠ Update wrangler.toml with your KV namespace ID before deploying!"
  fi

  # Deploy
  echo "  Deploying worker..."
  wrangler deploy 2>&1 | sed 's/^/  /'

  echo "  ✓ Worker proxy deployed"
  echo ""
else
  echo "▷ [2/3] Cloudflare Worker proxy — SKIPPED"
  echo ""
fi

# ── 3. Frontend PWA (Cloudflare Pages) ────────────────────────
if [ "$SKIP_PAGES" = false ]; then
  echo "▶ [3/3] Frontend PWA — deploying to Cloudflare Pages..."
  cd "${REPO_ROOT}/frontend"

  # Validate index.html
  if [ ! -f "index.html" ]; then
    echo "  ✗ frontend/index.html not found!"
    exit 1
  fi

  # Deploy to Pages
  echo "  Deploying to Cloudflare Pages..."
  wrangler pages deploy . --project-name parts-command-crm 2>&1 | sed 's/^/  /'

  echo "  ✓ Frontend PWA deployed"
  echo ""
else
  echo "▷ [3/3] Frontend PWA — SKIPPED"
  echo ""
fi

# ── Summary ───────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
echo "  ✓ Deploy complete (${TIMESTAMP})"
echo ""
echo "  Verify with:  ./deploy/verify.sh"
echo "═══════════════════════════════════════════════════════════"
