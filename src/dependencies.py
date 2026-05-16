"""
Dependency injection providers for FastAPI.

Manages lifecycle of:
- asyncpg connection pool (Neon PG with pgbouncer/SSL)
- httpx.AsyncClient (shared HTTP session)
- RockAutoClient (per-request, session-isolated)
- API key authentication
"""

from __future__ import annotations

import os
import ssl
import asyncio
from typing import AsyncGenerator

import asyncpg
import httpx
import structlog
from fastapi import HTTPException, Request, Security
from fastapi.security import APIKeyHeader

logger = structlog.get_logger("dependencies")

# ── Auth ──────────────────────────────────────────────────────────────────────

API_KEY_NAME = "X-Service-Auth-Key"
_api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)


async def verify_auth_key(api_key: str | None = Security(_api_key_header)) -> str:
    """Validate X-Service-Auth-Key header against env var."""
    expected_key = os.environ.get("SERVICE_AUTH_KEY")
    if not expected_key:
        logger.error("SERVICE_AUTH_KEY not configured")
        raise HTTPException(status_code=500, detail="Service configuration error")
    if not api_key or api_key != expected_key:
        raise HTTPException(status_code=403, detail="Invalid service authentication key")
    return api_key


# ── asyncpg Pool (Neon PG with SSL) ──────────────────────────────────────────

_pool: asyncpg.Pool | None = None
_POOL_LOCK = asyncio.Lock()

# Exponential backoff settings for pool creation
_MAX_RETRIES = 3
_BASE_DELAY_S = 1.0


async def _create_pool() -> asyncpg.Pool:
    """Create asyncpg pool with SSL enforcement and exponential backoff."""
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL environment variable is required")

    # Enforce SSL/TLS for Neon PG connections
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = True
    ssl_ctx.verify_mode = ssl.CERT_REQUIRED

    last_exc: Exception | None = None
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            pool = await asyncpg.create_pool(
                database_url,
                min_size=2,
                max_size=10,
                max_inactive_connection_lifetime=300.0,
                command_timeout=30.0,
                ssl=ssl_ctx,
            )
            if pool is None:
                raise RuntimeError("asyncpg.create_pool returned None")
            logger.info("asyncpg_pool_created", attempt=attempt, min_size=2, max_size=10)
            return pool
        except Exception as exc:
            last_exc = exc
            delay = _BASE_DELAY_S * (2 ** (attempt - 1))
            logger.warning(
                "pool_creation_retry",
                attempt=attempt,
                max_retries=_MAX_RETRIES,
                delay_s=delay,
                error=str(exc),
            )
            if attempt < _MAX_RETRIES:
                await asyncio.sleep(delay)

    raise RuntimeError(f"Failed to create DB pool after {_MAX_RETRIES} attempts: {last_exc}")


async def get_pool() -> asyncpg.Pool:
    """Get or create the shared asyncpg connection pool (singleton)."""
    global _pool
    if _pool is None or _pool._closed:  # noqa: SLF001
        async with _POOL_LOCK:
            if _pool is None or _pool._closed:  # noqa: SLF001
                _pool = await _create_pool()
    return _pool


async def close_pool() -> None:
    """Gracefully close the asyncpg pool."""
    global _pool
    if _pool is not None and not _pool._closed:  # noqa: SLF001
        await _pool.close()
        logger.info("asyncpg_pool_closed")
        _pool = None


async def get_db_conn() -> AsyncGenerator[asyncpg.Connection, None]:
    """FastAPI dependency: acquire a connection from the pool, release on exit."""
    pool = await get_pool()
    conn = await pool.acquire()
    try:
        yield conn
    finally:
        await pool.release(conn)


# ── Shared httpx.AsyncClient ─────────────────────────────────────────────────

_http_client: httpx.AsyncClient | None = None


async def create_http_client() -> httpx.AsyncClient:
    """Create shared httpx client with production timeouts."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=15.0, write=10.0, pool=10.0),
            follow_redirects=True,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
        logger.info("httpx_client_created")
    return _http_client


async def close_http_client() -> None:
    """Gracefully close the shared httpx client."""
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
        logger.info("httpx_client_closed")
        _http_client = None


# ── RockAutoClient (per-request, session-isolated) ───────────────────────────

async def get_rockauto_client() -> AsyncGenerator:
    """
    FastAPI dependency: create a fresh RockAutoClient per request for session isolation.
    Uses rockauto-api==1.0.0 exact API surface.
    """
    from rockauto_api import RockAutoClient  # noqa: PLC0415

    client = RockAutoClient()
    try:
        yield client
    finally:
        await client.close()
