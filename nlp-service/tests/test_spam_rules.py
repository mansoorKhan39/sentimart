from app.services.spam_rules import score_text


def test_normal_review_is_clean():
    score, reasons = score_text("Great phone, the battery lasts two days and the screen is bright.")
    assert score == 0 and reasons == []


def test_promo_link_and_phrase_together_cross_the_default_threshold():
    score, reasons = score_text("Best prices! Visit my shop www.cheap-deals.com and use discount code SAVE")
    assert {"link", "promo_phrase"} <= set(reasons)
    assert score >= 0.7


def test_single_link_alone_stays_below_the_threshold():
    score, reasons = score_text("Works well, I compared it on amazon.com before buying it here.")
    assert reasons == ["link"]
    assert score < 0.7


def test_contact_info_is_detected():
    _, reasons = score_text("Great seller, call me on +92 300 1234567 or mail ali@example.com")
    assert "contact_info" in reasons


def test_too_short_and_shouting():
    _, short = score_text("ok")
    assert "too_short" in short
    _, shout = score_text("THIS IS THE BEST PRODUCT EVER MADE IN THE WORLD!!!!!")
    assert {"all_caps", "excess_punctuation"} <= set(shout)


def test_repeated_words_and_characters():
    _, reasons = score_text("good good good good good good good good good good")
    assert "repeated_words" in reasons
    _, reasons = score_text("soooooooo niceeeeeee product really")
    assert "repeated_chars" in reasons


def test_rating_mismatch_needs_a_strong_opposite_sentiment():
    _, loved_but_low = score_text("Absolutely wonderful product, I love it so much", rating=1, sentiment_score=0.9)
    assert "rating_mismatch" in loved_but_low
    _, consistent = score_text("Absolutely wonderful product, I love it so much", rating=5, sentiment_score=0.9)
    assert "rating_mismatch" not in consistent
    _, mild = score_text("It is fine I guess, nothing special at all", rating=2, sentiment_score=0.1)
    assert "rating_mismatch" not in mild


def test_score_is_between_zero_and_one():
    score, _ = score_text("BUY NOW!!!!! www.x.com call us +92 300 1234567 soooooooo cheap cheap cheap cheap cheap cheap cheap cheap")
    assert 0 < score <= 1
