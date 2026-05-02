<p align="center">
  <img src="https://i.imgur.com/tuBAEOR.png" alt="Zempel Auto — PartsCommand CRM" width="360" />
</p>

<h2> align="center">
  ZEMPEL AUTO  |  Auto Parts +  CMR</h2>
</p align="center">
  <strong>The all-in-one auto parts inventory, customer, and sales management platform built for speed.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0-0ea5e9?style=for-the-badge&labelColor=0f172a" alt="Version 2.0" />
  <img src="https://img.shields.io/badge/license-Proprietary-8b5cf6?style=for-the-badge&labelColor=0f172a" alt="License" />
  <img src="https://img.shields.io/badge/platform-PWA-10b981?style=for-the-badge&labelColor=0f172a" alt="Platform PWA" />
  <img src="https://img.shields.io/badge/backend-Cloudflare_Workers-f59e0b?style=for-the-badge&labelColor=0f172a" alt="Backend" />
  <img src="https://img.shields.io/badge/database-Neon_Postgres-3b82f6?style=for-the-badge&labelColor=0f172a" alt="Database" />
</p>

---

## ✨ Overview

**PartsCommand CRM** is a premium, glassmorphic progressive web application purpose-built for **Zempel Auto**. It delivers real-time inventory tracking, customer relationship management, vehicle records, sales & estimates, live competitor price comparison, and full audit logging — all from a single zero-install interface that works on desktop and mobile.

> _Zero dependencies to install. Open `index.html` and go._

---

## 🖼️ Screenshots

| Dashboard | Inventory | Price Comparison |
|:---------:|:---------:|:----------------:|
| Real-time KPIs, low-stock alerts, recent sales | Filterable parts table with barcode scanning | Live competitor pricing from NAPA, AutoZone, Advance Auto |

---

## 🚀 Features

### 📊 Dashboard
- At-a-glance KPIs — total inventory units, low-stock count, all-time revenue, average margin
- Low-stock alert cards with per-item minimum thresholds
- Recent sales feed with customer names and totals
- Live notification system for pending estimates and stock warnings

### 📦 Inventory Management
- Full CRUD for auto parts — part number, name, brand, supplier, category, barcode, bin location
- **Camera-based barcode scanning** via `html5-qrcode` (CODE_128, CODE_39, EAN-13, UPC-A, QR)
- Quick stock adjustments (+/−) directly from the table
- Multi-filter support — category, supplier, stock status
- CSV export with one click
- Cost / price / margin tracking per part

### 👥 Customer Management
- Customer profiles with name, phone, email, and address
- Linked vehicle history per customer
- Purchase history and lifetime spend tracking

### 🚗 Vehicle Registry
- Year / Make / Model / VIN tracking
- Customer-linked vehicle records
- Service and parts history per vehicle

### 💰 Sales & Estimates
- Create estimates and invoices tied to customers and inventory
- Automatic stock deduction on sale completion
- Margin calculation per transaction
- Status workflow — pending → completed

### 📈 Live Competitor Price Comparison
- **Real-time price fetching** from major retailers:
  - NAPA Auto Parts
  - AutoZone
  - Advance Auto Parts
- Cloudflare Worker proxy with edge-caching (1hr TTL)
- Side-by-side price grid with your cost and sell price
- Results cached locally for offline reference

### 📋 Audit Logs
- Every stock change, sale, customer edit, and data modification is logged
- Filterable by action type — stock updates, new records, deletions, sales
- Timestamped entries with user attribution
- Clearable log history

### 🔍 Global Search
- Unified search across parts, customers, and vehicles
- Real-time filtering as you type
- Color-coded result badges by entity type

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                   CLIENT (PWA)                      │
│                                                     │
│   index.html — Single-file app (~3,000 lines)       │
│   ├── Tailwind CSS (CDN)                            │
│   ├── Phosphor Icons                                │
│   ├── html5-qrcode (barcode scanner)                │
│   ├── Inter + JetBrains Mono (Google Fonts)         │
│   └── localStorage (offline-first cache)            │
│                                                     │
└──────────────────┬──────────────────────────────────┘
                   │  HTTPS
                   ▼
