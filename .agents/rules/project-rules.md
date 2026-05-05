---
trigger: always_on
---

## ROLE
Act as a senior full-stack engineer and DevOps architect. A;udit and validate the complete configuration of a monorepo CRM application.

## REPO CONTEXT
- Repository: https://github.com/TechGuruServices/zempel-auto-crm
- Structure: `/frontend` (Cloudflare Pages) + `/backend` (Cloudflare Workers)
- Stack: Next.js/React frontend, Node.js/TypeScript backend, PostgreSQL/D1, Cloudflare ecosystem
- Deployment: GitHub → Cloudflare Pages (FE) + Workers (BE)

## STRICT VALIDATION CHECKLIST

### 1️⃣ Repository Structure & File Integrity
- [ ] Confirm `/frontend` and `/backend` exist at repo root with no nested misplacement
- [ ] Verify `package.json` in each directory has correct `name`, `scripts`, and `dependencies`
- [ ] Validate all relative imports resolve: `../`, `@/`, absolute paths
- [ ] Ensure `.gitignore` excludes `node_modules/`, `.env`, `.wrangler/`, `dist/`, `build/`
- [ ] Confirm `README.md` documents local setup + deploy commands for both apps

#--------------------## ROLE
Act as a senior full-stack engineer and DevOps architect. Audit and validate the complete configuration of a monorepo CRM application before deployment.

## REPO CONTEXT
- Repository: https://github.com/TechGuruServices/zempel-auto-crm
- Structure: `/frontend` (Cloudflare Pages) + `/backend` (Cloudflare Workers)
- Stack: Next.js/React frontend, Node.js/TypeScript backend, PostgreSQL/D1, Cloudflare ecosystem
- Deployment: GitHub → Cloudflare Pages (FE) + Workers (BE)

## STRICT VALIDATION CHECKLIST

### 1️⃣ Repository Structure & File Integrity
- [ ] Confirm `/frontend` and `/backend` exist at repo root with no nested misplacement
- [ ] Verify `package.json` in each directory has correct `name`, `scripts`, and `dependencies`
- [ ] Validate all relative imports resolve: `../`, `@/`, absolute paths
- [ ] Ensure `.gitignore` excludes `node_modules/`, `.env`, `.wrangler/`, `dist/`, `build/`
- [ ] Confirm `README.md` documents local setup + deploy commands for both apps

### 2️⃣ Frontend (Cloudflare Pages) Configuration
- [ ] `frontend/package.json`: `build` script outputs to `dist/` or `out/` (Next.js: `next build && next export` or `opennextjs-cloudflare`)
- [ ] `cloudflare/pages.yml` or GitHub Actions: build command = `cd frontend && npm run build`, publish dir = `frontend/.next/static` or `frontend/out`
- [ ] `frontend/wrangler.toml` (if using Pages Functions): 
  ```toml
  name = "zempel-auto-crm-frontend"
  compatibility_date = "2026-05-01"
  compatibility_flags = ["nodejs_compat"]
  pages_build_output_dir = ".next" # or "out"## 2️⃣ Frontend (Cloudflare Pages) Configuration
- [ ] `frontend/package.json`: 