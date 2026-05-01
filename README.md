<p align="center">
  <img src="assets/z-auto-8.png" alt="Zempel Auto — PartsCommand CRM" width="300" />
</p>

<h1 align="center">PartsCommand CRM</h1>

<p align="center">
  <strong>Production-grade PWA for auto parts inventory, customer management, and sales — built for Zempel Auto.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0-0ea5e9?style=for-the-badge&labelColor=0f172a" alt="Version 2.0" />
  <img src="https://img.shields.io/badge/license-Proprietary-8b5cf6?style=for-the-badge&labelColor=0f172a" alt="License" />
  <img src="https://img.shields.io/badge/PWA-installable-10b981?style=for-the-badge&labelColor=0f172a" alt="PWA" />
  <img src="https://img.shields.io/badge/backend-Cloudflare_Workers-f59e0b?style=for-the-badge&labelColor=0f172a" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/database-Neon_Postgres-3b82f6?style=for-the-badge&labelColor=0f172a" alt="Neon Postgres" />
  <img src="https://img.shields.io/badge/offline-ready-06b6d4?style=for-the-badge&labelColor=0f172a" alt="Offline Ready" />
</p>

---

## Overview

**PartsCommand CRM** is a full-stack, offline-capable Progressive Web Application built exclusively for **Zempel Auto**. It delivers real-time inventory tracking, barcode and QR code scanning, customer relationship management, vehicle records, sales and estimates, live competitor price comparison, and full audit logging — all from a single installable zero-build-step interface that works on desktop, tablet, and mobile.

Data is persisted locally via `localStorage` for instant offline access and automatically synced to a **Neon Serverless PostgreSQL** database through a **Cloudflare Worker** edge API, giving you cloud durability with near-zero latency.

---

## Features

### Dashboard
- At-a-glance KPIs — total inventory units, low-stock count, all-time revenue, average margin
- Low-stock alert cards with per-item minimum thresholds
- Recent sales feed with customer names and totals
- Live notification system for pending estimates and stock warnings

### Inventory Management
- Full CRUD for auto parts — part number, name, brand, supplier, category, barcode, bin location
- **Live camera barcode scanning** — CODE_128, CODE_39, EAN-13, UPC-A, QR Code
- Inline barcode scanner inside the Add Part form for direct capture
- Quick stock adjustments (+/−) directly from the inventory table
- Multi-filter support — category, supplier, stock status
- CSV export with one click
- Cost / price / margin tracking per part

### Barcode & QR Code Scanner
- Powered by `html5-qrcode v2.3.8`
- Scans barcodes directly via the device camera (rear-facing preferred)
- Supports: `CODE_128`, `CODE_39`, `EAN-13`, `UPC-A`, `QR_CODE`
- Auto-populates barcode field on successful scan
- Graceful fallback to manual entry when camera is unavailable
- Inline scanner embedded inside the Add Part modal
- Standalone scanner accessible from the Inventory toolbar

### Customer Management
- Customer profiles — name, phone, email, address, notes
- Linked vehicle history per customer
- Purchase history and lifetime spend tracking
- Loyalty points accumulation on completed sales

### Vehicle Registry
- Year / Make / Model / VIN tracking
- Customer-linked vehicle records
- Full service history per vehicle (date, type, cost, notes)

### Sales & Estimates
- Create estimates and invoices tied to customers and vehicles
- Multi-line items with part selection from live inventory
- Labor hours + rate tracking
- Configurable tax rate per estimate
- Automatic stock deduction on sale completion
- Margin calculation per transaction
- Status workflow — Pending → Completed

### Live Competitor Price Comparison
- Real-time price fetching proxied through Cloudflare Worker edge functions
- Retailers tracked: **NAPA**, **AutoZone**, **Advance Auto Parts**
- 1-hour edge cache (Cloudflare `cf.cacheTtl`) to minimize scraping load
- Side-by-side price grid with your cost and sell price
- Results cached locally for offline reference

### Audit Logs
- Every stock change, sale, customer edit, and data modification is logged automatically
- Filterable by action type — stock updates, new records, deletions, sales
- Timestamped entries with user attribution
- Clearable log history

