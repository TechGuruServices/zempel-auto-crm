#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

# 1. Verify src/ exists at context root
if [ ! -d "src" ]; then
  echo "[ERROR] src/ directory missing at repo root. Restoring structure..."
  mkdir -p src
  # Move misplaced files if any exist at root
  [ -f "main.py" ] && mv main.py src/
  [ -f "dependencies.py" ] && mv dependencies.py src/
  [ -d "models" ] && mv models src/
fi

# 2. Ensure git tracks src/
git rm -r --cached src/.gitignore 2>/dev/null || true
git add src/ Dockerfile .dockerignore

# 3. Commit & push
git commit -m "fix(docker): align build context with src/ layout"
git push origin HEAD
echo "[OK] Build context synchronized. Re-run pipeline."
