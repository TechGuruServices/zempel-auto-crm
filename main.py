"""
Zempel Auto Parts CRM — FastAPI RockAuto Proxy Service v3.1.0

Production-hardened async service:
- Pydantic v2 strict response models
- asyncpg Neon PG audit logging (JSONB)
- Structured JSON logging via structlog
- Rate limiting (5 req/s/IP via slowapi)
- CAPTCHA fallback flow
- Graceful shutdown with resource cleanup
- Strict CORS (env-driven origins)

Routes:
  GET  /health                                              Health + DB connectivity
  GET  /api/rockauto/makes                                  Vehicle makes
  GET  /api/rockauto/years/{make}                           Years for make
  GET  /api/rockauto/models/{make}/{year}                   Models for make+year
  GET  /api/rockauto/engines/{make}/{year}/{model}          Engines (returns carcode)
  GET  /api/rockauto/categories/{make}/{year}/{model}/{carcode}   Part categories for vehicle
  GET  /api/rockauto/parts/{make}/{year}/{model}/{carcode}?category=  Parts in a category
  GET  /api/rockauto/search?q=                              Part name/number search (global)
"""

from __future__ import annotations

import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import asyncpg
import structlog
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from rockauto_api import RockAutoClient
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from dependencies import (
    close_http_client,
    close_pool,
    get_db_conn,
    get_pool,
    get_rockauto_client,
    verify_auth_key,
)

load_dotenv()

# ── Structured Logging ────────────────────────────────────────────────────────

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(0),
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
    cache_logger_on_first_use=True,
)
logger = structlog.get_logger("main")


# ── Pydantic v2 Response Models (strict) ─────────────────────────────────────

class HealthResponse(BaseModel):
    """Health check response."""
    status: str = Field(default="ok")
    version: str = Field(default="3.1.0")
    db_connected: bool = Field(default=False)
    timestamp: str = Field(default="")


class MakeItem(BaseModel):
    """Single vehicle make."""
    name: str


class MakesResponse(BaseModel):
    """Vehicle makes response wrapper."""
    makes: list[str] = Field(default_factory=list)
    count: int = Field(default=0, ge=0)


class YearsResponse(BaseModel):
    """Vehicle years response wrapper."""
    make: str
    years: list[int] = Field(default_factory=list)
    count: int = Field(default=0, ge=0)


class ModelsResponse(BaseModel):
    """Vehicle models response wrapper."""
    make: str
    year: int = Field(ge=1950, le=2035)
    models: list[str] = Field(default_factory=list)
    count: int = Field(default=0, ge=0)


class EngineItem(BaseModel):
    """Engine option."""
    description: str = Field(default="")
    carcode: str = Field(default="")
    href: str = Field(default="")


class EnginesResponse(BaseModel):
    """Vehicle engines response wrapper."""
    make: str
    year: int = Field(ge=1950, le=2035)
    model: str
    engines: list[EngineItem] = Field(default_factory=list)
    count: int = Field(default=0, ge=0)


class CategoryItem(BaseModel):
    """Part category/group for a specific vehicle."""
    name: str = Field(default="")
    group_name: str = Field(default="")
    href: str | None = Field(default=None)


class CategoriesResponse(BaseModel):
    """Vehicle part categories response wrapper."""
    make: str
    year: int = Field(ge=1950, le=2035)
    model: str
    carcode: str
    categories: list[CategoryItem] = Field(default_factory=list)
    count: int = Field(default=0, ge=0)


class PartItem(BaseModel):
    """Part result item."""
    name: str = Field(default="Unknown Part")
    part_number: str = Field(default="Unknown")
    price: str | None = Field(default=None)
    brand: str | None = Field(default=None)
    url: str | None = Field(default=None)
    image_url: str | None = Field(default=None)


class PartsResponse(BaseModel):
    """Parts search response wrapper."""
    parts: list[PartItem] = Field(default_factory=list)
    count: int = Field(default=0, ge=0)
    query: str = Field(default="")


