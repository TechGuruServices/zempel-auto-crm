FROM python:3.11-slim AS builder
WORKDIR /build
COPY pyproject.toml .
RUN pip install --no-cache-dir --prefix=/install .
COPY src/ ./
RUN python -m compileall src/

FROM python:3.11-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_PORT=8000 \
    CORS_ORIGINS=https://yourdomain.com \
    DATABASE_URL="" \
    RATE_LIMIT_RPS=5
WORKDIR /app
COPY --from=builder /install /usr/local
COPY --from=builder /build/src ./
EXPOSE ${APP_PORT}
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${APP_PORT}/health')" || exit 1
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "${APP_PORT}", "--workers", "2", "--log-level", "info"]
