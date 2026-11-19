from fastapi import APIRouter, Depends

from app.schemas import AnalyzeRequest, AnalyzeResponse
from app.security import rate_limit, require_api_key
from app.services.keywords import extract_keywords
from app.services.sentiment import analyze_sentiment
from app.services.spam_rules import score_text

router = APIRouter()


@router.post(
    "/analyze",
    response_model=AnalyzeResponse,
    dependencies=[Depends(require_api_key), Depends(rate_limit)],
)
def analyze(body: AnalyzeRequest) -> AnalyzeResponse:
    label, score = analyze_sentiment(body.text)
    spam_score, spam_reasons = score_text(body.text, body.rating, score)
    return AnalyzeResponse(
        label=label,
        score=score,
        keywords=extract_keywords(body.text),
        spam_score=spam_score,
        spam_reasons=spam_reasons,
    )
