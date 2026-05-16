#!/usr/bin/env bash
# ============================================================
# Zempel Auto Parts CRM — Post-Deploy Verification v3.1.0
# ============================================================
# Validates all three tiers are reachable and healthy.
#
# Checks:
#   1. Python FastAPI service /health (Koyeb)
#   2. CF Worker proxy /health
#   3. Frontend PWA (Cloudflare Pages) — HTTP 200
#   4. Security headers on all endpoints
#   5. CORS headers on proxy
#
# Usage:
#   chmod +x deploy/verify.sh
#   ./deploy/verify.sh
#
# Environment (override defaults):
#   PYTHON_URL   — Koyeb service URL
#   PROXY_URL    — CF Worker proxy URL
#   FRONTEND_URL — CF Pages URL
# ============================================================

set -euo pipefail

# ── Defaults (override via env vars) ─────────────────────────
PYTHON_URL="${PYTHON_URL:-https://zempel-rockauto-service.koyeb.app}"
PROXY_URL="${PROXY_URL:-https://zempel-rockauto-proxy.techguruofficial.workers.dev}"
FRONTEND_URL="${FRONTEND_URL:-https://zempel-auto-crm.pages.dev}"
ALLOWED_ORIGIN="https://zempel-auto-crm.pages.dev"

PASS=0
FAIL=0
WARN=0

check() {
  local label="$1" url="$2" expect="$3"
  local status body

  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url" 2>/dev/null || echo "000")

  if [ "$status" = "$expect" ]; then
    echo "  ✓ ${label} — HTTP ${status}"
    PASS=$((PASS + 1))
  else
    echo "  ✗ ${label} — HTTP ${status} (expected ${expect})"
    FAIL=$((FAIL + 1))
  fi
}

check_header() {
  local label="$1" url="$2" header="$3"
  local value

  value=$(curl -s -I --max-time 10 "$url" 2>/dev/null | grep -i "^${header}:" | head -1 || echo "")

  if [ -n "$value" ]; then
    echo "  ✓ ${label} — ${value}"
    PASS=$((PASS + 1))
  else
    echo "  ✗ ${label} — header '${header}' missing"
    FAIL=$((FAIL + 1))
  fi
}

check_cors() {
  local label="$1" url="$2" origin="$3"
  local acao

  acao=$(curl -s -I --max-time 10 \
    -H "Origin: ${origin}" \
    -X OPTIONS \
    "$url" 2>/dev/null | grep -i "^access-control-allow-origin:" | head -1 || echo "")

  if echo "$acao" | grep -qi "$origin"; then
    echo "  ✓ ${label} — CORS allows ${origin}"
    PASS=$((PASS + 1))
  elif echo "$acao" | grep -qi "\*"; then
    echo "  ⚠ ${label} — CORS wildcard detected (should be strict)"
    WARN=$((WARN + 1))
  else
    echo "  ✗ ${label} — CORS missing or wrong origin"
    FAIL=$((FAIL + 1))
  fi
}

echo "═══════════════════════════════════════════════════════════"
echo "  Zempel Auto Parts CRM — Post-Deploy Verification"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 1. Python Service (Koyeb) ────────────────────────────────
echo "[1/5] Python FastAPI Service (${PYTHON_URL})"
check "Health endpoint" "${PYTHON_URL}/health" "200"
echo ""

# ── 2. CF Worker Proxy ────────────────────────────────────────
echo "[2/5] Cloudflare Worker Proxy (${PROXY_URL})"
check "Proxy health" "${PROXY_URL}/health" "200"
check "Makes endpoint" "${PROXY_URL}/v1/rockauto/makes" "200"
echo ""

# ── 3. Frontend PWA ──────────────────────────────────────────
echo "[3/5] Frontend PWA (${FRONTEND_URL})"
check "Index page" "${FRONTEND_URL}/" "200"
check "Manifest" "${FRONTEND_URL}/manifest.json" "200"
check "Service worker" "${FRONTEND_URL}/sw.js" "200"
echo ""

# ── 4. Security Headers ──────────────────────────────────────
echo "[4/5] Security Headers"
check_header "HSTS (proxy)" "${PROXY_URL}/health" "strict-transport-security"
check_header "X-Content-Type-Options (proxy)" "${PROXY_URL}/health" "x-content-type-options"
check_header "X-Frame-Options (proxy)" "${PROXY_URL}/health" "x-frame-options"
check_header "Referrer-Policy (proxy)" "${PROXY_URL}/health" "referrer-policy"
echo ""

# ── 5. CORS Validation ───────────────────────────────────────
echo "[5/5] CORS Validation"
check_cors "Proxy CORS (allowed)" "${PROXY_URL}/health" "${ALLOWED_ORIGIN}"

# Test that a disallowed origin is rejected
REJECT_ACAO=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -H "Origin: https://evil.example.com" \
  "${PROXY_URL}/v1/rockauto/makes" 2>/dev/null || echo "000")

if [ "$REJECT_ACAO" = "403" ]; then
  echo "  ✓ CORS rejects unknown origin — HTTP 403"
  PASS=$((PASS + 1))
else
  echo "  ⚠ CORS did not reject unknown origin — HTTP ${REJECT_ACAO}"
  WARN=$((WARN + 1))
fi
echo ""

# ── Summary ───────────────────────────────────────────────────
TOTAL=$((PASS + FAIL + WARN))
echo "═══════════════════════════════════════════════════════════"
echo "  Results: ${PASS}/${TOTAL} passed, ${FAIL} failed, ${WARN} warnings"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "  ✗ VERIFICATION FAILED — review errors above"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo "  ⚠ PASSED WITH WARNINGS — review items above"
  exit 0
else
  echo "  ✓ ALL CHECKS PASSED"
  exit 0
fi
