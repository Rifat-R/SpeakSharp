# SpeakSharp

Practice an interview answer out loud, then get a verbatim transcript, objective
speaking metrics, and structured coaching feedback.

The app records up to two minutes of audio in the browser, sends it to a FastAPI
backend, transcribes it with ElevenLabs Scribe, computes transcript-based speech
metrics in Python, and asks OpenAI for qualitative feedback. Nothing is stored:
audio, transcripts, and feedback live only for the duration of a request.

## Tech stack

- **Frontend:** React + TypeScript + Vite, browser `MediaRecorder`
- **Backend:** FastAPI (Python 3.13), managed with [uv](https://docs.astral.sh/uv/)
- **Transcription:** ElevenLabs Scribe (`scribe_v2`) with word timestamps
- **Objective metrics:** Python, derived from transcript timestamps
- **Qualitative feedback:** OpenAI Responses API with structured output
- **Database:** none

## Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/)
- Node.js 20+ and npm
- An ElevenLabs API key and an OpenAI API key

## Setup

### 1. Environment

```sh
cp .env.example .env
```

Fill in the values:

| Variable             | Required | Description                                      |
| -------------------- | -------- | ------------------------------------------------ |
| `ELEVENLAB_API_KEY`  | Yes      | ElevenLabs API key used for transcription        |
| `OPENAI_API_KEY`     | Yes      | OpenAI API key used for feedback                 |
| `OPENAI_MODEL`       | No       | Feedback model, defaults to `gpt-4o-mini`        |
| `TRANSCRIPTION_MODEL`| No       | ElevenLabs model, defaults to `scribe_v2`        |
| `CORS_ORIGINS`       | No       | Comma-separated allowed origins                  |
| `MAX_AUDIO_BYTES`    | No       | Upload limit, defaults to 25 MB                  |
| `PAUSE_THRESHOLD_SECONDS` | No  | Pause length counted as noticeable, default 1.0  |

### 2. Backend

```sh
uv sync
uv run uvicorn backend.app.main:app --reload
```

The API runs at `http://localhost:8000` (interactive docs at `/docs`).

### 3. Frontend

```sh
cd frontend
npm install
npm run dev
```

The app runs at `http://localhost:5173`. To point at a different backend, set
`VITE_API_URL` in `frontend/.env`.

## Usage

1. Choose one of the preset interview questions or enter a custom one.
2. Click **Start recording** and grant microphone access.
3. Answer for up to two minutes. Recording stops automatically at the limit.
4. Review the playback, then click **Analyze answer**.
5. Read your metrics and feedback, or record another answer.

## API

| Method | Path           | Description                                      |
| ------ | -------------- | ------------------------------------------------ |
| `GET`  | `/api/health`  | Health check                                     |
| `POST` | `/api/analyze` | Multipart upload of `question` and `audio`       |

`POST /api/analyze` returns the transcript, objective metrics, and structured
feedback.

## Metrics

All metrics are computed from word-level transcript timestamps. No acoustic
analysis is performed.

- **Duration** – spoken span from the first to the last word, so leading and
  trailing silence is excluded.
- **Word count** and **words per minute** – pace of speech.
- **Filler words** – occurrences of a fixed English filler list (`um`, `uh`,
  `erm`, `hmm`, `er`, `ah`, `like`, `basically`, `actually`, `you know`,
  `I mean`), plus a per-minute rate and a per-word breakdown.
- **Noticeable pauses** – gaps between consecutive words that meet the
  `PAUSE_THRESHOLD_SECONDS` threshold, with average and longest duration.

Filler detection is deliberate but imperfect: words like "like" are sometimes
used meaningfully and will still be counted. Treat the metrics as guidance, not
a grade.

## Development

Backend:

```sh
uv run pytest          # tests
uv run ruff check .    # lint
uv run ruff format .   # format
```

Frontend:

```sh
cd frontend
npm run lint           # lint
npm run build          # type check + production build
```

## Limitations

- English only.
- One speaker; multi-speaker audio is out of scope.
- No intonation, pitch, volume, or sentiment analysis yet.
- No accounts, history, or saved recordings.
- Feedback is generated from the transcript and metrics only. The model is
  instructed not to invent details that are not in the transcript.
