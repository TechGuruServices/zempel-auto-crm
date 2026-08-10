# Fix pass — RockAuto Catalog / Compare Parts / Operations nav

All issues below were confirmed by reading the actual code paths (not guessed),
and where possible verified by execution (Playwright click-through, a real
`pip install` against the Dockerfile's build steps, importing the FastAPI app
against the real published `rockauto-api` PyPI package). Full detail in each
file's diff; short version here.

## 1. Operations nav — dead clicks / no highlight
**File:** `frontend/index.html`

"Compare" and "RockAuto Catalog" used `data-view="..."` while every other nav
item uses `data-nav="..."`. The active-state highlighter only ever looks for
`data-nav`, so those two links never lit up. There were also duplicate entries
("Compare" and "Price Comparison" both called `navigate('comparison')") in both
the desktop sidebar and the mobile hamburger menu. Removed the duplicates,
standardized on `data-nav`, and made the highlight-reset logic also cover
`.mobile-nav-item` so the hamburger menu doesn't accumulate stale highlights.

## 2. Compare / Price Comparison page — silently does nothing when clicked
**Files:** `frontend/index.html`, `backend/worker.js`

Root cause: the `/prices` live-lookup endpoint (triggered by the barcode
scanner autofill in Inventory, among other places) always persisted
`oreilly: null, carquest: null` and never set `ourPrice`/`ourCost` at all when
saving to the database — because those two retailers were never actually
implemented, and this endpoint has no concept of "your price/cost." That
malformed record synced down to every client and `renderComparison()` called
`.toFixed(2)` directly on those fields with no null-check. The throw happened
*before* `el.innerHTML` was assigned, so the page just stayed on whatever was
showing before the click — indistinguishable from "nothing happens."

Fixes:
- `backend/worker.js`: `handlePriceLookup` now merges with any existing DB row
  instead of blind-overwriting, and defaults missing fields to `0` instead of
  `null`/undefined.
- `frontend/index.html`: added `retailerPrices` handling to the existing
  `sanitizeDB()` self-healing migration (same pattern already used for
  invoices) — it now repairs old bad records by numeric-coercing all
  competitor fields and backfilling `ourPrice`/`ourCost` from matching
  inventory records when possible. `sanitizeDB()` now also runs on every
  `saveDB()`, not just initial load/cloud-sync. Added a second, inline
  defensive coercion pass directly in `renderComparison()` as belt-and-suspenders.

## 3. RockAuto Catalog — Make/Year/Model/Engine all worked, Parts was always empty
**Files:** `src/main.py`, `cloudflare-proxy/worker_routes.js`, `backend/worker.js`,
`frontend/rockauto-fetch.js`, `frontend/rockauto-ui.js`, `frontend/index.html`

Root cause: `GET /api/rockauto/parts/{carcode}` called
`client.search_parts_by_number(carcode)` — a method for looking up a
manufacturer part number — using the vehicle's internal carcode as if it were
a part number. This returned zero results for every vehicle, every time. The
real client library requires a two-step chain: `get_part_categories()` to list
part categories for the vehicle (Brakes, Filters, Ignition, ...), then
`get_parts_by_category()` for the actual parts in a chosen category. That
categories step never existed anywhere in the stack.

Fixes (all layers, so the URLs stay consistent end to end):
- `src/main.py`: added `GET /api/rockauto/categories/{make}/{year}/{model}/{carcode}`;
  changed `GET /api/rockauto/parts/{carcode}` to
  `GET /api/rockauto/parts/{make}/{year}/{model}/{carcode}/{category}`, now calling
  `get_parts_by_category`. Verified against the real PyPI `rockauto-api==1.0.0`
  package that both methods exist with these signatures.
- `cloudflare-proxy/worker_routes.js` and `backend/worker.js` (the frontend
  actually calls the latter — see comment in `backend/wrangler.toml`): added
  the `/v1/rockauto/categories/...` route and fixed the `/v1/rockauto/parts/...`
  route to carry make/year/model/carcode/category instead of a bare carcode.
- `frontend/rockauto-fetch.js`: added `getCategories()`, fixed `getParts()` signature.
- `frontend/rockauto-ui.js`: added `renderCategories()`.
- `frontend/index.html` (`renderRockAuto`): added a `loadCategories()` step
  between engine selection and parts loading, with breadcrumb support.

## 4. Dockerfile — could not build at all
**File:** `Dockerfile`

Three literal corruptions guaranteed a failed build:
- `COPY src/ ./srcRUN python -m compileall src/` — two instructions merged
  onto one line with no newline between them.
- `EXPOSE 8000x` — invalid port.
- A trailing garbage line `saZAzZ` after the `CMD` instruction.

After fixing those and actually test-building the `pip install` step, found
two more real (independent) issues:
- `pyproject.toml` declares `readme = "README.md"`, but the builder stage only
  copied `pyproject.toml` — hatchling hard-fails at the metadata step without
  the README present. Now copies both.
- Hatchling couldn't auto-detect what to package (the code lives in loose
  files under `src/`, not a directory matching the project name
  `zempel-rockauto-service`). Added `[tool.hatch.build.targets.wheel]
  packages = ["src"]` to `pyproject.toml`, per hatchling's own suggested fix.

Verified: `pip install --prefix=/install .` now completes successfully, and
`from main import app` imports cleanly with all expected routes registered.

## Testing performed
- `node --check` on every touched JS file (no syntax errors).
- `python -m py_compile` + `ast.parse` on `src/main.py` (no syntax errors).
- Installed the project into a clean venv exactly as the Dockerfile does;
  confirmed the build now succeeds (it previously failed at metadata
  generation before *any* of these fixes).
- Imported the FastAPI app and printed its route table — confirmed the new
  `/api/rockauto/categories/...` route and corrected `/api/rockauto/parts/...`
  route are registered as expected.
- Imported the real `rockauto_api` package from PyPI (not the vendored copy in
  `rockauto-api-main/`) and confirmed `get_part_categories` /
  `get_parts_by_category` exist on `RockAutoClient`.
- Served the frontend locally and drove it with Playwright: confirmed no
  `data-view` attributes remain, no duplicate nav links, nav highlighting
  works, and — most importantly — injected a malformed `retailerPrices`
  record (the exact shape the old `/prices` endpoint used to write: null
  `oreilly`/`carquest`, no `ourPrice`/`ourCost`) into local storage before
  load and confirmed the Compare page now renders it correctly (recovering
  the real price from inventory) instead of silently failing to render.

## Known limitation of this test pass
This sandbox's network is restricted to a small domain allowlist and cannot
reach the CDN scripts (Tailwind, Phosphor icons, etc.) or the live Cloudflare
Workers / Koyeb services this app depends on. Console 403/503 noise from those
blocked external calls in the test logs is a sandbox artifact, not an app bug.
The full live round trip (Worker → FastAPI → RockAuto) should be spot-checked
in your real environment, particularly:
- That `PYTHON_SERVICE_URL` and `SERVICE_AUTH_KEY` secrets are set on the
  **`parts-command-api`** worker (not `zempel-rockauto-proxy` — the frontend
  never calls that one; see the comment already in `backend/wrangler.toml`).
- That the Koyeb Python service redeploys successfully now that the Dockerfile
  builds.
