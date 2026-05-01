# PartsCommand CRM v2.0

**Auto parts inventory, customers, vehicles, sales, competitor price comparison, and audit logs — built for Zempel Auto.**

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Single-file SPA (`index.html`) — Tailwind CSS, Phosphor Icons, vanilla JS |
| PWA | `manifest.json` + `sw.js` (offline cache, push, background sync) |
| Backend | `worker.js` — Cloudflare Workers (REST API: `/sync`, `/prices`, `/health`) |
| Database | `schema.sql` — Neon Postgres (cloud sync) + localStorage (offline-first) |
| Deployment | Cloudflare Pages (frontend) + Cloudflare Workers (API) |
| PDF Export | jsPDF 2.5.1 + jspdf-autotable 3.8.2 (CDN) |
| Barcode/QR | html5-qrcode 2.3.8 (CDN) |

---

## Key Files

```
index.html          Main SPA (~3990 lines) — all views, logic, styles
manifest.json       PWA manifest
sw.js               Service Worker (offline, cache, background sync, push)
worker.js           Cloudflare Worker API
worker-prices-route.js  Competitor price route helper
schema.sql          Neon Postgres DDL (tables, indexes, triggers)
wrangler.toml       Cloudflare Workers config
README.md           Full deployment & usage guide
.gitignore          Git ignore rules
assets/             Zempel Auto logos and favicon
```

---

## Features

### Core Modules
- **Dashboard** — KPI cards (inventory units, low-stock, revenue, margin), low-stock alerts, recent sales
- **Inventory** — full CRUD, barcode/QR scanner, low-stock highlighting, competitor price comparison
- **Customers** — CRM with loyalty points, total spend tracking, vehicle linking
- **Vehicles** — VIN decode, make/model/year, service history linkage
- **Sales & Estimates** — line items, labor hours/rate, tax, margin calc, PDF/print
- **Price Comparison** — multi-retailer scraping via Cloudflare Worker
- **Audit Logs** — every create/update/delete action timestamped
- **Settings** — full settings page (see below)

### Settings Page
- Dark / Light mode toggle
- Compact table rows toggle
- Low-stock notification toggle
- Auto competitor price loading toggle
- Business profile (name, phone, email, address, tax rate, labor rate, currency, low-stock threshold)
- PDF exports: Inventory, Sales, Full Business Report (with cover page + KPIs)
- CSV exports: Inventory, Customers, Sales
- Google Sheets integration (CSV download + opens sheets.new)
- Full JSON backup / restore
- Force cloud sync (push to Neon Postgres)
- Clear audit logs
- Factory reset

### PWA
- Installable (manifest + service worker)
- Offline-first (localStorage + IndexedDB-style via localStorage)
- Background sync when connection restored
- Push notification ready

---

## Running Locally

The app is a static SPA — served with `npx serve`:

```
workflow: npx --yes serve -s . -l 5000
```

Open port 5000 in the Replit preview.

---

## Deployment

See `README.md` for full Cloudflare Pages + Workers deployment steps.

**Quick summary:**
1. Push to GitHub
2. Connect repo to Cloudflare Pages → build: none, output: `/`
3. `wrangler deploy` for the Worker API
4. Set `DATABASE_URL` secret in Workers dashboard (Neon Postgres connection string)

---

## Bug Fixes Applied
- `s.status === 'pending'` → `'Pending'` (case mismatch in notification badge/toggle)
- JavaScript `String.replace()` `$'` special-pattern corruption — fixed by surgical string slice instead of `.replace()` for large JS injections

---

## Environment Variables (Cloudflare Worker)
- `DATABASE_URL` — Neon Postgres connection string (set as Worker secret)

---

## User Preferences
- Dark mode by default; light mode toggleable in Settings
- All data persists in `localStorage` key `partscommand_db`
- Settings stored in `localStorage` key `pc_app_settings`
- Theme stored in `localStorage` key `pc_theme`
