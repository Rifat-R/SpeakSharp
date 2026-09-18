"""External service wrappers for ElevenLabs transcription and OpenAI feedback."""

import json
import logging
from dataclasses import dataclass

from elevenlabs.client import ElevenLabs
from elevenlabs.core import ApiError as ElevenLabsApiError
from openai import APIError as OpenAIAPIError
from openai import AsyncOpenAI

from .metrics import Word
from .models import InterviewFeedback, SpeechMetrics

logger = logging.getLogger(__name__)

ENGLISH_LANGUAGE_CODE = "eng"

FEEDBACK_INSTRUCTIONS = """
You are an experienced interview coach reviewing a spoken answer to an
interview question. Evaluate the answer against this rubric:

- Relevance: does it actually answer the question that was asked?
- Structure: is there a clear beginning, middle, and end?
- Specificity: are there concrete examples, details, and results?
- Clarity: is the language direct and easy to follow?
- Conciseness: is it appropriately paced and free of unnecessary filler?

Use the objective speech metrics to inform feedback about pacing and filler
words. Only reference details that appear in the transcript. Never invent
experience, facts, or examples. Prefer specific, actionable coaching over
generic praise.
""".strip()


class TranscriptionError(RuntimeError):
    """Raised when transcription fails or returns unusable output."""


class UnintelligibleAudioError(TranscriptionError):
    """Raised when transcription succeeds but produces no usable words."""


class FeedbackError(RuntimeError):
    """Raised when qualitative feedback cannot be generated."""


@dataclass(frozen=True)
class TranscriptResult:
    text: str
    words: list[Word]
    language_code: str | None = None
    audio_duration_seconds: float | None = None


class TranscriptionService:
    def __init__(self, api_key: str, model_id: str = "scribe_v2") -> None:
        if not api_key:
            raise ValueError("A transcription API key is required.")
        self._client = ElevenLabs(api_key=api_key)
        self._model_id = model_id

    def transcribe(self, filename: str, content: bytes, content_type: str) -> TranscriptResult:
        try:
            response = self._client.speech_to_text.convert(
                model_id=self._model_id,
                file=(filename, content, content_type),
                language_code=ENGLISH_LANGUAGE_CODE,
                timestamps_granularity="word",
                tag_audio_events=False,
            )
        except ElevenLabsApiError as exc:
            logger.warning("ElevenLabs transcription failed: %s", exc)
            raise TranscriptionError("The transcription provider rejected the audio.") from exc

        text = (getattr(response, "text", "") or "").strip()
        words = _extract_words(response)

        if not text and not words:
            raise UnintelligibleAudioError("No speech could be detected in the recording.")

        return TranscriptResult(
            text=text,
            words=words,
            language_code=getattr(response, "language_code", None),
            audio_duration_seconds=getattr(response, "audio_duration_secs", None),
        )


class FeedbackService:
    def __init__(self, api_key: str, model: str = "gpt-4o-mini") -> None:
        if not api_key:
            raise ValueError("An OpenAI API key is required.")
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def generate(
        self, question: str, transcript: str, metrics: SpeechMetrics
    ) -> InterviewFeedback:
        prompt = _build_feedback_prompt(question, transcript, metrics)
        try:
            response = await self._client.responses.parse(
                model=self._model,
                instructions=FEEDBACK_INSTRUCTIONS,
                input=prompt,
                text_format=InterviewFeedback,
            )
        except OpenAIAPIError as exc:
            logger.warning("OpenAI feedback request failed: %s", exc)
            raise FeedbackError("The feedback provider rejected the request.") from exc

        feedback = response.output_parsed
        if feedback is None:
            raise FeedbackError("The feedback provider returned an empty response.")
        return feedback


def _extract_words(response: object) -> list[Word]:
    raw_words = getattr(response, "words", None) or []
    words: list[Word] = []

    for raw_word in raw_words:
        if getattr(raw_word, "type", None) not in (None, "word"):
            continue
        start = getattr(raw_word, "start", None)
        end = getattr(raw_word, "end", None)
        text = getattr(raw_word, "text", None)
        if start is None or end is None or not text:
            continue
        words.append(Word(text=text, start=float(start), end=float(end)))

    return words


def _build_feedback_prompt(question: str, transcript: str, metrics: SpeechMetrics) -> str:
    metrics_json = json.dumps(metrics.model_dump(), indent=2)
    return (
        "Interview question:\n"
        f"{question}\n\n"
        "Verbatim transcript:\n"
        f"{transcript}\n\n"
        "Objective speech metrics:\n"
        f"{metrics_json}\n\n"
        "Provide structured interview feedback for this answer."
    )
