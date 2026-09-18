"""Session-based demo authentication.

Authentication is enabled in production and whenever ``DEMO_PASSWORD`` is set.
The signed session cookie holds only an ``authenticated`` boolean. Signing and
verification are handled by Starlette's ``SessionMiddleware``.

This module is intentionally small so the demo password can be removed cleanly
once the public deployment no longer needs it.
"""

import secrets
import time
from collections import deque
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from .config import Settings, get_settings
from .models import LoginRequest, LoginResponse

SESSION_COOKIE_NAME = "speaksharp_session"
DEVELOPMENT_SESSION_SECRET = "speaksharp-development-session-secret"

MAX_FAILED_LOGINS = 5
FAILED_LOGIN_WINDOW_SECONDS = 300.0


def session_secret(settings: Settings) -> str:
    return settings.session_secret or DEVELOPMENT_SESSION_SECRET


class LoginRateLimiter:
    """Process-local failed-login limiter keyed by effective client IP.

    Appropriate while the deployment runs a single Uvicorn worker. Moving to
    multiple workers or replicas requires shared state or edge-level controls.
    """

    def __init__(
        self,
        max_failures: int = MAX_FAILED_LOGINS,
        window_seconds: float = FAILED_LOGIN_WINDOW_SECONDS,
    ) -> None:
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self._failures: dict[str, deque[float]] = {}

    def _recent(self, key: str, now: float) -> deque[float]:
        failures = self._failures.setdefault(key, deque())
        while failures and now - failures[0] >= self.window_seconds:
            failures.popleft()
        return failures

    def retry_after(self, key: str, now: float | None = None) -> int | None:
        now = time.monotonic() if now is None else now
        failures = self._recent(key, now)
        if len(failures) < self.max_failures:
            return None
        return max(1, int(self.window_seconds - (now - failures[0])) + 1)

    def record_failure(self, key: str, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        self._recent(key, now).append(now)

    def reset(self, key: str) -> None:
        self._failures.pop(key, None)

    def clear(self) -> None:
        self._failures.clear()


def client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def get_login_limiter(request: Request) -> LoginRateLimiter:
    limiter = getattr(request.app.state, "login_limiter", None)
    if limiter is None:
        limiter = LoginRateLimiter()
        request.app.state.login_limiter = limiter
    return limiter


def require_auth(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    if not settings.auth_enabled or request.session.get("authenticated"):
        return
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="This demo needs a password before analysis.",
    )


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    limiter: Annotated[LoginRateLimiter, Depends(get_login_limiter)],
) -> LoginResponse:
    if not settings.auth_enabled:
        return LoginResponse(authenticated=True)

    key = client_key(request)
    retry_after = limiter.retry_after(key)
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Please try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    submitted = payload.password.encode("utf-8")
    expected = settings.demo_password.encode("utf-8")
    if not secrets.compare_digest(submitted, expected):
        limiter.record_failure(key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password.",
        )

    limiter.reset(key)
    request.session.clear()
    request.session["authenticated"] = True
    return LoginResponse(authenticated=True)
