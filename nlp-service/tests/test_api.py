BODY = {"text": "Great quality, works perfectly and arrived early.", "rating": 5}


def test_health_needs_no_key(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/api/health").status_code == 200


def test_analyze_requires_the_api_key(client, headers):
    assert client.post("/analyze", json=BODY).status_code == 401
    assert client.post("/analyze", json=BODY, headers={"X-API-Key": "wrong"}).status_code == 401
    assert client.post("/analyze", json=BODY, headers=headers).status_code == 200


def test_fails_closed_when_no_key_is_configured(client, monkeypatch):
    monkeypatch.delenv("NLP_API_KEY")
    res = client.post("/analyze", json=BODY, headers={"X-API-Key": ""})
    assert res.status_code == 503


def test_response_shape(client, headers):
    data = client.post("/analyze", json=BODY, headers=headers).json()
    assert data["label"] == "positive"
    assert -1 <= data["score"] <= 1
    assert isinstance(data["keywords"], list)
    assert data["spam_score"] == 0 and data["spam_reasons"] == []


def test_also_served_under_api_prefix(client, headers):
    assert client.post("/api/analyze", json=BODY, headers=headers).status_code == 200


def test_spammy_text_is_scored(client, headers):
    body = {"text": "Visit my shop www.cheap-deals.com and use discount code SAVE", "rating": 5}
    data = client.post("/analyze", json=body, headers=headers).json()
    assert data["spam_score"] >= 0.7
    assert "link" in data["spam_reasons"]


def test_input_validation(client, headers):
    post = lambda body: client.post("/analyze", json=body, headers=headers).status_code  # noqa: E731
    assert post({"text": ""}) == 422
    assert post({"text": "   "}) == 422
    assert post({"text": "x" * 2001}) == 422
    assert post({"text": "fine text here", "rating": 6}) == 422
    assert post({"text": "fine text here", "extra": 1}) == 422
    assert post({}) == 422


def test_rate_limit(client, headers, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MIN", "2")
    codes = [client.post("/analyze", json=BODY, headers=headers).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
