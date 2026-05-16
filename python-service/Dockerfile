# ── Stage 1: Build ────────────────────────────────────────────
FROM python:3.11.12-slim-bookworm AS builder

WORKDIR /build

# System deps for asyncpg (libpq) compilation
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN pip install --no-cache-dir --prefix=/install .

# ── Stage 2: Runtime ─────────────────────────────────────────
FROM python:3.11.12-slim-bookworm AS runtime

LABEL maintainer="TechGuruServices"
LABEL version="3.1.0"

# Non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Runtime libpq for asyncpg
RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq5 ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Copy application source
COPY src/ ./

# Switch to non-root
USER appuser

# Health check (matches Render health check path)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/health || exit 1

EXPOSE 8000

# Uvicorn with production settings
# PORT injected by Render/Cloud Run at runtime
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --log-level info --access-log"]
