# SpeakSharp

Practice an interview answer out loud, then get a verbatim transcript, objective
speaking metrics, and structured coaching feedback.

The app records up to two minutes of audio in the browser, sends it to a FastAPI
backend, transcribes it with ElevenLabs Scribe, computes transcript-based speech
metrics in Python, and asks OpenAI for qualitative feedback. Nothing is stored:
audio, transcripts, and feedback live only for the duration of a request.

## Tech stack

- **Frontend:** React + TypeScript + Vite, browser `MediaRecorder`,
  [WaveSurfer.js](https://wavesurfer.xyz/) for playback
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
| `APP_ENV`            | No       | `development` (default) or `production`          |
| `DEMO_PASSWORD`      | Prod     | Enables analysis authentication when set         |
| `SESSION_SECRET`     | Prod     | Signs the session cookie; 32+ characters         |
| `SESSION_MAX_AGE_SECONDS` | No  | Session lifetime, defaults to 86400 (24 hours)   |
| `SESSION_HTTPS_ONLY` | Prod     | Send the cookie only over HTTPS, defaults false  |
| `CORS_ORIGINS`       | No       | Comma-separated allowed origins                  |
| `MAX_AUDIO_BYTES`    | No       | Upload limit, defaults to 25 MB                  |
| `PAUSE_THRESHOLD_SECONDS` | No  | Pause length counted as noticeable, default 1.0  |

For local development this file may be copied as-is: `scripts/dev.sh` forces
`APP_ENV=development`, and analysis authentication stays disabled while
`DEMO_PASSWORD` is empty. Production refuses to start without a demo password
and a strong session secret.

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

### Run both together

Start the backend and frontend with one command:

```sh
./scripts/dev.sh
```

This serves the API at `http://localhost:8000` and the app at
`http://localhost:5173`, and stops both when you press `Ctrl+C`. Override the
ports if needed, for example `BACKEND_PORT=9000 FRONTEND_PORT=3000
./scripts/dev.sh`; the script also sets `CORS_ORIGINS` to match the frontend
port.

## Usage

1. Choose one of the preset interview questions or enter a custom one.
2. Click **Start recording** and grant microphone access.
3. Answer for up to two minutes. Recording stops automatically at the limit.
4. Review the playback, then click **Analyze answer**.
5. If the demo prompts for a password, enter it to start the analysis.
6. Read your metrics and feedback, or record another answer.

## API

| Method | Path                 | Description                                      |
| ------ | -------------------- | ------------------------------------------------ |
| `GET`  | `/api/health`        | Health check                                     |
| `POST` | `/api/auth/login`    | Demo password check; sets the session cookie     |
| `POST` | `/api/analyze`       | Multipart upload of `question` and `audio`       |

`POST /api/analyze` returns the transcript, objective metrics, and structured
feedback. When `DEMO_PASSWORD` is set, it requires a valid session cookie;
anonymous requests receive `401` before either provider is called.

## Demo authentication

The public demo keeps the whole practice experience open, but the paid
analysis step requires a password:

1. Recording, playback, and question selection work without signing in.
2. If Analyze returns `401`, a small dialog asks for the demo password.
3. A correct password creates a signed, `HttpOnly` session cookie and the
   pending analysis is retried once.
4. An incorrect password leaves the dialog open; repeated failures are
   throttled by client IP.

There is no login page, startup session check, or logout button. The cookie
holds only an `authenticated` boolean and expires after
`SESSION_MAX_AGE_SECONDS`. Generate the production secret with:

```sh
openssl rand -hex 32
```

To remove demo authentication later, delete the auth dependency from
`POST /api/analyze`, remove `backend/app/auth.py`, the `PasswordDialog`
component, the `401` retry branch in `frontend/src/App.tsx`, and the auth
settings. Docker, Caddy, and the normal analysis path do not need to change.

## Metrics

All metrics are computed from word-level transcript timestamps. No acoustic
analysis is performed.

- **Duration** – spoken span from the first to the last word, so leading and
  trailing silence is excluded.
- **Word count** and **words per minute** – pace of speech.
- **Filler words** – occurrences of a fixed English filler list (`um`, `uh`,
  `erm`, `hmm`, `er`, `ah`, `like`, `basically`, `actually`, `you know`,
  `I mean`), plus a per-minute rate and a per-word breakdown. Each occurrence
  carries its `start`/`end` time on the audio timeline.
- **Noticeable pauses** – gaps between consecutive words that meet the
  `PAUSE_THRESHOLD_SECONDS` threshold, with average and longest duration and
  each pause's `start`/`end` time.

The results screen renders the recording as a waveform. Filler words and
noticeable pauses appear as marker regions, and the "Filler moments" and
"Pauses" chips seek playback to that point. Timestamps are relative to the
start of the recording, so they line up with the waveform.

Filler detection is deliberate but imperfect: words like "like" are sometimes
used meaningfully and will still be counted. Treat the metrics as guidance, not
a grade.

## Deployment (Docker + Caddy)

The repository ships a two-container Compose stack for
`https://speakbetter.duckdns.org`:

- `web`: Caddy serving the built Vite frontend and proxying `/api/*` to the API
- `api`: FastAPI on one Uvicorn worker, reachable only on the Compose network

Caddy terminates HTTPS, obtains and renews certificates automatically, and is
the only service that publishes host ports.

### Prepare the VPS

1. Install a supported Ubuntu LTS image.
2. Create a non-root deployment user with sudo access.
3. Add an SSH public key and confirm a second key-authenticated session works.
4. Disable root SSH login and password authentication.
5. Install Docker Engine and the Compose plugin from Docker's official
   repository, then enable Docker at boot.
6. Allow only SSH, HTTP, and HTTPS through UFW and the OVH network firewall.
7. Confirm `speakbetter.duckdns.org` resolves to the server from a public
   resolver. Ports 80 and 443 must be reachable for the ACME HTTP challenge.
8. Clone the repository and create the production environment:

   ```sh
   cp .env.example .env
   openssl rand -hex 32            # paste into SESSION_SECRET
   chmod 600 .env
   ```

9. Build and start:

   ```sh
   docker compose up -d --build
   ```

10. Check status and logs, then confirm Caddy obtained a certificate before
    adding HSTS:

    ```sh
    docker compose ps
    docker compose logs --tail=100 web api
    ```

### Update

```sh
git pull --ff-only
docker compose build
docker compose up -d
docker image prune
```

Keep at least the previous known-good revision. To roll back, check out that
revision, rebuild, and run `docker compose up -d`.

### Operations

- Follow logs: `docker compose logs -f web api`
- Container health: `docker compose ps`
- Restart one service: `docker compose restart api` (or `web`)
- Back up `.env` securely outside the repository.
- Keep the `caddy_data` volume during upgrades so certificates survive.
- Rotating `SESSION_SECRET` signs everyone out. Changing `DEMO_PASSWORD`
  affects the next login. Rotate provider keys in the same `.env` and restart.
- Set provider-side usage limits and billing alerts.
- Never log uploaded audio, transcripts, cookies, or credentials.

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
- Demo authentication is a single shared password, not user accounts.
- Feedback is generated from the transcript and metrics only. The model is
  instructed not to invent details that are not in the transcript.
