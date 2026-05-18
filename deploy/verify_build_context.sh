#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
echo "Context check: $(find src -type f -name '*.py' | wc -l) Python files"
echo "Dockerfile src ref: $(grep -n 'COPY src/' Dockerfile)"
if [ -f ".dockerignore" ] && grep -q 'src' .dockerignore; then
  echo "[FAIL] .dockerignore excludes src/"
  exit 1
fi
echo "[OK] Context valid for Docker build"
