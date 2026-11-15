import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.security import reset_rate_limits

API_KEY = "test-key-test-key-123"


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setenv("NLP_API_KEY", API_KEY)
    monkeypatch.setenv("RATE_LIMIT_PER_MIN", "1000")
    reset_rate_limits()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def headers():
    return {"X-API-Key": API_KEY}
