#!/usr/bin/env bash
# ============================================================
# Cloudflare Worker Secrets Setup — Zempel RockAuto Proxy
# ============================================================
# Run this script ONCE to configure wrangler secrets.
# Never commit actual secret values to version control.
#
# Prerequisites:
#   1. npm install -g wrangler
#   2. wrangler login
#   3. KV namespace created: wrangler kv namespace create PROXY_KV
#
# Usage:
#   chmod +x wrangler_secrets.sh
#   ./wrangler_secrets.sh
# ============================================================

set -euo pipefail

WORKER_NAME="zempel-rockauto-proxy"

echo "═══════════════════════════════════════════════════════════"
echo "  Cloudflare Worker Secrets Setup: ${WORKER_NAME}"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 1. PYTHON_SERVICE_URL ─────────────────────────────────────
echo "[1/2] Setting PYTHON_SERVICE_URL..."
echo "  Enter the full URL of your Koyeb-deployed Python service"
echo "  (e.g., https://your-app-name-xxxx.koyeb.app)"
echo ""
wrangler secret put PYTHON_SERVICE_URL --name "${WORKER_NAME}"

echo ""

# ── 2. SERVICE_AUTH_KEY ───────────────────────────────────────
echo "[2/2] Setting SERVICE_AUTH_KEY..."
echo "  Enter the API key that matches the SERVICE_AUTH_KEY env var"
echo "  on your Koyeb Python service."
echo "  Generate one with: openssl rand -hex 32"
echo ""
wrangler secret put SERVICE_AUTH_KEY --name "${WORKER_NAME}"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✓ Secrets configured for ${WORKER_NAME}"
echo ""
echo "  Next steps:"
echo "    1. Create KV namespace (if not done):"
echo "       wrangler kv namespace create PROXY_KV"
echo "    2. Update wrangler.toml with the KV namespace id"
echo "    3. Deploy: wrangler deploy"
echo "═══════════════════════════════════════════════════════════"
