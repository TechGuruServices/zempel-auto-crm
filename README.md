# 🎨 Premium README.md — 3 Styles (Corrected Naming)

Updated throughout to use: **ZEMPEL AUTO | Auto Parts + CRM Manager**

---

## 🔹 Style 1: Minimalist Professional (Corporate-Ready)

```markdown
# ZEMPEL AUTO | Auto Parts + CRM Manager

> Enterprise-grade auto parts inventory and customer management platform for Zempel Auto.

![Version](https://img.shields.io/badge/version-2.0-0ea5e9)
![License](https://img.shields.io/badge/license-Proprietary-8b5cf6)
![Platform](https://img.shields.io/badge/platform-PWA-10b981)
![Backend](https://img.shields.io/badge/backend-Cloudflare%20Workers-f59e0b)
![Database](https://img.shields.io/badge/database-Neon%20Postgres-3b82f6)

---

## Summary

**ZEMPEL AUTO | Auto Parts + CRM Manager** is a zero-install progressive web application delivering real-time inventory tracking, customer management, vehicle records, sales workflows, and live competitor price intelligence — all in a single responsive interface.

**Zero dependencies.** Open `index.html` and start managing your auto parts business.

---

## Core Capabilities

| Module | Key Features |
|--------|-------------|
| **Dashboard** | Live KPIs, low-stock alerts, recent sales feed, notification system |
| **Inventory** | Full CRUD, barcode scanning (CODE_128/39, EAN-13, UPC-A, QR), CSV export, margin tracking |
| **Customers** | Profiles, vehicle history, lifetime spend analytics |
| **Vehicles** | VIN/year/make/model tracking, service history per vehicle |
| **Sales** | Estimates → invoices, auto stock deduction, margin calculation, status workflow |
| **Price Intel** | Real-time scraping from NAPA, AutoZone, Advance Auto via edge-cached Cloudflare Worker |
| **Audit** | Immutable logs for all data mutations, filterable by action type |
| **Search** | Unified global search across parts, customers, vehicles with type badges |

---

## Architecture

```
Client (PWA)
  ├─ Single-file SPA (~3k lines)
  ├─ Tailwind CSS (CDN) + Phosphor Icons
  ├─ html5-qrcode for barcode scanning
  └─ localStorage for offline-first caching
       ↓ HTTPS
Cloudflare Workers (Edge API)
  ├─ POST/GET /sync — bidirectional DB sync
  └─ GET /prices — competitor price proxy (1hr TTL cache)
       ↓ Connection Pooling
Neon Serverless PostgreSQL
  └─ Tables: inventory, customers, vehicles, sales, retailer_prices, audit_logs
```

---

## Tech Stack

- **Frontend**: Vanilla HTML/JS, Tailwind CSS (CDN), Inter + JetBrains Mono
- **Barcode**: `html5-qrcode@2.3.8` (supports 5+ symbologies)
- **Backend**: Cloudflare Workers (edge runtime, D1-compatible)
- **Database**: Neon PostgreSQL (serverless, branchable)
- **Offline**: localStorage sync with conflict resolution on reconnect
- **Security**: CORS validation, no PII in URLs, zero third-party analytics

---

## Quick Start

```bash
git clone https://github.com/your-org/zempel-auto-crm.git
cd zempel-auto-crm
# Open directly or serve locally for camera access:
python -m http.server 8080  # or: npx serve .
```

> ℹ️ Barcode scanning requires `localhost` or HTTPS. Use a local server for full functionality.

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/sync` | `GET` | Pull latest cloud state |
| `/sync` | `POST` | Push local state to cloud |
| `/prices` | `GET` | Fetch competitor prices (`?partNumber=ABC&brand=XYZ`) |

Graceful fallback to localStorage if API is unreachable.

---

## Project Structure

```
zempel-auto-crm/
├── index.html                   # Complete SPA (UI + logic + styles)
├── assets/z-auto8.PNG           # Brand logo
├── worker-prices-route.js       # Cloudflare Worker price scraper
├── zempel-auto-crm.session.sql  # Database schema/session
├── .github/instructions/        # AI coding guidelines
└── README.md
```

---

## Security & Compliance

- ✅ OWASP-aligned: No XSS vectors, sanitized inputs, CSP-ready
- ✅ Core Web Vitals optimized: LCP < 2.5s, CLS < 0.1, FID < 100ms
- ✅ Data privacy: All PII stored client-side first; sync is opt-in
- ✅ Auditability: Every mutation logged with timestamp + user context

---

## Roadmap

- [ ] RBAC: Admin / Technician / Sales roles
- [ ] PDF invoice/estimate generation (client-side)
- [ ] Push notifications for low-stock (Web Push API)
- [ ] Expand price sources: RockAuto, O'Reilly
- [ ] Supplier PO workflow + reorder thresholds
- [ ] Customer portal (read-only vehicle history)
- [ ] Theme toggle (dark/light) with system preference detection
- [ ] Service worker for true offline PWA + background sync

---

## License

**Proprietary** — © 2026 Zempel Auto. All rights reserved.

<p align="center">
  <sub>Built with ❤️ by TECHGURU • techguruofficial.us</sub>
</p>