┌─────────────────────────────────────────────────────┐
│            CLOUDFLARE WORKERS (Edge API)            │
│                                                     │
│   parts-command-api.techguruofficial.workers.dev    │
│   ├── /sync      — Full DB read/write sync          │
│   └── /prices    — Live competitor price proxy       │
│                                                     │
└──────────────────┬──────────────────────────────────┘
                   │  Connection pooling
                   ▼
┌─────────────────────────────────────────────────────┐
│              NEON SERVERLESS POSTGRES               │
│                                                     │
│   Tables: inventory, customers, vehicles,           │
│           sales, retailer_prices, audit_logs        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|:------|:-----------|
| **Frontend** | Vanilla HTML/JS, Tailwind CSS (CDN), Phosphor Icons |
| **Typography** | Inter, JetBrains Mono (Google Fonts) |
| **Barcode Scanner** | html5-qrcode v2.3.8 |
| **Backend API** | Cloudflare Workers (edge runtime) |
| **Database** | Neon Serverless PostgreSQL |
| **Price Scraping** | Cloudflare Worker proxy → NAPA, AutoZone, Advance Auto |
| **Offline Support** | localStorage with cloud sync on reconnect |
| **Design System** | Glassmorphism, dark theme, responsive mobile-first |

---

## ⚡ Quick Start

### Prerequisites
- A modern browser (Chrome, Edge, Firefox, Safari)
- _That's it_ — no Node.js, no build step, no package manager

### Run Locally

```bash
# Clone the repository
git clone https://github.com/your-org/parts-command-crm.git
cd parts-command-crm

# Open in your browser
start index.html        # Windows
open index.html         # macOS
xdg-open index.html     # Linux
```

Or simply double-click `index.html`.

### With a Local Server (for camera/barcode scanning)

Barcode scanning requires HTTPS or `localhost`. Use any static server:

```bash
# Python
python -m http.server 8080

# Node (npx)
npx serve .

# VS Code
# Install "Live Server" extension → right-click index.html → "Open with Live Server"
```

---

## ☁️ Cloud Sync

The app automatically syncs data to a **Neon PostgreSQL** database through a **Cloudflare Worker** API:

| Endpoint | Method | Description |
|:---------|:-------|:------------|
| `/sync` | `GET` | Pull latest data from cloud DB |
| `/sync` | `POST` | Push full local state to cloud DB |
| `/prices` | `GET` | Fetch live competitor prices (`?partNumber=...&brand=...`) |

> If the cloud API is unreachable, the app falls back gracefully to localStorage with zero user disruption.

---

## 📂 Project Structure

```
parts-command-crm/
├── assets/
│   └── z-auto8.PNG              # Zempel Auto logo
├── .github/
│   └── instructions/            # AI coding guidelines
├── index.html                   # Complete SPA — UI, logic, styles
├── worker-prices-route.js       # Cloudflare Worker price-scraping route
├── parts-command-crm.session.sql# DB session file
├── .gitignore
├── .hintrc                      # Linter config
└── README.md                    # ← You are here
```

---

## 🔒 Security & Privacy

- **No third-party analytics** — zero tracking scripts
- **CORS-restricted API** — Cloudflare Worker enforces origin validation
- **Client-first data** — all data available offline via localStorage
- **No PII in URLs** — all API payloads are POST body or query params only

---

## 🗺️ Roadmap

- [ ] Role-based access control (Admin / Technician / Sales)
- [ ] PDF invoice & estimate generation
- [ ] Push notifications for low-stock alerts
- [ ] RockAuto & O'Reilly price integration
- [ ] Supplier purchase order workflow
- [ ] Customer portal (read-only vehicle/service history)
- [ ] Dark / light theme toggle
- [ ] Offline-first service worker with background sync

---

## 🤝 Contributing

This is a private project for **Zempel Auto**. If you've been granted access:

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes (`git commit -m "feat: add new feature"`)
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request

---
<p align="center">
## 📄 License

**Proprietary** — © 2026 Zempel Auto. All rights reserved.

<p align="center">
  Powered by TECHGURU
<br>Link: TECHGURUOFFICIAL.US <br>

<p align="center">
  <img src="https://i.imgur.com/tuBAEOR.png" alt="Zempel Auto" width="120" />
  <br />
  <sub>Built with ❤️ for Zempel Auto</sub>
</p>
