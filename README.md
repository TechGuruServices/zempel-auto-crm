# Zempel Auto CRM

<div align="center">

<img src="frontend/assets/z-auto-7.PNG" alt="Zempel Auto Logo" width="300"/>
<h2>⚙️Parts Command CRM</h2>

### Enterprise-Grade Auto Parts Inventory & Customer Management Platform

<br>

[![Version](https://img.shields.io/badge/Version-2.0-0ea5e9?style=for-the-badge&logo=semver&logoColor=white)](https://github.com/TechGuruServices/zempel-auto-crm)
[![License](https://img.shields.io/badge/License-Proprietary-8b5cf6?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-PWA-10b981?style=for-the-badge&logo=pwa&logoColor=white)](https://parts-command-crm.pages.dev)
[![Backend](https://img.shields.io/badge/Backend-Cloudflare%20Workers-f59e0b?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Database](https://img.shields.io/badge/Database-Neon%20PostgreSQL-3b82f6?style=for-the-badge&logo=postgresql&logoColor=white)](https://neon.tech)
[![Deploy](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-ff6633?style=for-the-badge&logo=cloudflarepages&logoColor=white)](https://pages.cloudflare.com)

<br>

**A zero-install progressive web application delivering real-time inventory tracking, customer management, vehicle records, sales workflows, barcode scanning, and live competitor price intelligence — all in a single, blazing-fast responsive interface.**

<br>

[🚀 Live Demo](https://parts-command-crm.pages.dev) · [📖 Documentation](#-architecture) · [🐛 Report Bug](https://github.com/TechGuruServices/zempel-auto-crm/issues) · [✨ Request Feature](https://github.com/TechGuruServices/zempel-auto-crm/issues)

</div>

<br>

---

<br>

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
- [API Reference](#-api-reference)
- [Project Structure](#-project-structure)
- [Database Schema](#-database-schema)
- [Security & Compliance](#-security--compliance)
- [Roadmap](#-roadmap)
- [License](#-license)

<br>

---

<br>

## 🔭 Overview

**Parts Command CRM** is a full-featured, cloud-native CRM platform purpose-built for **Zempel Auto**. It combines powerful inventory management with real-time customer relationship tools, competitive pricing intelligence, and barcode scanning — all delivered as a lightweight PWA that works offline-first and syncs seamlessly to the cloud.

> 🎯 **Zero dependencies. Zero install. Just open `index.html` and run your auto parts business.**

<br>

### Why Parts Command?

| Traditional Tools | Parts Command CRM |
|:---|:---|
| ❌ Expensive monthly SaaS subscriptions | ✅ Self-hosted, zero recurring cost |
| ❌ Heavy desktop installs, slow updates | ✅ Instant PWA — works on any device, any browser |
| ❌ No offline capability | ✅ Offline-first with intelligent cloud sync |
| ❌ Manual competitor price checks | ✅ Automated real-time price scraping (NAPA, AutoZone, Advance Auto) |
| ❌ Separate barcode hardware required | ✅ Built-in camera-based barcode/QR scanner |
| ❌ Cluttered, outdated interfaces | ✅ Modern dark-mode UI with glassmorphism design |

<br>

---

<br>

## 🎯 Key Features

<table>
<tr>
<td width="50%">

### 📊 Dashboard & Analytics
- Real-time KPI cards (revenue, inventory value, margin %)
- Low-stock alert system with notification bell
- Recent sales activity feed
- At-a-glance business health metrics

</td>
<td width="50%">

### 📦 Inventory Management
- Full CRUD with search, filter, and sort
- Multi-format barcode scanning (CODE_128, CODE_39, EAN-13, UPC-A, QR)
- CSV bulk export/import
- Cost-price margin tracking & alerts
- Category-based organization

</td>
</tr>
<tr>
<td width="50%">

### 👥 Customer Management
- Complete customer profiles with contact details
- Vehicle ownership history per customer
- Lifetime spend & transaction analytics
- Linked sales history with quick-access

</td>
<td width="50%">

### 🚗 Vehicle Records
- VIN / Year / Make / Model tracking
- Service history timeline per vehicle
- Customer-vehicle association mapping
- Quick-search by VIN or plate

</td>
</tr>
<tr>
<td width="50%">

### 💰 Sales & Invoicing
- Estimate → Invoice conversion workflow
- Automatic inventory stock deduction on sale
- Margin calculation per line item
- Multi-status pipeline (Draft → Sent → Paid → Closed)
- PDF invoice generation (client-side via jsPDF)

</td>
<td width="50%">

### 🏷️ Competitive Price Intelligence
- Real-time scraping from **NAPA**, **AutoZone**, **Advance Auto Parts**
- Edge-cached via Cloudflare Worker (1hr TTL)
- Side-by-side price comparison view
- Margin optimization recommendations

</td>
</tr>
<tr>
<td width="50%">

### 📋 Audit Trail
- Immutable logs for every data mutation
- Filterable by action type, entity, and timestamp
- Full traceability for compliance
- User context on every log entry

</td>
<td width="50%">

### 🔍 Global Search
- Unified search across parts, customers, vehicles
- Type badges for instant result categorization
- Real-time filtering as you type
- Deep-link to any record from search results

</td>
</tr>
</table>

<br>

---

<br>

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT (PWA)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Single-File  │  │   Barcode    │  │   PDF Gen    │  │
│  │   SPA (~4k)   │  │   Scanner    │  │   (jsPDF)    │  │
│  │  Vanilla JS   │  │ html5-qrcode │  │  AutoTable   │  │
│  └──────┬───────┘  └──────────────┘  └──────────────┘  │
│         │                                               │
│  ┌──────┴───────┐  ┌──────────────┐                     │
│  │  Tailwind CSS │  │  Phosphor    │                     │
│  │  Inter Font   │  │   Icons      │                     │
│  └──────────────┘  └──────────────┘                     │
│         │                                               │
│  ┌──────┴───────────────────────────┐                   │
│  │  localStorage (Offline Cache)     │                   │
│  │  + Service Worker (sw.js)         │                   │
│  └──────┬───────────────────────────┘                   │
└─────────┼───────────────────────────────────────────────┘
          │ HTTPS
┌─────────┼───────────────────────────────────────────────┐
│         ▼  CLOUDFLARE WORKERS (Edge API)                │
│  ┌──────────────┐  ┌──────────────────────┐             │
│  │  /sync       │  │  /prices             │             │
│  │  GET  → Pull │  │  GET → Competitor    │             │
│  │  POST → Push │  │  price proxy (1h TTL)│             │
│  └──────┬───────┘  └──────────────────────┘             │
└─────────┼───────────────────────────────────────────────┘
          │ Connection Pooling
┌─────────┼───────────────────────────────────────────────┐
│         ▼  NEON SERVERLESS POSTGRESQL                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  inventory │ customers │ vehicles │ sales         │   │
│  │  retailer_prices │ audit_logs                     │   │
│  │  + Auto-update triggers + JSONB indexes           │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

<br>

---

<br>

## 🛠 Tech Stack

| Layer | Technology | Purpose |
|:---:|:---|:---|
| 🎨 | **Vanilla HTML/JS** | Single-file SPA — zero build step |
| 🎨 | **Tailwind CSS** (CDN) | Utility-first styling + dark mode |
| 🔤 | **Inter + JetBrains Mono** | Premium typography (Google Fonts) |
| 📷 | **html5-qrcode** `v2.3.8` | Camera barcode/QR scanning (5+ symbologies) |
| 📄 | **jsPDF + AutoTable** | Client-side PDF invoice generation |
| 🎭 | **Phosphor Icons** | Elegant icon system |
| ⚡ | **Cloudflare Workers** | Edge-deployed API (global <50ms latency) |
| 🗃️ | **Neon PostgreSQL** | Serverless, branchable, auto-scaling DB |
| 📱 | **Service Worker** | Offline caching + background sync |
| 💾 | **localStorage** | Offline-first data with conflict resolution |

<br>

---

<br>

## 🚀 Getting Started

### Prerequisites

- A modern web browser (Chrome, Edge, Firefox, Safari)
- `localhost` or HTTPS for barcode scanner camera access
- (Optional) Node.js for local dev server

### Quick Start

```bash
# Clone the repository
git clone https://github.com/TechGuruServices/zempel-auto-crm.git

# Navigate to the project
cd zempel-auto-crm

# Option A: Serve with Python
python -m http.server 8080 --directory frontend

# Option B: Serve with Node
npx serve frontend

# Option C: Open directly (limited — no camera access)
open frontend/index.html
```

> [!NOTE]
> **Barcode scanning requires `localhost` or HTTPS.** Use a local dev server for full camera-based scanning functionality.

### Cloud Deployment

The app is deployed on **Cloudflare Pages** (frontend) + **Cloudflare Workers** (API):

```bash
# Frontend — auto-deploys via GitHub integration
# Push to main → Cloudflare Pages builds from /frontend

# Backend — deploy via Wrangler
cd backend
npx wrangler deploy worker.js
```

<br>

---

<br>

## 📡 API Reference

All API endpoints are served via Cloudflare Workers at the edge.

| Endpoint | Method | Description | Parameters |
|:---|:---:|:---|:---|
| `/sync` | `GET` | Pull latest cloud state to client | — |
| `/sync` | `POST` | Push local state to cloud (upsert) | `{ inventory, customers, vehicles, sales }` |
| `/prices` | `GET` | Fetch competitor pricing data | `?partNumber=ABC123&brand=Dorman` |

> [!TIP]
> The client gracefully falls back to **localStorage** if the API is unreachable. Data syncs automatically when connectivity is restored.

### Response Format

```json
{
  "success": true,
  "data": {
    "inventory": [...],
    "customers": [...],
    "vehicles": [...],
    "sales": [...]
  },
  "syncedAt": "2026-05-02T12:00:00Z"
}
```

<br>

---

<br>

## 📂 Project Structure

```
zempel-auto-crm/
│
├── frontend/                          # Client-side PWA
│   ├── index.html                     # Complete SPA (UI + logic + styles)
│   ├── manifest.json                  # PWA manifest
│   ├── sw.js                          # Service worker for offline caching
│   └── assets/
│       ├── z-auto-8.png               # Primary brand logo
│       ├── z-auto-7.PNG               # Alternate brand logo / favicon source
│       ├── favicon-cropped.png        # Browser favicon
│       ├── html5-qrcode.min.js        # Barcode scanner library
│       ├── jspdf.umd.min.js           # PDF generation library
│       ├── jspdf.plugin.autotable.min.js  # PDF table plugin
│       └── phosphor-icons.js          # Icon system loader
│
├── backend/                           # Cloudflare Workers API
│   ├── worker.js                      # Main sync API worker
│   ├── worker-prices-route.js         # Competitor price scraper worker
│   ├── wrangler.toml                  # Cloudflare Workers config
│   ├── schema.sql                     # PostgreSQL schema definition
│   ├── package.json                   # Backend dependencies
│   └── tests/
│       └── run-tests.js               # Integration test suite
│
├── .github/
│   └── instructions/                  # AI coding guidelines
│
├── .gitignore
├── .hintrc                            # Linter config
└── README.md                          # ← You are here
```

<br>

---

<br>

## 🗄 Database Schema

Six core tables, all using **JSONB** for flexible schema evolution with indexed hot paths:

```sql
inventory         — id, data (JSONB), created_at, updated_at
customers         — id, data (JSONB), created_at, updated_at
vehicles          — id, data (JSONB), created_at, updated_at
sales             — id, data (JSONB), created_at, updated_at
retailer_prices   — part_number, data (JSONB), fetched_at
audit_logs        — id, data (JSONB), created_at
```

**Indexed Fields:** `partNumber`, `barcode`, `category`, `name`, `phone`, `vin`, `customerId`, `status`, `date`, `action`, `timestamp`

**Triggers:** Auto-update `updated_at` on all mutable tables.

> [!IMPORTANT]
> Run `schema.sql` against your Neon database to bootstrap. The Worker also auto-creates tables via `ensureSchema()` on first request.

<br>

---

<br>

## 🔒 Security & Compliance

| Area | Status | Details |
|:---|:---:|:---|
| XSS Protection | ✅ | Sanitized inputs, no `innerHTML` with user data |
| CORS | ✅ | Strict origin validation on Workers |
| Data Privacy | ✅ | All PII stored client-side first; cloud sync is explicit |
| Audit Trail | ✅ | Every mutation logged with timestamp + user context |
| CSP Ready | ✅ | Content Security Policy headers configured |
| Core Web Vitals | ✅ | LCP < 2.5s · CLS < 0.1 · FID < 100ms |
| HTTPS | ✅ | Enforced via Cloudflare edge |
| No 3rd-Party Analytics | ✅ | Zero external trackers or data collection |

<br>

---

<br>

## 🗺 Roadmap

- [x] ~~Single-file PWA with offline-first architecture~~
- [x] ~~Cloudflare Workers edge API deployment~~
- [x] ~~Neon PostgreSQL cloud database integration~~
- [x] ~~Multi-format barcode scanner (camera-based)~~
- [x] ~~Competitor price intelligence (NAPA, AutoZone, Advance Auto)~~
- [x] ~~PDF invoice/estimate generation~~
- [x] ~~Notification system with alert bell~~
- [ ] RBAC: Admin / Technician / Sales roles with permission matrix
- [ ] Push notifications for low-stock alerts (Web Push API)
- [ ] Expand price sources: RockAuto, O'Reilly Auto Parts
- [ ] Supplier PO workflow + automated reorder thresholds
- [ ] Customer portal (read-only vehicle & service history)
- [ ] Theme toggle (dark ↔ light) with OS preference detection
- [ ] Service worker background sync with conflict resolution UI
- [ ] Multi-location inventory support
- [ ] QuickBooks / accounting software integration

<br>

---

<br>

## 📜 License

**Proprietary** — © 2026 Zempel Auto. All rights reserved.

Unauthorized copying, distribution, or modification of this software is strictly prohibited without prior written consent from Zempel Auto.

<br>

---

<br>

<div align="center">

<br>

<sub>Built with precision and ❤️</sub>

<br><br>

<!-- Animated Gradient TECHGURU Footer -->
<br>
<img src="https://readme-typing-svg.demolab.com?font=Orbitron&weight=900&size=28&duration=3000&pause=1000&color=0EA5E9&center=true&vCenter=true&multiline=false&width=500&height=45&lines=Powered+by+TECHGURU" alt="Powered by TECHGURU" />
<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=2,3,12,19,27&height=100&section=footer" width="100%" alt="" />

<https://techguruofficial.us>
<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://capsule-render.vercel.app/api?type=rect&color=gradient&customColorList=2,3,12,19,27&height=3&section=footer" />
  <source media="(prefers-color-scheme: light)" srcset="https://capsule-render.vercel.app/api?type=rect&color=gradient&customColorList=2,3,12,19,27&height=3&section=footer" />
  <img src="https://capsule-render.vercel.app/api?type=rect&color=gradient&customColorList=2,3,12,19,27&height=3&section=footer" width="100%" alt="" />
</picture>

<br>

<a href=https://techguruofficial.us>
  <img src="https://img.shields.io/badge/🌐_techguruofficial.us-0ea5e9?style=flat-square&logoColor=white" alt="Website" />
</a>
<a href="https://github.com/TechGuruServices">
  <img src="https://img.shields.io/badge/GitHub-TechGuruServices-8b5cf6?style=flat-square&logo=github&logoColor=white" alt="GitHub" />
</a>

<br><br>

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=2,3,12,19,27&height=100&section=footer" width="100%" alt="" />

</div>
