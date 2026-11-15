import hmac
import time
from collections import defaultdict, deque

from fastapi import Header, HTTPException, Request

from app import config

_hits: dict[str, deque[float]] = defaultdict(deque)


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Fails closed: no configured key means no access, not open access."""
    expected = config.api_key()
    if not expected:
        raise HTTPException(status_code=503, detail="Service is not configured")
    if not x_api_key or not hmac.compare_digest(x_api_key.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


def rate_limit(request: Request) -> None:
    """Sliding window per client. In memory, so best effort on serverless (one counter per instance)."""
    limit = config.rate_limit_per_min()
    client = request.client.host if request.client else "unknown"
    now = time.monotonic()
    window = _hits[client]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= limit:
        raise HTTPException(status_code=429, detail="Too many requests")
    window.append(now)


def reset_rate_limits() -> None:
    _hits.clear()