class AuditLogEntry(BaseModel):
    """Audit log entry for Neon PG."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    action: str
    route: str
    method: str = Field(default="GET")
    client_ip: str = Field(default="unknown")
    user_agent: str = Field(default="")
    status_code: int = Field(default=200)
    params: dict[str, Any] = Field(default_factory=dict)
    error: str | None = Field(default=None)
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @field_validator("action")
    @classmethod
    def action_must_be_nonempty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("action must not be empty")
        return v.strip().upper()


# ── Audit Logger (Neon PG) ────────────────────────────────────────────────────

async def write_audit_log(entry: AuditLogEntry) -> None:
    """Write audit log entry to Neon PG audit_logs table (fire-and-forget safe)."""
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO audit_logs (id, data, created_at)
                   VALUES ($1, $2::jsonb, NOW())
                   ON CONFLICT (id) DO NOTHING""",
                entry.id,
                entry.model_dump_json(),
            )
    except Exception as exc:
        # Never let audit logging crash the request
        logger.warning("audit_log_write_failed", error=str(exc), entry_id=entry.id)


# ── Lifespan (startup/shutdown) ───────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage resource lifecycle: pool + http client."""
    logger.info("service_starting", version="3.1.0")

    # Startup: warm the connection pool
    try:
        pool = await get_pool()
        # Verify connectivity
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        logger.info("neon_pg_connected")
    except Exception as exc:
        # [LIMIT] DB may not be available at startup in all environments
        logger.warning("neon_pg_startup_check_failed", error=str(exc))

    yield

    # Shutdown: clean up all resources
    logger.info("service_shutting_down")
    await close_http_client()
    await close_pool()
    logger.info("service_stopped")


# ── FastAPI App ───────────────────────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Zempel RockAuto Proxy",
    version="3.1.0",
    docs_url=None,   # Disable Swagger in production
    redoc_url=None,   # Disable ReDoc in production
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Strict CORS — env-driven origins only, no wildcards
_allowed_origins_raw = os.environ.get(
    "ALLOWED_ORIGINS",
    "https://zempel-auto-crm.pages.dev,https://zempelauto.techguruofficial.us",
)
ALLOWED_ORIGINS: list[str] = [o.strip() for o in _allowed_origins_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Service-Auth-Key"],
    expose_headers=["X-Request-Id"],
    max_age=86400,
)
app.add_middleware(SlowAPIMiddleware)


# ── Security Headers Middleware ───────────────────────────────────────────────

