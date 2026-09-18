from types import SimpleNamespace
from typing import Any

from backend.app.metrics import Word
from backend.app.models import SpeechMetrics
from backend.app.services import _build_feedback_prompt, _extract_words


def _raw_word(text: Any, start: Any, end: Any, kind: str = "word") -> SimpleNamespace:
    return SimpleNamespace(text=text, start=start, end=end, type=kind)


def test_extract_words_keeps_only_word_entries() -> None:
    response = SimpleNamespace(
        words=[
            _raw_word("Hello", 0.0, 0.5),
            _raw_word(" ", 0.5, 0.6, kind="spacing"),
            _raw_word("world", 0.6, 1.0),
        ]
    )

    assert _extract_words(response) == [
        Word("Hello", 0.0, 0.5),
        Word("world", 0.6, 1.0),
    ]


def test_extract_words_skips_incomplete_entries_and_coerces_timestamps() -> None:
    response = SimpleNamespace(
        words=[
            _raw_word("missing-end", 0.0, None),
            _raw_word("", 0.2, 0.4),
            _raw_word("ok", "1.0", "1.5"),
        ]
    )

    assert _extract_words(response) == [Word("ok", 1.0, 1.5)]


def test_extract_words_tolerates_missing_words_attribute() -> None:
    assert _extract_words(SimpleNamespace()) == []


def _metrics() -> SpeechMetrics:
    return SpeechMetrics(
        duration_seconds=12.5,
        word_count=30,
        words_per_minute=144.0,
        filler_word_count=2,
        filler_words_per_minute=9.6,
        filler_word_breakdown={"um": 2},
        filler_occurrences=[{"text": "um", "start": 1.0, "end": 1.3}],
        noticeable_pause_count=1,
        average_pause_seconds=1.5,
        longest_pause_seconds=1.5,
        pause_occurrences=[{"start": 3.0, "end": 4.5, "duration_seconds": 1.5}],
    )


def test_build_feedback_prompt_embeds_question_transcript_and_metrics() -> None:
    prompt = _build_feedback_prompt("Tell me about yourself", "Hello um world", _metrics())

    assert "Tell me about yourself" in prompt
    assert "Hello um world" in prompt
    assert '"word_count": 30' in prompt
    assert '"filler_word_count": 2' in prompt
    assert '"um": 2' in prompt