### Global Search
- Unified search across parts, customers, and vehicles
- Real-time filtering as you type
- Color-coded result badges by entity type

### PWA — Progressive Web App
- **Installable** on Android, iOS, Windows, macOS, and Linux via browser prompt
- **Offline-first** — the full app shell is cached; all data is available without internet
- **Service Worker** with three caching strategies:
  - App shell & local assets → Stale-while-revalidate
  - API calls → Network-first with offline fallback
  - CDN assets (Tailwind, icons, fonts) → Cache-first
- Background sync queues failed writes and replays them on reconnect
- Push notification support (registration + click handling)
- App shortcuts for quick access to Inventory and New Sale

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     CLIENT — PWA                             │
│                                                              │
│  index.html  Single-file SPA (~3,200 lines)                  │
│  ├── Tailwind CSS (CDN)                                      │
│  ├── Phosphor Icons (CDN)                                    │
│  ├── html5-qrcode 2.3.8 — barcode + QR scanner              │
│  ├── Inter + JetBrains Mono (Google Fonts)                   │
│  ├── manifest.json — PWA install metadata                    │
│  ├── sw.js — Service Worker (offline, caching, push)         │
│  └── localStorage — offline-first data cache                 │
│                                                              │
└────────────────────────┬─────────────────────────────────────┘
                         │  HTTPS
                         ▼
┌──────────────────────────────────────────────────────────────┐
│              CLOUDFLARE WORKER — Edge API                    │
│                                                              │
│  worker.js deployed to Cloudflare Workers                    │
│  ├── GET  /sync    → Pull full DB from Neon Postgres         │
│  ├── POST /sync    → Push full DB to Neon Postgres           │
│  ├── GET  /prices  → Live competitor price scraper           │
│  └── GET  /health  → Health check                            │
│                                                              │
│  Features: CORS headers, edge caching, error handling        │
└────────────────────────┬─────────────────────────────────────┘
                         │  Neon serverless HTTP API
                         ▼
