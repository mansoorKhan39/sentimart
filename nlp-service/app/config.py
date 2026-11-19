import os


def api_key() -> str:
    """Read at request time so tests can change it. Empty means 'not configured'."""
    return os.environ.get("NLP_API_KEY", "")


def rate_limit_per_min() -> int:
    return int(os.environ.get("RATE_LIMIT_PER_MIN", "60"))


MAX_TEXT_LENGTH = int(os.environ.get("MAX_TEXT_LENGTH", "2000"))
