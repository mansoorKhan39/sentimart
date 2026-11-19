from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import MAX_TEXT_LENGTH


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    rating: int | None = Field(default=None, ge=1, le=5)

    @field_validator("text")
    @classmethod
    def not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("text must not be blank")
        return value


class AnalyzeResponse(BaseModel):
    label: str  # positive | neutral | negative
    score: float  # VADER compound, -1 (very negative) to +1 (very positive)
    keywords: list[str]
    spam_score: float  # 0 (clean) to 1 (certain spam), from text rules only
    spam_reasons: list[str]
