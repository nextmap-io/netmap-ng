"""
Application middlewares: request body size limit + per-IP rate limiting.

Wiring (slice A — main.py):
    from app.middlewares import BodySizeLimitMiddleware, RateLimitMiddleware

    app.add_middleware(BodySizeLimitMiddleware)
    app.add_middleware(RateLimitMiddleware)

Notes:
- These middlewares are *defense in depth* and run per-process. In production
  the same limits should also be enforced at the reverse proxy (nginx,
  Traefik, etc.) to absorb abuse before it reaches Python. With multiple
  workers, a malicious client gets `workers * limit` rps before being shaped.
- The rate limit uses a simple in-memory token bucket per (client_ip, bucket).
  Two buckets are configured: `/api/public/*` (lower) and the rest of `/api/*`
  (higher). Other paths (e.g. `/health`, `/auth/*`) are not rate limited here.
- Body size limit consults the `Content-Length` header. Streaming requests
  without a `Content-Length` are allowed through; if you need to enforce a
  hard cap on streamed bodies, do so at the proxy.
"""

import logging
import time
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import get_settings

logger = logging.getLogger("netmap.middleware")


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests whose declared `Content-Length` exceeds the cap."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        settings = get_settings()
        limit = settings.max_body_size_bytes
        cl = request.headers.get("content-length")
        if cl is not None:
            try:
                size = int(cl)
            except ValueError:
                return JSONResponse(
                    {"detail": "Invalid Content-Length"}, status_code=400
                )
            if size > limit:
                logger.info(
                    "Rejecting oversized request: %s bytes > %s (path=%s)",
                    size,
                    limit,
                    request.url.path,
                )
                return JSONResponse(
                    {"detail": f"Request body too large (max {limit} bytes)"},
                    status_code=413,
                )
        return await call_next(request)


# Bucket identifiers
_PUBLIC = "public"
_API = "api"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Naive per-IP token bucket. Per-process — pair with proxy-level limits.

    Two buckets:
      - `/api/public/*`            -> `rate_limit_public_per_min`
      - other `/api/*` endpoints   -> `rate_limit_api_per_min`

    Anything outside `/api/*` is not rate limited here.
    """

    def __init__(self, app) -> None:
        super().__init__(app)
        # key=(client_ip, bucket) -> (tokens, last_refill_monotonic)
        self._buckets: dict[tuple[str, str], tuple[float, float]] = {}

    @staticmethod
    def _client_ip(request: Request) -> str:
        # Prefer the immediate peer; trusting X-Forwarded-* needs proxy config.
        if request.client is not None:
            return request.client.host
        return "unknown"

    @staticmethod
    def _bucket_for(path: str) -> str | None:
        if path.startswith("/api/public/"):
            return _PUBLIC
        if path.startswith("/api/"):
            return _API
        return None

    def _capacity(self, bucket: str) -> int:
        s = get_settings()
        return s.rate_limit_public_per_min if bucket == _PUBLIC else s.rate_limit_api_per_min

    def _consume(self, ip: str, bucket: str) -> bool:
        capacity = self._capacity(bucket)
        # refill rate = capacity tokens per 60 seconds
        rate_per_sec = capacity / 60.0
        now = time.monotonic()
        tokens, last = self._buckets.get((ip, bucket), (float(capacity), now))
        # Refill since last check
        elapsed = max(0.0, now - last)
        tokens = min(float(capacity), tokens + elapsed * rate_per_sec)
        if tokens < 1.0:
            self._buckets[(ip, bucket)] = (tokens, now)
            return False
        tokens -= 1.0
        self._buckets[(ip, bucket)] = (tokens, now)
        return True

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        bucket = self._bucket_for(request.url.path)
        if bucket is None:
            return await call_next(request)

        ip = self._client_ip(request)
        if not self._consume(ip, bucket):
            logger.info(
                "Rate limit exceeded ip=%s bucket=%s path=%s", ip, bucket, request.url.path
            )
            return JSONResponse(
                {"detail": "Too Many Requests"},
                status_code=429,
                headers={"Retry-After": "1"},
            )
        return await call_next(request)
