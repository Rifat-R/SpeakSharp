# OVH Docker + Caddy Deployment With Analysis-Time Password Prompt

## Goal

Deploy SpeakSharp at `https://speakbetter.duckdns.org` on the OVH VPS at
`45.147.32.68` using Docker Compose, Caddy, and one Uvicorn worker.

Keep authentication intentionally small:

- The application remains visible and usable without signing in.
- A password dialog appears only when an unauthenticated user tries to analyze
  a recording.
- A successful password check creates a signed session cookie and immediately
  retries the analysis.
- The password is never sent with the audio request or stored in browser
  storage.
- Authentication remains isolated so it can be removed after the public demo.

The paid ElevenLabs/OpenAI-backed analysis endpoint must still reject anonymous
requests before either provider is called.

## Architecture

```text
Browser
  |
  | HTTPS
  v
Caddy container :80/:443
  |-- /*       -> Vite static build
  |-- /api/*   -> api:8000
  v
FastAPI + Uvicorn container
  |-- signed demo session
  |-- ElevenLabs
  +-- OpenAI
```

Only Caddy publishes host ports. FastAPI remains reachable only through the
Docker Compose network.

## Password Flow

1. The user records an answer and clicks **Analyze answer**.
2. The frontend sends the normal `POST /api/analyze` request with cookies.
3. If an existing session is valid, analysis proceeds normally.
4. If the API returns `401`, the frontend opens a small password dialog while
   retaining the recording and selected question.
5. The dialog sends the password to `POST /api/auth/login`.
6. A successful login creates a signed `HttpOnly` session cookie.
7. The dialog closes and the frontend retries the original analysis once.
8. An incorrect password leaves the dialog open and shows a generic error.
9. A network error leaves the recording intact and allows another attempt.

There is no login page, startup session check, authentication gate, or logout
UI. The session expires automatically according to `SESSION_MAX_AGE_SECONDS`.
Closing or refreshing the page does not expose or persist the password.

## Backend Authentication

### Configuration

Add these settings to `backend/app/config.py`:

- `APP_ENV`, default `development`
- `DEMO_PASSWORD`, empty by default
- `SESSION_SECRET`, empty by default
- `SESSION_MAX_AGE_SECONDS`, default `86400`
- `SESSION_HTTPS_ONLY`, default `false`

Behavior:

- Authentication is disabled in development when `DEMO_PASSWORD` is empty.
- Authentication is enabled whenever `DEMO_PASSWORD` is set.
- `APP_ENV=production` must reject an empty `DEMO_PASSWORD`.
- `APP_ENV=production` must reject a missing or short `SESSION_SECRET`.
- Production uses a secure cookie; local HTTP development does not.

Generate the production secret with:

```sh
openssl rand -hex 32
```

### Session

Use Starlette `SessionMiddleware` with:

- Cookie name `speaksharp_session`
- `HttpOnly`
- `Secure` in production
- `SameSite=Lax`
- Path `/`
- Configurable maximum age, defaulting to 24 hours

The cookie contains only an `authenticated` boolean. It must not contain the
password, API keys, audio, transcripts, or feedback.

### API

Keep only the authentication endpoint needed by the dialog:

- `POST /api/auth/login`
  - Accepts `{ "password": "..." }`.
  - Uses `secrets.compare_digest`.
  - Creates the session on success.
  - Returns the same generic `401` error for every incorrect password.

Protect `POST /api/analyze` with a reusable authentication dependency.
Unauthenticated, expired, or tampered sessions receive `401` before provider
services run. Keep `GET /api/health` public.

Do not add `/api/auth/status` or `/api/auth/logout`; neither is needed for this
interaction.

### Login Throttling

Keep a process-local failed-login limiter because production uses one Uvicorn
worker:

- Five failures per client IP in five minutes.
- Return `429` with `Retry-After` when limited.
- Clear failures after a successful login.
- Trust forwarded client information only because the API port is private and
  Caddy is the sole upstream.

Replace the limiter with shared or edge-level state before adding workers or
replicas.

## Frontend Changes

### API Client

Update `frontend/src/api.ts` to:

- Use `http://localhost:8000` by default in Vite development.
- Use same-origin relative URLs in production.
- Send `credentials: 'include'` on login and analysis requests.
- Preserve response status in `ApiError`.
- Expose a single `login(password)` function.

