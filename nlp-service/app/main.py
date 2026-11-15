from fastapi import FastAPI

from app.routers import analyze, health

app = FastAPI(title="SentiMart NLP service", version="0.1.0", docs_url=None, redoc_url=None)

# Served at the root (/analyze) and also under /api (/api/analyze), so either NLP_URL style works.
for prefix in ("", "/api"):
    app.include_router(health.router, prefix=prefix)
    app.include_router(analyze.router, prefix=prefix)
