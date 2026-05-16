<![CDATA[# Zempel Auto Parts CRM — PartsCommand

<p align="center">
  <strong>Production-grade auto parts inventory, customer, and sales management platform.</strong><br>
  <em>PWA → Cloudflare Worker → FastAPI → RockAuto → Neon PostgreSQL</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-3.1.0-blue" alt="Version 3.1.0">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License MIT">
  <img src="https://img.shields.io/badge/python-3.11+-yellow" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/cloudflare-workers-orange" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/database-Neon%20PG-purple" alt="Neon PG">
</p>

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐     ┌──────────┐
│   PWA Frontend   │────▶│  CF Worker Proxy  │────▶│  Python FastAPI     │────▶│  RockAuto │
│  (Cloudflare     │     │  (Rate Limit +    │     │  (Pydantic v2 +     │     │  API 1.0  │
│   Pages)         │◀────│   KV Cache)       │◀────│   asyncpg + SSL)    │     └──────────┘
└─────────────────┘     └──────────────────┘     └────────┬────────────┘
                                                          │
                                                          ▼
                                                   ┌──────────────┐
                                                   │  Neon PG      │
                                                   │  (audit_logs) │
                                                   └──────────────┘
```

| Tier | Technology | Hosting |
|------|-----------|---------|
| **Frontend** | Vanilla JS PWA, Service Worker, glassmorphism UI | Cloudflare Pages |
| **Proxy** | Cloudflare Worker, KV cache, rate limiting | Cloudflare Workers |
| **API** | FastAPI, Pydantic v2, structlog, slowapi | Koyeb (Docker) |
| **Database** | Neon PostgreSQL, asyncpg, JSONB audit logs | Neon |
| **Scraper** | `rockauto-api==1.0.0` with CAPTCHA bypass | Bundled |

---

## Repository Structure

```
zempel-autoparts-crm/
├── frontend/                  # PWA (Cloudflare Pages)
│   ├── index.html             # Single-page app (227 KB)
│   ├── sw.js                  # Service Worker — offline-first + ETag
│   ├── rockauto-fetch.js      # Fetch wrapper — timeout, retry, dedup
│   ├── rockauto-ui.js         # DOM renderers — SOLID per data type
│   ├── sw_cache_update.js     # SW cache coordination utility
│   ├── manifest.json          # PWA manifest
│   └── assets/                # Images, fonts, vendor JS
├── backend/                   # Cloudflare Worker (legacy D1 API)
│   ├── worker.js              # Main worker — auth, CRUD, sync
│   ├── schema.sql             # D1/Neon table definitions
│   ├── wrangler.toml          # Worker config + KV/D1 bindings
│   └── package.json           # Dependencies (zod, @neon, jwt)
├── cloudflare-proxy/          # CF Worker Proxy (RockAuto relay)
│   ├── worker_routes.js       # Proxy routes — cache, CORS, retry
│   ├── wrangler.toml          # Worker config
│   └── wrangler_secrets.sh    # Secret setup script
├── python-service/            # FastAPI microservice
│   ├── src/
│   │   ├── main.py            # Routes, middleware, Pydantic models
│   │   └── dependencies.py    # DI: asyncpg pool, httpx, RockAutoClient
│   ├── Dockerfile             # Multi-stage (builder → slim runtime)
│   ├── koyeb.yaml             # (Optional) Koyeb configuration
│   └── pyproject.toml         # Pinned dependencies
├── deploy/                    # Deployment scripts
│   ├── deploy.sh              # Full-stack deploy
│   └── verify.sh              # Post-deploy health checks
└── rockauto-api-main/         # rockauto-api==1.0.0 vendored source
```

---

## Features

### CRM Core

- **Inventory Management** — CRUD with barcode scanning (QR reader), low-stock alerts
- **Customer Tracking** — Contact details, loyalty points, purchase history
- **Vehicle Registry** — Make/model/year/VIN, linked to customers and service records
- **Sales & Estimates** — Line-item invoices, PDF export (jsPDF), margin calculation
- **Price Comparison** — Live RockAuto pricing via proxy pipeline
- **Audit Logs** — JSONB structured logging to Neon PG

### Technical

- **Offline-First PWA** — Service Worker with stale-while-revalidate + ETag sync
- **Glassmorphism UI** — Dark/light mode, animations, responsive (mobile-first)
- **KV Response Cache** — SHA-256 hashed keys, 1h TTL, auto-invalidation
- **Rate Limiting** — 5 req/s/IP at proxy + Python layers
- **CAPTCHA Fallback** — 503 + `Retry-After: 60` when RockAuto triggers CAPTCHA
- **OWASP Headers** — HSTS, CSP, X-Frame-Options, X-Content-Type-Options on all responses
- **Strict CORS** — No wildcards — explicit origin matching only
- **Structured Logging** — JSON via structlog (Python), console (Workers)
- **Graceful Shutdown** — Connection pool + HTTP client cleanup on SIGTERM

---

## Quick Start

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | Frontend dev server, wrangler CLI |
| Python | 3.11+ | FastAPI service |
| Wrangler | 4.x | Cloudflare deployment |
| Docker | 24+ | Python service containerization |

### 1. Clone and Install

```bash
git clone https://github.com/TechGuruServices/zempel-auto-crm.git
cd zempel-auto-crm

# Backend (Cloudflare Worker)
cd backend && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..

# Python service
cd python-service && pip install -e . && cd ..
```

### 2. Environment Variables

**Backend Worker** (`backend/.env` or wrangler secrets):

```env
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
JWT_SECRET=your-jwt-secret
ADMIN_PASSWORD_HASH=your-bcrypt-hash
```

**Cloudflare Proxy** (wrangler secrets):

```bash
cd cloudflare-proxy
chmod +x wrangler_secrets.sh
./wrangler_secrets.sh
# Prompts for: PYTHON_SERVICE_URL, SERVICE_AUTH_KEY
```

**Python Service** (Koyeb dashboard or local `.env`):

```env
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
SERVICE_AUTH_KEY=your-shared-api-key
ALLOWED_ORIGINS=https://zempel-auto-crm.pages.dev,https://zempelauto.techguruofficial.us
```

### 3. Local Development

```bash
# Terminal 1: Backend Worker
cd backend && npx wrangler dev

# Terminal 2: Frontend
cd frontend && npx wrangler pages dev .

# Terminal 3: Python Service
cd python-service && uvicorn src.main:app --reload --port 8000
```

### 4. Deploy to Production

```bash
chmod +x deploy/deploy.sh deploy/verify.sh

# Deploy all three tiers
./deploy/deploy.sh

# Verify health, security headers, CORS
./deploy/verify.sh
```

---

## API Reference

### Cloudflare Proxy (`/v1/rockauto/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Proxy health check |
| `GET` | `/v1/rockauto/makes` | All vehicle makes |
| `GET` | `/v1/rockauto/years/:make` | Years for a make |
| `GET` | `/v1/rockauto/models/:make/:year` | Models for make + year |
| `GET` | `/v1/rockauto/engines/:make/:year/:model` | Engines for vehicle |
| `GET` | `/v1/rockauto/parts/:carcode` | Parts by carcode |
| `GET` | `/v1/rockauto/search?q=` | Part name search |

**Headers**: All responses include OWASP security headers + `X-Cache: HIT|MISS`.

**Rate Limit**: 5 requests/second/IP. Exceeded requests return `429` with `Retry-After`.

### Python Service (`/api/rockauto/*`)

Same routes as proxy, prefixed `/api/` instead of `/v1/`. Requires `X-Service-Auth-Key` header.

### Backend Worker (`/sync`, `/auth/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sync` | Full database sync (ETag support) |
| `POST` | `/sync` | Bulk upsert all records |
| `POST` | `/auth/login` | JWT authentication |

---

## Security

| Control | Implementation |
|---------|---------------|
| **CORS** | Strict origin matching — no `*` wildcards |
| **Authentication** | JWT (backend), `X-Service-Auth-Key` (service-to-service) |
| **TLS/SSL** | Enforced on all Neon PG connections (`sslmode=require`) |
| **Secrets** | Environment variables only — never committed to source |
| **Rate Limiting** | 5 req/s/IP at proxy (KV) + Python (slowapi) layers |
| **Error Masking** | Internal errors never leaked to clients |
| **Headers** | HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy |
| **Non-root** | Docker container runs as `appuser` (non-root) |

---

## Database

### Neon PostgreSQL Schema

```sql
CREATE TABLE audit_logs (
    id       TEXT PRIMARY KEY,
    data     JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**JSONB `data` structure**:

```json
{
  "action": "API_REQUEST",
  "route": "/api/rockauto/makes",
  "method": "GET",
  "client_ip": "203.0.113.1",
  "user_agent": "Mozilla/5.0...",
  "status_code": 200,
  "params": {},
  "error": null,
  "timestamp": "2026-05-16T14:30:00Z"
}
```

---

## Deployment Targets

| Service | Platform | Trigger |
|---------|----------|---------|
| Frontend PWA | Cloudflare Pages | `wrangler pages deploy` |
| Backend Worker | Cloudflare Workers | `wrangler deploy` (from `/backend`) |
| RockAuto Proxy | Cloudflare Workers | `wrangler deploy` (from `/cloudflare-proxy`) |
| Python Service | Koyeb | Git push to `main` (auto-deploy) |
| Database | Neon | Always-on serverless PG |

---

## Tech Stack

| Category | Technologies |
|----------|-------------|
| Frontend | HTML5, Vanilla JS, CSS3, Service Workers, Web APIs |
| Icons | Phosphor Icons 2.1.2 |
| PDF | jsPDF + AutoTable |
| Scanning | html5-qrcode |
| Backend | Cloudflare Workers, KV, D1 |
| Proxy | Cloudflare Workers, KV cache |
| API | FastAPI 0.115, Pydantic 2.11, uvicorn |
| Database | Neon PostgreSQL, asyncpg 0.30 |
| Scraping | rockauto-api 1.0.0, httpx |
| Logging | structlog (JSON), slowapi |
| Container | Docker (multi-stage, slim-bookworm) |
| Deploy | Koyeb, Cloudflare, GitHub Actions |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'feat: add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>Zempel Auto</strong> · PartsCommand CRM v3.1.0<br>
  <em>Built by <a href="https://github.com/TechGuruServices">TechGuruServices</a></em>
</p>
]]>