### Password Dialog

Add `PasswordDialog.tsx` as a focused modal/dialog rather than a page:

- Open it only after an analysis request returns `401`.
- Use the native `<dialog>` element if it works cleanly with the existing
  browser targets; otherwise use an accessible fixed overlay.
- Include a visible password label.
- Use `type="password"` and `autocomplete="current-password"`.
- Support Enter to submit and Escape to cancel.
- Trap focus while open and return focus to the Analyze button when closed.
- Show submitting, invalid-password, throttled, and network-error states.
- Do not render a username field.
- Do not store or log the password.

### Analysis Retry

Keep the retry logic local to the analysis flow in `App.tsx`:

- Retain the current recording and question when `401` occurs.
- Open the dialog instead of changing the application screen.
- After successful login, retry the pending analysis exactly once.
- If the retry still returns `401`, reopen the dialog rather than looping.
- Preserve existing handling for validation and provider errors.
- Disable duplicate analysis submissions while login or analysis is pending.

Do not add `AuthGate`, `LoginScreen`, initial session checks, or logout controls.

## Removing Authentication Later

Keep removal mechanical and isolated:

1. Remove the authentication dependency from `POST /api/analyze`.
2. Remove the auth router, session middleware, limiter, and auth settings.
3. Remove `PasswordDialog.tsx` and the `401` retry branch from `App.tsx`.
4. Remove `login()` and auth-specific code from `frontend/src/api.ts`.
5. Remove `DEMO_PASSWORD`, `SESSION_SECRET`, and session settings from `.env`.
6. Remove the `itsdangerous` dependency if nothing else uses it.
7. Delete authentication-specific tests.

Dockerfiles, Caddy, Compose, provider configuration, health checks, and the
normal analysis path should require no changes.

## Backend Image

Add `Dockerfile.backend`:

- Pin a Python 3.13 slim image.
- Copy the pinned `uv` binary from a pinned official image.
- Copy `pyproject.toml`, `uv.lock`, and metadata before source files.
- Run `uv sync --frozen --no-dev`.
- Copy the backend package.
- Run as a non-root user.
- Put `.venv/bin` on `PATH`.
- Do not include `.env`, frontend dependencies, caches, or Git metadata.

Run:

```sh
uvicorn backend.app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1 \
  --proxy-headers \
  --forwarded-allow-ips="*"
```

Use a Python standard-library health check against
`http://127.0.0.1:8000/api/health`. Provide a bounded writable `/tmp` large
enough for one 25 MB multipart upload plus overhead.

## Frontend and Caddy Image

Add `Dockerfile.frontend` as a multi-stage image:

- Build with a pinned Node Alpine image supported by the current Vite version.
- Copy `package.json` and `package-lock.json`, then run `npm ci`.
- Copy frontend source and run `npm run build`.
- Use a pinned Caddy Alpine runtime image.
- Copy only `frontend/dist` to `/srv` and `Caddyfile` to
  `/etc/caddy/Caddyfile`.
- Do not ship Node.js, frontend source, or development dependencies.

## Caddy

Add a `Caddyfile` for `speakbetter.duckdns.org` that:

- Enables automatic HTTPS and HTTP-to-HTTPS redirects.
- Compresses responses with gzip and Zstandard.
- Proxies `/api/*` to `api:8000` without stripping `/api`.
- Serves `/srv` with SPA fallback through `/index.html`.
- Rejects request bodies above approximately 30 MB.
- Adds `X-Content-Type-Options: nosniff`.
- Adds `X-Frame-Options: DENY`.
- Adds a conservative `Referrer-Policy`.
- Adds `Permissions-Policy: microphone=(self)`.
- Emits container-friendly access logs without request bodies or cookies.

Add HSTS only after HTTPS has been verified. Any future CSP must allow the blob
audio URLs used for browser recordings and playback.

## Docker Compose

Add `compose.yaml` with `web` and `api` services on a dedicated network.

### `web`

- Build from `Dockerfile.frontend`.
- Publish `80:80` and `443:443`.
- Persist `/data` and `/config` in named volumes.
- Use `restart: unless-stopped`.
- Depend on a healthy API.

### `api`

- Build from `Dockerfile.backend`.
- Load `.env`.
- Use `expose: 8000`, never a host port mapping.
- Use `restart: unless-stopped`.
- Add the `/api/health` health check.
- Mount a bounded temporary filesystem at `/tmp`.

