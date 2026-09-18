import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import (
    app,
    get_feedback_service,
    get_settings,
    get_transcription_service,
)
from backend.app.metrics import Word
from backend.app.models import InterviewFeedback
from backend.app.services import (
    FeedbackError,
    TranscriptionError,
    TranscriptResult,
    UnintelligibleAudioError,
)

VALID_AUDIO = ("recording.webm", b"fake-audio-bytes", "audio/webm")


def _feedback() -> InterviewFeedback:
    return InterviewFeedback(
        overall_assessment="Clear but unfocused.",
        strengths=["Confident opening"],
        improvements=["Add a concrete example"],
        suggested_structure=["Present", "Past", "Why this role"],
        next_steps=["Rehearse a 90 second version"],
    )


DEFAULT_WORDS = [
    Word("Hello", 0.0, 0.5),
    Word("um", 0.6, 0.9),
    Word("world", 1.0, 1.4),
]


class FakeTranscription:
    def __init__(self, error: Exception | None = None, words: list[Word] | None = None) -> None:
        self.error = error
        self._words = words

    def transcribe(self, filename: str, content: bytes, content_type: str):
        if self.error:
            raise self.error
        words = self._words if self._words is not None else DEFAULT_WORDS
        return TranscriptResult(text=" ".join(word.text for word in words), words=words)


class FakeFeedback:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error

    async def generate(self, question: str, transcript: str, metrics):
        if self.error:
            raise self.error
        return _feedback()


@pytest.fixture
def make_client():
    def _make(transcription=None, feedback=None, settings=None):
        app.dependency_overrides[get_transcription_service] = lambda: (
            transcription if transcription is not None else FakeTranscription()
        )
        app.dependency_overrides[get_feedback_service] = lambda: (
            feedback if feedback is not None else FakeFeedback()
        )
        if settings is not None:
            app.dependency_overrides[get_settings] = lambda: settings
        return TestClient(app)

    yield _make
    app.dependency_overrides.clear()


def test_health(make_client) -> None:
    response = make_client().get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_analyze_success(make_client) -> None:
    client = make_client()

    response = client.post(
        "/api/analyze",
        data={"question": "Tell me about yourself"},
        files={"audio": VALID_AUDIO},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["transcript"] == "Hello um world"
    assert body["metrics"]["word_count"] == 3
    assert body["metrics"]["filler_word_count"] == 1
    assert body["metrics"]["filler_occurrences"] == [{"text": "um", "start": 0.6, "end": 0.9}]
    assert body["metrics"]["pause_occurrences"] == []
    assert body["feedback"]["overall_assessment"] == "Clear but unfocused."


def test_analyze_returns_pause_occurrences(make_client) -> None:
    words = [Word("Hello", 0.0, 0.5), Word("world", 2.0, 2.5)]
    client = make_client(transcription=FakeTranscription(words=words))

    response = client.post(
        "/api/analyze",
        data={"question": "Tell me about yourself"},
        files={"audio": VALID_AUDIO},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["noticeable_pause_count"] == 1
    assert body["metrics"]["pause_occurrences"] == [
        {"start": 0.5, "end": 2.0, "duration_seconds": 1.5}
    ]


def test_blank_question_is_rejected(make_client) -> None:
    response = make_client().post(
        "/api/analyze",
        data={"question": "   "},
        files={"audio": VALID_AUDIO},
    )

    assert response.status_code == 400


def test_empty_audio_is_rejected(make_client) -> None:
    response = make_client().post(
        "/api/analyze",
        data={"question": "Tell me about yourself"},
        files={"audio": ("recording.webm", b"", "audio/webm")},
    )

    assert response.status_code == 400


def test_unsupported_media_type_is_rejected(make_client) -> None:
    response = make_client().post(
        "/api/analyze",
        data={"question": "Tell me about yourself"},
        files={"audio": ("notes.txt", b"not audio", "text/plain")},
    )

    assert response.status_code == 415


def test_oversized_audio_is_rejected(make_client) -> None:
    client = make_client(settings=Settings(max_audio_bytes=4))

    response = client.post(
        "/api/analyze",
        data={"question": "Tell me about yourself"},
        files={"audio": ("recording.webm", b"too-large", "audio/webm")},
    )

    assert response.status_code == 413


def test_unintelligible_audio_returns_422(make_client) -> None:
    client = make_client(
        transcription=FakeTranscription(
            error=UnintelligibleAudioError("No speech could be detected.")
        )
    )

    response = client.post(
        "/api/analyze",
        data={"question": "Tell me about yourself"},
        files={"audio": VALID_AUDIO},
    )

    assert response.status_code == 422


def test_transcription_failure_returns_502(make_client) -> None:
    client = make_client(transcription=FakeTranscription(error=TranscriptionError("provider down")))

    response = client.post(
        "/api/analyze",
        data={"question": "Tell me about yourself"},
        files={"audio": VALID_AUDIO},
    )

    assert response.status_code == 502


def test_feedback_failure_returns_502(make_client) -> None:
    client = make_client(feedback=FakeFeedback(error=FeedbackError("provider down")))

    response = client.post(
        "/api/analyze",
        data={"question": "Tell me about yourself"},
        files={"audio": VALID_AUDIO},
    )

    assert response.status_code == 502


def test_missing_configuration_returns_500(make_client) -> None:
    client = make_client()
    app.dependency_overrides[get_transcription_service] = lambda: None
    app.dependency_overrides[get_feedback_service] = lambda: None

    response = client.post(
        "/api/analyze",
        data={"question": "Tell me about yourself"},
        files={"audio": VALID_AUDIO},
    )

    assert response.status_code == 500