┌──────────────────────────────────────────────────────────────┐
│             NEON SERVERLESS POSTGRESQL                       │
│                                                              │
│  Tables (JSONB document store pattern):                      │
│  ├── inventory       — parts catalog                         │
│  ├── customers       — customer profiles                     │
│  ├── vehicles        — vehicle registry                      │
│  ├── sales           — estimates and invoices                │
│  ├── retailer_prices — competitor price cache                │
│  └── audit_logs      — change history                        │
│                                                              │
│  Indexes on partNumber, barcode, customerId, vin, status     │
└──────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|:------|:-----------|
| **Frontend** | Vanilla HTML5 / JavaScript (ES2022), Tailwind CSS via CDN |
| **Icons** | Phosphor Icons (CDN) |
| **Typography** | Inter, JetBrains Mono (Google Fonts) |
| **Barcode / QR Scanner** | html5-qrcode v2.3.8 |
| **PWA** | Web App Manifest + Service Worker (Cache API, Background Sync, Push) |
| **Edge API** | Cloudflare Workers (V8 isolate runtime) |
| **Database** | Neon Serverless PostgreSQL (JSONB document model) |
| **Hosting — Frontend** | Cloudflare Pages (CDN edge, 200+ PoPs) |
| **Hosting — API** | Cloudflare Workers (same edge network) |
| **Offline** | localStorage cache + Service Worker stale-while-revalidate |
| **Design** | Glassmorphism, dark theme (#0a0f1a), responsive mobile-first |

---

## Project Structure

```
parts-command-crm/
├── assets/
│   ├── z-auto-7.PNG              # Primary logo (sidebar + favicon)
│   ├── z-auto-8.png              # High-res logo (PWA icon 512×512)
│   └── favicon-cropped.png       # Favicon + PWA icon 192×192
├── index.html                    # Complete SPA — UI, logic, styles (~3,200 lines)
├── manifest.json                 # PWA Web App Manifest
├── sw.js                         # Service Worker — offline, caching, push, sync
├── worker.js                     # Cloudflare Worker — full backend API
├── schema.sql                    # Neon Postgres DDL (tables, indexes, triggers)
├── worker-prices-route.js        # Legacy standalone price-route reference
├── wrangler.toml                 # Cloudflare Wrangler config (Worker + Pages)
├── .gitignore                    # Git ignore rules
└── README.md                     # This file
```

---

## Quick Start

### Prerequisites

- A modern browser (Chrome 90+, Edge 90+, Firefox 90+, Safari 15+)
- **No Node.js, no build step, no package manager required for the frontend**
- Wrangler CLI (`npm i -g wrangler`) only needed to deploy the Worker

### Run Locally

Barcode/QR scanning requires a **secure context** (HTTPS or `localhost`). Use any static file server:

```bash
# Clone
git clone https://github.com/your-org/parts-command-crm.git
cd parts-command-crm

# Python 3 (built-in)
python -m http.server 8080
# → open http://localhost:8080

# Node.js (npx, no install)
npx serve .
# → open http://localhost:3000

# VS Code
# Install "Live Server" extension → right-click index.html → "Open with Live Server"
```

The app works completely offline using `localStorage` — cloud sync is optional.

---

## Cloud Deployment

### 1 — Neon PostgreSQL (Database)

1. Create a free account at [neon.tech](https://neon.tech)
2. Create a new project → copy the **pooled connection string** (starts with `postgresql://...`)
3. (Optional) Run the schema manually:
   ```bash
   psql "<your-connection-string>" -f schema.sql
   ```
   The Worker also auto-creates all tables on first request.

### 2 — Cloudflare Worker (API)

```bash
# Install Wrangler
npm install -g wrangler

# Authenticate with Cloudflare
wrangler login

# Store your Neon connection string as a secret (never commit this)
wrangler secret put DATABASE_URL
# Paste your Neon pooled connection string and press Enter

# Deploy the Worker
wrangler deploy
```

The Worker will be live at:
`https://parts-command-api.<your-subdomain>.workers.dev`

Update `API_URL` in `index.html` (line ~491) to match your Worker URL:
```js
const API_URL = 'https://parts-command-api.<your-subdomain>.workers.dev';
```

### 3 — Cloudflare Pages (Frontend)

**Option A — Deploy via CLI:**
```bash
wrangler pages deploy . --project-name parts-command-crm
```

**Option B — Deploy via Git (recommended):**
1. Push this repository to GitHub
2. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Pages** → **New Project**
3. Connect your GitHub account → select this repository
4. Configure:
   | Setting | Value |
   |:--------|:------|
   | Build command | *(leave blank — no build step)* |
   | Build output directory | `.` (root) |
   | Root directory | `/` |
5. Click **Save and Deploy**

Your app will be live at `https://parts-command-crm.pages.dev` within seconds.

---

## API Reference

All endpoints are served from the Cloudflare Worker.

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/health` | Health check — returns `{ status: "ok", ts: "..." }` |
| `GET` | `/sync` | Pull full database snapshot from Neon Postgres |
| `POST` | `/sync` | Push full database state to Neon Postgres (upsert all records) |
| `GET` | `/prices?partNumber=BP-7842&brand=Wagner` | Fetch live competitor prices from NAPA, AutoZone, Advance Auto |

### POST /sync — Request Body

```json
{
  "inventory":      [ { "id": "INV001", "partNumber": "BP-7842", ... } ],
  "customers":      [ { "id": "CUST001", "name": "Jane Smith", ... } ],
  "vehicles":       [ { "id": "VEH001", "vin": "1HGBH41JXMN109186", ... } ],
  "sales":          [ { "id": "SALE001", "total": 247.50, ... } ],
  "retailerPrices": [ { "partNumber": "BP-7842", "napa": 34.99, ... } ],
  "auditLogs":      [ { "id": "LOG001", "action": "PART_ADDED", ... } ]
}
```

### GET /prices — Response

```json
{
  "partNumber": "BP-7842",
  "napa":      34.99,
  "autozone":  31.49,
  "advance":   29.99,
  "rockauto":  null,
  "oreilly":   null,
  "carquest":  null,
  "fetchedAt": "2026-05-01T14:22:10.000Z"
}
```

---

## PWA — Install on Device

### Android (Chrome)
1. Open the app URL in Chrome
2. Tap the **"Add to Home Screen"** banner or use ⋮ → *Add to Home Screen*
3. The app installs as a native-feeling standalone app

### iOS (Safari)
1. Open the app URL in Safari
2. Tap the **Share** icon → *Add to Home Screen*
3. The app launches full-screen without browser chrome

### Desktop (Chrome / Edge)
1. Open the app URL
2. Click the **install icon** (⊕) in the address bar
3. The app opens as a standalone window

---

## Barcode & QR Code Scanning

| Format | Example Use |
|:-------|:------------|
| `CODE_128` | Industry standard — most shelf labels |
| `CODE_39`  | Legacy auto parts barcodes |
| `EAN-13`   | European article number — OEM packaging |
| `UPC-A`    | North American retail packaging |
| `QR_CODE`  | Encoded part URLs, VIN links, supplier QR labels |

**How it works:**
- Click **Scan** in the Inventory toolbar → rear camera opens inside a modal
- Camera scans continuously at 10 fps until a code is detected
- On success, the app instantly looks up the part number in inventory
- If found: opens the Part Detail modal
- If not found: pre-fills the barcode field in the Add Part form
- Manual entry fallback always available below the camera view
- Inline scanner also available directly inside the Add Part modal

---

## Offline Behavior

| Scenario | Behavior |
|:---------|:---------|
| No internet at launch | App loads from Service Worker cache; all data from `localStorage` |
| Internet lost mid-session | All CRUD operations continue; changes queued in `localStorage` |
| Internet restored | Next `saveDB()` call automatically syncs to Cloudflare Worker |
| API Worker down | App shows a subtle console warning; continues with local data |
| First visit (no cache) | Full app loads normally; Service Worker installs in background |

---

## Security

- **No third-party analytics** — zero tracking scripts
- **CORS-restricted API** — Worker sends proper `Access-Control-Allow-Origin` headers
- **Secrets never in code** — `DATABASE_URL` stored as a Cloudflare Worker secret via `wrangler secret put`
- **No PII in URLs** — all data transferred via POST body or controlled query params
- **HTTPS enforced** — Cloudflare Pages and Workers always serve over TLS
- **localStorage is client-only** — data never leaves the device without an explicit sync call

---

## Database Schema

All tables use a **JSONB document model** — the full JavaScript object for each record is stored as a `data` JSONB column. This allows flexible schema evolution without database migrations.

```sql
-- Example: inventory table
CREATE TABLE inventory (
  id         TEXT PRIMARY KEY,      -- matches JS object id field
  data       JSONB NOT NULL,        -- full part object as JSON
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Indexes are created on frequently queried JSONB fields (`partNumber`, `barcode`, `vin`, `customerId`, `status`) for fast lookups without full-table scans.

---

## Roadmap

- [ ] Role-based access control (Admin / Technician / Sales)
- [ ] PDF invoice & estimate generation (client-side)
- [ ] Push notifications for low-stock alerts
- [ ] RockAuto & O'Reilly price integration
- [ ] Supplier purchase order workflow
- [ ] Customer portal (read-only vehicle / service history)
- [ ] Dark / light theme toggle
- [ ] Multi-shop / multi-location support
- [ ] Stripe payment link generation on estimates

---

## Contributing

This is a private project for **Zempel Auto**. If you have been granted access:

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit using conventional commits: `git commit -m "feat: add new feature"`
4. Push to your branch: `git push origin feat/my-feature`
5. Open a Pull Request — include a description and screenshots

---

## License

**Proprietary** — © 2026 Zempel Auto. All rights reserved.

Unauthorized copying, distribution, or modification of this software is strictly prohibited.

---

<p align="center">
  <img src="assets/z-auto-8.png" alt="Zempel Auto" width="100" /><br/>
  <sub>Built for Zempel Auto — PartsCommand CRM v2.0</sub>
</p>
