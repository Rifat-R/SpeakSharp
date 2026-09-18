"""FastAPI application for SpeakSharp.

Accepts a recorded answer, transcribes it with ElevenLabs Scribe, computes
objective speech metrics, and returns structured OpenAI interview feedback.
No audio or results are persisted.
"""

import logging
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from starlette.middleware.sessions import SessionMiddleware

from .auth import (
    SESSION_COOKIE_NAME,
    LoginRateLimiter,
    require_auth,
    session_secret,
)
from .auth import (
    router as auth_router,
)
from .config import Settings, get_settings
from .metrics import compute_metrics
from .models import AnalysisResponse, HealthResponse, SpeechMetrics
from .services import (
    FeedbackError,
    FeedbackService,
    TranscriptionError,
    TranscriptionService,
    UnintelligibleAudioError,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.transcription = (
        TranscriptionService(
            api_key=settings.elevenlab_api_key,
            model_id=settings.transcription_model,
        )
        if settings.elevenlab_api_key
        else None
    )
    app.state.feedback = (
        FeedbackService(api_key=settings.openai_api_key, model=settings.openai_model)
        if settings.openai_api_key
        else None
    )
    app.state.login_limiter = LoginRateLimiter()
    yield


app = FastAPI(title="SpeakSharp API", version="0.1.0", lifespan=lifespan)

_app_settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=_app_settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    SessionMiddleware,
    secret_key=session_secret(_app_settings),
    session_cookie=SESSION_COOKIE_NAME,
    max_age=_app_settings.session_max_age_seconds,
    same_site="lax",
    https_only=_app_settings.session_https_only,
)

app.include_router(auth_router)


def get_transcription_service(request: Request) -> TranscriptionService | None:
    return getattr(request.app.state, "transcription", None)


def get_feedback_service(request: Request) -> FeedbackService | None:
    return getattr(request.app.state, "feedback", None)


ALLOWED_AUDIO_PREFIXES = ("audio/",)
ALLOWED_VIDEO_TYPES = frozenset({"video/webm", "video/mp4", "video/ogg"})
ALLOWED_EXTENSIONS = frozenset(
    {".webm", ".ogg", ".mp3", ".mp4", ".m4a", ".wav", ".flac", ".aac", ".opus"}
)


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/api/analyze", response_model=AnalysisResponse)
async def analyze(
    question: Annotated[str, Form()],
    audio: Annotated[UploadFile, File()],
    settings: Annotated[Settings, Depends(get_settings)],
    transcription: Annotated[TranscriptionService | None, Depends(get_transcription_service)],
    feedback: Annotated[FeedbackService | None, Depends(get_feedback_service)],
    _: Annotated[None, Depends(require_auth)] = None,
) -> AnalysisResponse:
    if transcription is None or feedback is None:
        raise HTTPException(
            status_code=500,
            detail="The analysis service is not configured on the server.",
        )

    clean_question = question.strip()
    if not clean_question:
        raise HTTPException(status_code=400, detail="An interview question is required.")
    if len(clean_question) > settings.max_question_length:
        raise HTTPException(
            status_code=400,
            detail=f"The question must be {settings.max_question_length} characters or fewer.",
        )

    if not _is_supported_audio(audio.content_type, audio.filename):
        raise HTTPException(
            status_code=415,
            detail="Unsupported audio format. Please record in the browser.",
        )

    content = await audio.read()
    await audio.close()

    if not content:
        raise HTTPException(status_code=400, detail="The recording is empty.")
    if len(content) > settings.max_audio_bytes:
        raise HTTPException(
            status_code=413,
            detail="The recording is too large to analyze.",
        )

    filename = audio.filename or "recording.webm"
    content_type = audio.content_type or "application/octet-stream"

    try:
        transcript = await run_in_threadpool(
            transcription.transcribe, filename, content, content_type
        )
    except UnintelligibleAudioError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except TranscriptionError as exc:
        raise HTTPException(
            status_code=502,
            detail="We could not transcribe the recording. Please try again.",
        ) from exc

    metrics_payload = compute_metrics(transcript.words, settings.pause_threshold_seconds)
    metrics = SpeechMetrics(**metrics_payload)

    try:
        interview_feedback = await feedback.generate(clean_question, transcript.text, metrics)
    except FeedbackError as exc:
        logger.warning("Feedback generation failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="We could not generate feedback. Please try again.",
        ) from exc

    return AnalysisResponse(
        transcript=transcript.text,
        metrics=metrics,
        feedback=interview_feedback,
    )


def _is_supported_audio(content_type: str | None, filename: str | None) -> bool:
    normalized_type = (content_type or "").split(";")[0].strip().lower()
    if normalized_type.startswith(ALLOWED_AUDIO_PREFIXES):
        return True
    if normalized_type in ALLOWED_VIDEO_TYPES:
        return True
    if normalized_type in ("", "application/octet-stream"):
        extension = (
            "." + filename.rsplit(".", 1)[-1].lower() if filename and "." in filename else ""
        )
        return extension in ALLOWED_EXTENSIONS
    return False