@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """Inject OWASP security headers on every response."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    response.headers["X-Request-Id"] = str(uuid.uuid4())
    return response


# ── Request Audit Middleware ──────────────────────────────────────────────────

@app.middleware("http")
async def audit_middleware(request: Request, call_next):
    """Log every API request to Neon PG audit_logs."""
    response = await call_next(request)

    # Fire-and-forget audit log (don't block response)
    if request.url.path.startswith("/api/"):
        try:
            entry = AuditLogEntry(
                action="API_REQUEST",
                route=request.url.path,
                method=request.method,
                client_ip=request.client.host if request.client else "unknown",
                user_agent=request.headers.get("user-agent", "")[:256],
                status_code=response.status_code,
                params=dict(request.query_params),
            )
            # Don't await — fire and forget via background task
            asyncio.create_task(write_audit_log(entry))
        except Exception:
            pass  # Never crash on audit logging

    return response


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Health check with DB connectivity probe."""
    db_ok = False
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        db_ok = True
    except Exception:
        pass

    return HealthResponse(
        status="ok" if db_ok else "degraded",
        version="3.1.0",
        db_connected=db_ok,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@app.get("/api/rockauto/makes")
@limiter.limit("5/second")
async def get_makes(
    request: Request,
    _auth: str = Depends(verify_auth_key),
    client: RockAutoClient = Depends(get_rockauto_client),
) -> dict:
    """Get all vehicle makes from RockAuto."""
    try:
        result = await client.get_makes()
        logger.info("makes_fetched", count=result.count)
        return {"makes": result.makes, "count": result.count}
    except Exception as exc:
        logger.error("makes_fetch_failed", error=str(exc))
        # CAPTCHA fallback: return degraded response instead of 500
        if "captcha" in str(exc).lower():
            raise HTTPException(
                status_code=503,
                detail="Upstream temporarily unavailable (CAPTCHA). Retry after 60s.",
                headers={"Retry-After": "60"},
            )
        raise HTTPException(status_code=502, detail="Upstream service error")


@app.get("/api/rockauto/years/{make}")
@limiter.limit("5/second")
async def get_years(
    make: str,
    request: Request,
    _auth: str = Depends(verify_auth_key),
    client: RockAutoClient = Depends(get_rockauto_client),
) -> dict:
    """Get available years for a vehicle make."""
    if not make or len(make) > 50:
        raise HTTPException(status_code=400, detail="Invalid make parameter")
    try:
        result = await client.get_years_for_make(make)
        logger.info("years_fetched", make=make, count=result.count)
        return {"make": result.make, "years": result.years, "count": result.count}
    except Exception as exc:
        logger.error("years_fetch_failed", make=make, error=str(exc))
        if "captcha" in str(exc).lower():
            raise HTTPException(
                status_code=503,
                detail="Upstream temporarily unavailable (CAPTCHA). Retry after 60s.",
                headers={"Retry-After": "60"},
            )
        raise HTTPException(status_code=502, detail="Upstream service error")


@app.get("/api/rockauto/models/{make}/{year}")
@limiter.limit("5/second")
async def get_models(
    make: str,
    year: int,
    request: Request,
    _auth: str = Depends(verify_auth_key),
    client: RockAutoClient = Depends(get_rockauto_client),
) -> dict:
    """Get models for a make and year."""
    if not make or len(make) > 50:
        raise HTTPException(status_code=400, detail="Invalid make parameter")
    if year < 1950 or year > 2035:
        raise HTTPException(status_code=400, detail="Invalid year parameter")
    try:
        result = await client.get_models_for_make_year(make, year)
        logger.info("models_fetched", make=make, year=year, count=result.count)
        return {"make": result.make, "year": result.year, "models": result.models, "count": result.count}
    except Exception as exc:
        logger.error("models_fetch_failed", make=make, year=year, error=str(exc))
        if "captcha" in str(exc).lower():
            raise HTTPException(
                status_code=503,
                detail="Upstream temporarily unavailable (CAPTCHA). Retry after 60s.",
                headers={"Retry-After": "60"},
            )
        raise HTTPException(status_code=502, detail="Upstream service error")


@app.get("/api/rockauto/engines/{make}/{year}/{model}")
@limiter.limit("5/second")
async def get_engines(
    make: str,
    year: int,
    model: str,
    request: Request,
    _auth: str = Depends(verify_auth_key),
    client: RockAutoClient = Depends(get_rockauto_client),
) -> dict:
    """Get engines for a specific vehicle."""
    if not make or not model or len(make) > 50 or len(model) > 50:
        raise HTTPException(status_code=400, detail="Invalid make/model parameter")
    if year < 1950 or year > 2035:
        raise HTTPException(status_code=400, detail="Invalid year parameter")
    try:
        result = await client.get_engines_for_vehicle(make, year, model)
        engines_out = [
            {"description": e.description, "carcode": e.carcode, "href": e.href}
            for e in result.engines
        ]
        logger.info("engines_fetched", make=make, year=year, model=model, count=result.count)
        return {
            "make": result.make,
            "year": result.year,
            "model": result.model,
            "engines": engines_out,
            "count": result.count,
        }
    except Exception as exc:
        logger.error("engines_fetch_failed", make=make, year=year, model=model, error=str(exc))
        if "captcha" in str(exc).lower():
            raise HTTPException(
                status_code=503,
                detail="Upstream temporarily unavailable (CAPTCHA). Retry after 60s.",
                headers={"Retry-After": "60"},
            )
        raise HTTPException(status_code=502, detail="Upstream service error")


@app.get("/api/rockauto/categories/{make}/{year}/{model}/{carcode}")
@limiter.limit("5/second")
async def get_categories(
    make: str,
    year: int,
    model: str,
    carcode: str,
    request: Request,
    _auth: str = Depends(verify_auth_key),
    client: RockAutoClient = Depends(get_rockauto_client),
) -> dict:
    """Get part categories available for a specific vehicle (make+year+model+carcode)."""
    if not make or not model or len(make) > 50 or len(model) > 50:
        raise HTTPException(status_code=400, detail="Invalid make/model parameter")
    if year < 1950 or year > 2035:
        raise HTTPException(status_code=400, detail="Invalid year parameter")
    if not carcode or not carcode.isalnum() or len(carcode) > 20:
        raise HTTPException(status_code=400, detail="Invalid carcode parameter")
    try:
        result = await client.get_part_categories(make, year, model, carcode)
        categories_out = [
            {"name": c.name, "group_name": c.group_name, "href": c.href}
            for c in result.categories
        ]
        logger.info("categories_fetched", make=make, year=year, model=model, carcode=carcode, count=result.count)
        return {
            "make": result.make,
            "year": result.year,
            "model": result.model,
            "carcode": result.carcode,
            "categories": categories_out,
            "count": result.count,
        }
    except Exception as exc:
        logger.error("categories_fetch_failed", make=make, year=year, model=model, carcode=carcode, error=str(exc))
        if "captcha" in str(exc).lower():
            raise HTTPException(
                status_code=503,
                detail="Upstream temporarily unavailable (CAPTCHA). Retry after 60s.",
                headers={"Retry-After": "60"},
            )
        raise HTTPException(status_code=502, detail="Upstream service error")


@app.get("/api/rockauto/parts/{make}/{year}/{model}/{carcode}")
@limiter.limit("5/second")
async def get_parts(
    make: str,
    year: int,
    model: str,
    carcode: str,
    request: Request,
    category: str = "",
    _auth: str = Depends(verify_auth_key),
    client: RockAutoClient = Depends(get_rockauto_client),
) -> dict:
    """
    Get parts for a specific vehicle + category.

    NOTE: This route previously called `client.search_parts_by_number(carcode)`,
    which searches RockAuto's global part-number index for a part whose NUMBER
    equals the vehicle carcode string — that is a different lookup entirely, so
    it always returned zero (or nonsense) results. Parts are only reachable
    through RockAuto's vehicle catalog: make+year+model+carcode+category. Use
    GET /api/rockauto/categories/{make}/{year}/{model}/{carcode} first to get a
    valid `category` (the `group_name` field of a category), then call this
    route with that value.
    """
    if not make or not model or len(make) > 50 or len(model) > 50:
        raise HTTPException(status_code=400, detail="Invalid make/model parameter")
    if year < 1950 or year > 2035:
        raise HTTPException(status_code=400, detail="Invalid year parameter")
    if not carcode or not carcode.isalnum() or len(carcode) > 20:
        raise HTTPException(status_code=400, detail="Invalid carcode parameter")
    if not category or len(category) > 100:
        raise HTTPException(status_code=400, detail="category query parameter is required")
    try:
        result = await client.get_parts_by_category(make, year, model, carcode, category)
        parts_out = [
            {
                "name": p.name,
                "part_number": p.part_number,
                "price": p.price,
                "brand": p.brand,
                "url": p.url,
                "image_url": p.image_url,
            }
            for p in result.parts
        ]
        logger.info("parts_fetched", make=make, year=year, model=model, carcode=carcode, category=category, count=len(parts_out))
        return {"parts": parts_out, "count": len(parts_out), "query": carcode, "category": result.category}
    except Exception as exc:
        logger.error("parts_fetch_failed", make=make, year=year, model=model, carcode=carcode, category=category, error=str(exc))
        if "captcha" in str(exc).lower():
            raise HTTPException(
                status_code=503,
                detail="Upstream temporarily unavailable (CAPTCHA). Retry after 60s.",
                headers={"Retry-After": "60"},
            )
        raise HTTPException(status_code=502, detail="Upstream service error")


@app.get("/api/rockauto/search")
@limiter.limit("5/second")
async def search_by_name(
    request: Request,
    q: str = "",
    _auth: str = Depends(verify_auth_key),
    client: RockAutoClient = Depends(get_rockauto_client),
) -> dict:
    """Search parts by name/description."""
    if not q or len(q) < 2 or len(q) > 200:
        raise HTTPException(status_code=400, detail="Query 'q' must be 2-200 characters")
    try:
        result = await client.what_is_part_called(q)
        results_out = [
            {
                "name": getattr(r, "name", "Unknown"),
                "href": getattr(r, "href", ""),
                "description": getattr(r, "description", ""),
            }
            for r in (result.results if hasattr(result, "results") else [])
        ]
        logger.info("search_completed", query=q, count=len(results_out))
        return {"results": results_out, "count": len(results_out), "query": q}
    except Exception as exc:
        logger.error("search_failed", query=q, error=str(exc))
        if "captcha" in str(exc).lower():
            raise HTTPException(
                status_code=503,
                detail="Upstream temporarily unavailable (CAPTCHA). Retry after 60s.",
                headers={"Retry-After": "60"},
            )
        raise HTTPException(status_code=502, detail="Upstream service error")


# ── Global Exception Handler ─────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all: mask internal errors, log details server-side."""
    logger.error(
        "unhandled_exception",
        path=request.url.path,
        method=request.method,
        error=str(exc),
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8000")),
        workers=1,
        log_level="info",
        access_log=True,
    )