Add conservative CPU and memory limits suitable for the VPS while leaving
capacity for the OS and Docker daemon.

## Secrets and Ignore Rules

Add `.dockerignore` entries for:

- `.git`
- `.env` and secret-bearing variants
- `.venv`
- `node_modules`
- `dist`
- Python, pytest, Ruff, and frontend caches
- editor and local artifacts

Expand `.env.example` without secret values:

```dotenv
APP_ENV=production
ELEVENLAB_API_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
DEMO_PASSWORD=
SESSION_SECRET=
SESSION_MAX_AGE_SECONDS=86400
SESSION_HTTPS_ONLY=true
CORS_ORIGINS=https://speakbetter.duckdns.org
```

On the VPS, set `chmod 600 .env`. No `VITE_*` variable may contain a secret.

## Tests

### Backend

Cover:

1. `/api/health` remains public.
2. Development without `DEMO_PASSWORD` can analyze without authentication.
3. Production rejects missing passwords and weak session secrets.
4. Anonymous production-style analysis returns `401` before providers run.
5. Incorrect passwords return a generic `401`.
6. Correct passwords create a usable session.
7. Authenticated analysis succeeds.
8. Tampered cookies are rejected.
9. Five failed logins cause `429` with `Retry-After`.
10. Limiter state is reset between tests.

### Frontend

Do not add a test framework only for this feature. Verify through type checking,
linting, a production build, and focused browser checks:

- Normal app content is visible before authentication.
- The dialog opens only after Analyze receives `401`.
- Canceling preserves the recording.
- Incorrect passwords do not start analysis.
- Correct passwords close the dialog and retry once.
- Refreshing does not expose the password.

## Verification

Run:

```sh
uv run pytest
uv run ruff check .
uv run ruff format --check .
npm --prefix frontend run lint
npm --prefix frontend run build
docker compose config
docker compose build
```

Then validate the Caddy configuration from the built image, start the stack,
and check both container health statuses.

## Documentation

Update `README.md` with:

- Local development behavior with authentication disabled by default.
- Production environment variables.
- Docker Compose build and startup commands.
- OVH firewall and SSH-hardening steps.
- Deployment, update, rollback, logs, and health-check commands.
- Secret rotation and provider spending limits.
- A short section explaining how to remove demo authentication.

## Implementation Order

1. Reconcile the partial authentication work already in the workspace: retain
   the isolated backend session protection, remove the full-page frontend gate,
   and remove unused status/logout routes.
2. Complete backend validation, login throttling, and focused tests.
3. Add `PasswordDialog.tsx` and the one-time analysis retry flow.
4. Verify the normal application remains visible and local development remains
   usable without a password.
5. Add backend and frontend production images.
6. Add Caddy and Compose configuration.
7. Add ignore rules and production environment examples.
8. Run all application and container checks.
9. Document deployment, operations, and authentication removal.
10. Deploy to the VPS and run the manual acceptance checks.

## Acceptance Checks

1. HTTP redirects to HTTPS and the certificate is valid.
2. The full practice UI is visible without signing in.
3. Recording and playback work before authentication.
4. Clicking Analyze without a session opens the password dialog.
5. A direct anonymous `/api/analyze` request receives `401`.
6. Incorrect passwords show a generic error and repeated failures are limited.
7. The correct password closes the dialog and analysis proceeds automatically.
8. Canceling the dialog preserves the recording.
9. A valid session avoids repeated prompts until it expires.
10. `/api/health` remains public and returns `{ "status": "ok" }`.
11. Port 8000 is not publicly reachable.
12. Audio, transcripts, and feedback are not persisted server-side.
13. Rebooting the VPS restarts both containers and retains Caddy certificates.

## Completion Criteria

- The app is served from one HTTPS origin by Caddy.
- Authentication does not block browsing, recording, or playback.
- Paid analysis is inaccessible without a valid signed session.
- The password dialog is small, accessible, and localized to the Analyze flow.
- Authentication can be removed without modifying Docker or deployment files.
- FastAPI runs non-root with one private Uvicorn worker.
- No secrets are committed, embedded in frontend assets, or logged.
- Backend tests, Python checks, frontend lint/build, Compose validation, image
  builds, health checks, and manual acceptance checks pass.
