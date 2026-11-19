from app.services.keywords import extract_keywords


def test_returns_most_frequent_content_words():
    keywords = extract_keywords("The battery is great. Battery life is great and the screen is bright.")
    assert keywords[0] == "battery"
    assert "great" in keywords
    assert "the" not in keywords and "and" not in keywords


def test_keeps_negated_phrases_for_complaints():
    keywords = extract_keywords("The charger is not working and the case is not durable.")
    assert "not working" in keywords
    assert "not durable" in keywords


def test_limit_and_empty_text():
    assert len(extract_keywords("alpha beta gamma delta epsilon zeta eta theta", limit=3)) == 3
    assert extract_keywords("the and of") == []
