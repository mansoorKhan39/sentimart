from app.services.sentiment import analyze_sentiment, label_for


def test_labels_follow_the_vader_thresholds():
    assert label_for(0.05) == "positive"
    assert label_for(-0.05) == "negative"
    assert label_for(0.049) == "neutral"
    assert label_for(0.0) == "neutral"


def test_clear_positive_and_negative_reviews():
    label, score = analyze_sentiment("I love this phone, it is amazing and works perfectly!")
    assert label == "positive" and score > 0.5
    label, score = analyze_sentiment("Terrible quality. It broke after two days, very disappointed.")
    assert label == "negative" and score < -0.5


def test_plain_statement_is_neutral():
    label, _ = analyze_sentiment("It is a phone.")
    assert label == "neutral"
