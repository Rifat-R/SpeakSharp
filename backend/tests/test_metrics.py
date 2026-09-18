from backend.app.metrics import Word, compute_metrics


def test_basic_metrics_and_fillers() -> None:
    words = [
        Word("Hello", 0.0, 0.5),
        Word("um", 0.6, 0.9),
        Word("world.", 1.0, 1.4),
        Word("You", 1.5, 1.7),
        Word("know", 1.8, 2.1),
        Word("it", 2.2, 2.4),
        Word("is", 2.5, 2.6),
        Word("good", 2.7, 3.0),
    ]

    metrics = compute_metrics(words)

    assert metrics["word_count"] == 8
    assert metrics["duration_seconds"] == 3.0
    assert metrics["words_per_minute"] == 160.0
    assert metrics["filler_word_count"] == 2
    assert metrics["filler_word_breakdown"] == {"um": 1, "you know": 1}
    assert metrics["filler_words_per_minute"] == 40.0
    assert metrics["noticeable_pause_count"] == 0


def test_pause_detection_and_leading_silence() -> None:
    words = [
        Word("a", 5.0, 5.5),
        Word("b", 7.0, 7.5),
        Word("c", 8.0, 8.5),
    ]

    metrics = compute_metrics(words, pause_threshold_seconds=1.0)

    assert metrics["duration_seconds"] == 3.5
    assert metrics["noticeable_pause_count"] == 1
    assert metrics["average_pause_seconds"] == 1.5
    assert metrics["longest_pause_seconds"] == 1.5


def test_pause_threshold_is_configurable() -> None:
    words = [Word("a", 0.0, 0.5), Word("b", 1.0, 1.5)]

    assert compute_metrics(words, pause_threshold_seconds=1.0)["noticeable_pause_count"] == 0
    assert compute_metrics(words, pause_threshold_seconds=0.4)["noticeable_pause_count"] == 1


def test_empty_transcript_returns_zeroed_metrics() -> None:
    metrics = compute_metrics([])

    assert metrics["word_count"] == 0
    assert metrics["duration_seconds"] == 0.0
    assert metrics["words_per_minute"] == 0.0
    assert metrics["filler_word_count"] == 0
    assert metrics["filler_word_breakdown"] == {}
    assert metrics["noticeable_pause_count"] == 0


def test_filler_normalization_ignores_punctuation_and_case() -> None:
    words = [Word("Um,", 0.0, 0.3), Word("LIKE", 0.4, 0.7)]

    metrics = compute_metrics(words)

    assert metrics["filler_word_breakdown"] == {"like": 1, "um": 1}
