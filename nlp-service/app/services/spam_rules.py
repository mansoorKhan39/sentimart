import re

# Rules that need only the review text (and optionally the rating). Checks that need the
# review history (duplicates, burst posting) are done by the API, which owns the database.
URL = re.compile(r"(https?://|www\.|\b[a-z0-9-]+\.(com|net|org|pk|info|biz|xyz)\b)", re.I)
CONTACT = re.compile(r"(\b[\w.+-]+@[\w-]+\.[\w.]+\b|(?:\+?\d[\s-]?){10,})")
PROMO_PHRASES = (
    "buy now", "click here", "visit my", "discount code", "promo code", "whatsapp", "dm me",
    "follow me", "free gift", "earn money", "limited offer", "order now", "call us", "check my profile",
)
REPEATED_CHARS = re.compile(r"(.)\1{5,}")
SHOUTING_PUNCT = re.compile(r"[!?]{4,}")

# (reason, weight). Combined as independent probabilities: 1 - product(1 - weight).
WEIGHTS = {
    "too_short": 0.2,
    "repeated_words": 0.35,
    "repeated_chars": 0.2,
    "link": 0.5,
    "contact_info": 0.3,
    "promo_phrase": 0.4,
    "all_caps": 0.2,
    "excess_punctuation": 0.15,
    "rating_mismatch": 0.25,
}


def score_text(
    text: str, rating: int | None = None, sentiment_score: float | None = None
) -> tuple[float, list[str]]:
    reasons: list[str] = []
    stripped = text.strip()
    lowered = stripped.lower()
    words = re.findall(r"\w+", lowered)

    if len(stripped) < 15:
        reasons.append("too_short")
    if len(words) >= 8 and len(set(words)) / len(words) < 0.4:
        reasons.append("repeated_words")
    if REPEATED_CHARS.search(stripped):
        reasons.append("repeated_chars")
    if URL.search(stripped):
        reasons.append("link")
    if CONTACT.search(stripped):
        reasons.append("contact_info")
    if any(phrase in lowered for phrase in PROMO_PHRASES):
        reasons.append("promo_phrase")
    letters = [c for c in stripped if c.isalpha()]
    if len(letters) >= 20 and sum(c.isupper() for c in letters) / len(letters) > 0.7:
        reasons.append("all_caps")
    if SHOUTING_PUNCT.search(stripped):
        reasons.append("excess_punctuation")
    if rating is not None and sentiment_score is not None and (
        (sentiment_score >= 0.5 and rating <= 2) or (sentiment_score <= -0.5 and rating >= 4)
    ):
        reasons.append("rating_mismatch")

    clean = 1.0
    for reason in reasons:
        clean *= 1 - WEIGHTS[reason]
    return round(1 - clean, 3), reasons
