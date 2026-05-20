<div align="center">
<img src="https://zempelauto.techguruofficial.us/favicon.ico" alt="Zempel Auto Parts Logo" width="100" />

# Zempel Auto Parts CRM — PartsCommand

Production-grade auto parts inventory, customer, and sales management platform.

*PWA → Cloudflare Worker → FastAPI → RockAuto → Neon PostgreSQL*

<br />

[![Version](https://img.shields.io/badge/version-3.1.0-blue.svg?style=for-the-badge)](https://github.com/TechGuruServices/zempel-auto-crm)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-yellow.svg?style=for-the-badge&logo=python)](https://www.python.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Neon PG](https://img.shields.io/badge/Neon_PG-00E599?style=for-the-badge&logo=postgresql&logoColor=black)](https://neon.tech/)

</div>

---

## 🌟 Overview

**Zempel Auto Parts CRM** is an enterprise-grade solution engineered to handle inventory, customer tracking, and dynamic parts sourcing seamlessly. Leveraging a cutting-edge serverless architecture, it delivers exceptional performance and reliability.

### Key Features
- **📦 Inventory Management** — CRUD operations, barcode scanning via QR reader, and low-stock alerts.
- **👥 Customer Tracking** — Contact details, loyalty points, and purchase history.
- **🚗 Vehicle Registry** — Make, model, year, and VIN tracking, seamlessly linked to customers and service records.
- **💰 Sales & Estimates** — Real-time line-item invoices, robust PDF exports (`jsPDF`), and dynamic margin calculations.
- **⚡ Live Price Comparison** — Direct integration with RockAuto via a hardened proxy pipeline.
- **🔒 Audit Logging** — Immutable, structured JSONB logs directly stored in Neon PostgreSQL.

---

## 🏗️ Architecture

The platform follows a highly resilient, offline-first microservices architecture:

```mermaid
graph LR
  A[📱 PWA Frontend\nCloudflare Pages] <--> B[🛡️ CF Worker Proxy\nKV Cache & Rate Limit]
  B <--> C[🐍 Python FastAPI\nKoyeb]
  C <--> D[🛒 RockAuto API\nScraper]
  C --> E[(🐘 Neon PG\nAudit Logs)]
```

| Tier | Tech Stack | Hosting |
|------|-----------|---------|
| **Frontend** | Vanilla JS PWA, Service Worker, Glassmorphism UI | **Cloudflare Pages** |
| **Proxy API** | Cloudflare Workers, KV Cache, Rate Limiting | **Cloudflare Workers** |
| **Microservice** | FastAPI, Pydantic v2, Structlog, SlowAPI | **Koyeb (Docker)** |
| **Database** | Neon PostgreSQL, `asyncpg`, JSONB Audit Logs | **Neon** |
| **Scraper** | `rockauto-api==1.0.0` with CAPTCHA Bypass | **Bundled in Python** |

---

## 📁 Repository Structure

```text
zempel-auto-crm/
├── frontend/                  # Static PWA (HTML/JS/CSS)
│   ├── index.html             # Main entry point (Glassmorphism UI)
│   ├── sw.js                  # Service Worker (Offline-first strategy)
│   └── lib/rockauto-fetch.js  # Smart fetch wrappers with exponential backoff
├── backend/                   # Main Cloudflare Worker (CRM API)
│   ├── worker.js              # Auth, CRUD operations, and sync logic
│   ├── schema.sql             # Neon table definitions
│   └── wrangler.toml          # Cloudflare configuration
├── cloudflare-proxy/          # Proxy Worker for RockAuto Integrations
│   ├── worker_routes.js       # Route management and caching
│   └── wrangler.toml          # Proxy configuration
├── src/                       # FastAPI Microservice
│   ├── main.py                # Pydantic models, rate limiting, app routes
│   └── dependencies.py        # Database pooling and API client DI
├── deploy/                    # CI/CD & Deployment scripts
├── pyproject.toml             # Python dependencies
└── Dockerfile                 # Multi-stage production build for Koyeb
```

---

## 🚀 Beginner's Guide: Seamless Setup & Deployment

Welcome! Let's get your development environment up and running in a few simple steps.

### Prerequisites
Before you start, ensure you have the following installed:
1. **[Node.js (v18+)](https://nodejs.org/)** - For the frontend and Cloudflare Wrangler CLI.
2. **[Python (v3.11+)](https://www.python.org/downloads/)** - For the backend FastAPI microservice.
3. **[Docker (v24+)](https://www.docker.com/)** - *Optional but recommended* for local Python container testing.
4. **Cloudflare Account** - [Sign up for a Cloudflare account](https://dash.cloudflare.com/sign-up).
5. **Neon Postgres Account** - [Sign up for a Neon Postgres account](https://neon.tech/).

---

### Step 1: Clone and Install Dependencies

```bash
# 1. Clone the repository
git clone https://github.com/TechGuruServices/zempel-auto-crm.git
cd zempel-auto-crm

# 2. Install Backend Worker dependencies
cd backend
npm install
cd ..

# 3. Install Frontend dependencies
cd frontend
npm install
cd ..

# 4. Install Python Service dependencies (from root)
pip install -e .
```

### Step 2: Configure the Database (Neon)

1. Go to your **Neon Dashboard** and create a new project.
2. Copy your Postgres connection string (`postgresql://user:pass@host/dbname?sslmode=require`).
3. Run the initial schema file to create your tables:

   ```bash
   # You can run this using a tool like psql or directly in Neon's SQL editor
   psql "your_neon_connection_string" -f backend/schema.sql
   ```

### Step 3: Setup Environment Variables & Secrets

**1. Main Backend API Worker:**

```bash
# Log in to Cloudflare
npx wrangler login

cd backend
# Set secrets for the worker
npx wrangler secret put DATABASE_URL
# (Paste your Neon Connection String)
npx wrangler secret put JWT_SECRET
# (Enter a secure random string)
npx wrangler secret put ADMIN_PASSWORD_HASH
# (Enter a bcrypt hash of your desired admin password)
```

**2. Cloudflare Proxy:**

```bash
cd cloudflare-proxy
chmod +x wrangler_secrets.sh
./wrangler_secrets.sh
# Follow the prompts to add PYTHON_SERVICE_URL and SERVICE_AUTH_KEY
```

**3. Python FastAPI Local Environment:**

Create a `.env` file at the root of the project:

```env
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
SERVICE_AUTH_KEY=your-secure-auth-key
ALLOWED_ORIGINS=http://localhost:8788,https://zempel-auto-crm.pages.dev
```

### Step 4: Run Locally

Fire up all three tiers simultaneously to test the full stack locally:

```bash
# Terminal 1: Run the Backend API Worker
cd backend
npx wrangler dev

# Terminal 2: Run the Frontend App
cd frontend
npx wrangler pages dev .

# Terminal 3: Run the Python Microservice (from the root directory)
uvicorn src.main:app --reload --port 8000
```

Open your browser to the local URL provided by Wrangler (usually `http://localhost:8788`) to see the app!

---

### Step 5: Deploy to Production

Once you are satisfied with local testing, deploying to production is fully automated:

```bash
# Ensure scripts are executable
chmod +x deploy/deploy.sh deploy/verify.sh

# Run the deployment script
./deploy/deploy.sh

# Run post-deployment verification to check health and security headers
./deploy/verify.sh
```

- **Frontend** deploys directly to Cloudflare Pages.
- **Backend/Proxy** deploy to Cloudflare Workers.
- **Python API** can be deployed via the Dockerfile to platforms like Koyeb, Render, or Railway by linking your GitHub repo.

- **Frontend** deploys directly to Cloudflare Pages.
- **Backend/Proxy** deploy to Cloudflare Workers.
- **Python API** can be deployed via the Dockerfile to platforms like Koyeb, Render, or Railway by linking your GitHub repo.

---

## 🛡️ Security Posture

| Feature | Implementation Details |
|---------|-----------------------|
| **CORS** | Strict explicit origin matching; absolute rejection of `*` wildcards. |
| **Authentication** | Industry-standard JWT for UI, and encrypted `X-Service-Auth-Key` for service-to-service communication. |
| **Rate Limiting** | Dual-layer protection: Cloudflare KV (Proxy) + `slowapi` (Python). Caps at 5 req/sec/IP. |
| **Database Encryption** | Fully enforced TLS/SSL via Neon (`sslmode=require`). |
| **Hardened Headers** | Implemented OWASP Top 10 standards: `HSTS`, `CSP`, `X-Frame-Options`, and strict `Referrer-Policy`. |
| **Privilege Drops** | Docker container utilizes a strict non-root `appuser`. |

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <strong>Zempel Auto</strong> · PartsCommand CRM v3.1.0<br>
  <em>Built with ❤️ by <a href="https://github.com/TechGuruServices">TechGuruServices</a></em>
</p>
