"""CSRF protection via the double-submit cookie pattern.

For state-changing requests (POST/PUT/PATCH/DELETE) we require an
`X-CSRF-Token` request header whose value matches the `csrf_token` cookie.
The cookie is `SameSite=Strict` and intentionally NOT HttpOnly so that the
SPA can read it and copy the value into the header. The cookie is rotated
when missing or empty.

Endpoints under `/auth/*` are exempted (the OIDC callback comes from the IdP
without our cookie context). Endpoints under `/api/public/*` are read-only
and exempted from CSRF (any non-GET there is denied at the router level).
"""

from __future__ import annotations

import hmac
import secrets
from collections.abc import Awaitable, Callable
from urllib.parse import urlparse

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
EXEMPT_PREFIXES = (
    "/auth/",
    "/api/public/",
    "/health",
    "/docs",
    "/redoc",
    "/openapi.json",
)


class CSRFMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app: ASGIApp,
        cookie_name: str = "csrf_token",
        header_name: str = "X-CSRF-Token",
        secure: bool = False,
    ) -> None:
        super().__init__(app)
        self.cookie_name = cookie_name
        self.header_name = header_name
        self.secure = secure

    @staticmethod
    def _is_exempt(path: str) -> bool:
        return any(path == p or path.startswith(p) for p in EXEMPT_PREFIXES)

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        method = request.method.upper()
        path = request.url.path
        cookie = request.cookies.get(self.cookie_name)

        if method in UNSAFE_METHODS and not self._is_exempt(path):
            header = request.headers.get(self.header_name, "")
            if not cookie or not header or not hmac.compare_digest(cookie, header):
                return JSONResponse(
                    {"detail": "CSRF token missing or invalid"}, status_code=403
                )

        response = await call_next(request)

        # Issue (or refresh) the CSRF cookie when missing. Lax origin check —
        # we only set the cookie on requests that look like they come from the
        # SPA itself (same-origin) to avoid leaking tokens to third-party hosts.
        if not cookie:
            origin = (
                request.headers.get("origin") or request.headers.get("referer") or ""
            )
            same_origin = True
            if origin:
                origin_host = urlparse(origin).hostname or ""
                request_host = urlparse(str(request.url)).hostname or ""
                same_origin = origin_host == request_host
            if same_origin:
                token = secrets.token_urlsafe(32)
                response.set_cookie(
                    self.cookie_name,
                    token,
                    secure=self.secure,
                    httponly=False,
                    samesite="strict",
                    path="/",
                )
        return response
