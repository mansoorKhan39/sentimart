from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

# Loading the lexicon takes a moment, so do it once per process (cold start only).
_analyzer = SentimentIntensityAnalyzer()

POSITIVE_AT = 0.05  # standard VADER thresholds
NEGATIVE_AT = -0.05


def label_for(score: float) -> str:
    if score >= POSITIVE_AT:
        return "positive"
    if score <= NEGATIVE_AT:
        return "negative"
    return "neutral"


def analyze_sentiment(text: str) -> tuple[str, float]:
    score = round(_analyzer.polarity_scores(text)["compound"], 4)
    return label_for(score), score
