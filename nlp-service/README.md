# SentiMart NLP service (Module 4)

FastAPI microservice: sentiment (VADER), keywords and text-only spam rules. The Express API calls it
when a review is submitted. Review history checks (duplicates, burst posting) stay in the API.

## Run locally (Windows cmd)
```
cd nlp-service
python --version            (3.10 or newer)
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt
copy .env.example .env      (then set NLP_API_KEY to a long random value)
set NLP_API_KEY=your-key-here
uvicorn app.main:app --reload --port 8000
```
Check: open http://localhost:8000/health, then in another cmd window:
```
curl -X POST http://localhost:8000/analyze -H "Content-Type: application/json" -H "X-API-Key: your-key-here" -d "{\"text\":\"Great quality, works perfectly\",\"rating\":5}"
```

## Test and lint
```
pytest
ruff check .
```

## API
| Method | Route | Notes |
|---|---|---|
| GET | /health | no key needed |
| POST | /analyze | header `X-API-Key`; body `{ "text": "...", "rating": 1-5 (optional) }` |

Response: `label` (positive / neutral / negative), `score` (-1 to 1), `keywords`, `spam_score` (0 to 1), `spam_reasons`.
Also available under `/api/health` and `/api/analyze`.

## Deploy (Vercel)
- New Vercel project, Root Directory `nlp-service`.
- Environment variable: `NLP_API_KEY` (same value as in the Express API). Without it the service answers 503 (fails closed).
- Set `NLP_URL` in the Express project to this project's URL, for example `https://sentimart-nlp.vercel.app`.
- First call after idle is slow (cold start); the API treats a timeout as "analysis pending" and retries later.
