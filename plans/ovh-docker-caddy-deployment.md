# OVH Docker + Caddy Deployment Plan

## Goal

Deploy SpeakSharp at `https://speakbetter.duckdns.org` on the OVH VPS at
`45.147.32.68` using:

- Caddy for automatic HTTPS, static frontend hosting, and reverse proxying
- Uvicorn with one worker for the FastAPI backend
- Docker Compose for build and runtime orchestration
- Password-only demo authentication backed by a signed session cookie
- No database or persistent application data

The deployment should remain small and understandable while providing a secure
public demo that does not expose the OpenAI or ElevenLabs-backed analysis
endpoint to anonymous use.

The DuckDNS hostname already resolves to the intended server IP:

```text
speakbetter.duckdns.org -> 45.147.32.68
```

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
  |-- ElevenLabs
  +-- OpenAI
```

Only Caddy will publish host ports. FastAPI will be reachable only through the
Docker Compose network.

## Technical Decisions

- Use separate runtime containers for the web edge and Python API.
- Build the Vite frontend in a Node build stage, then copy only `dist` into the
  Caddy runtime image. Node.js will not run in production.
- Keep the frontend and API on one public origin. Production frontend requests
  will use relative `/api` URLs, eliminating production CORS complexity.
- Start with one Uvicorn worker. Demo traffic is expected to be low, and limiting
  backend concurrency also limits accidental provider spend.
- Use Starlette `SessionMiddleware` for a signed, stateless session cookie. No
  session database is needed.
- Load production secrets from a root-owned, mode-`600` `.env` file on the VPS.
  This is adequate for a single-host Docker Compose deployment; a managed secret
  store can replace it later without changing the application design.
- Persist only Caddy's `/data` and `/config` directories so certificate state
  survives container recreation. Audio, transcripts, and feedback remain
  ephemeral.

## Authentication

### Backend configuration

Extend `backend/app/config.py` with:

- `APP_ENV`, defaulting to `development`
- `DEMO_PASSWORD`
- `SESSION_SECRET`
- `SESSION_MAX_AGE_SECONDS`, defaulting to `86400` (24 hours)
- `SESSION_HTTPS_ONLY`, false for local HTTP development and true in production

Production configuration must fail closed: when `APP_ENV=production`, startup
must reject a missing or empty demo password or session secret. Development may
use explicit development defaults or disable the auth gate so the existing
two-server workflow remains usable.

Generate the production session secret with at least 32 random bytes, for
example:

```sh
openssl rand -hex 32
```

### Session behavior

Add Starlette `SessionMiddleware` with:

- Cookie name `speaksharp_session`
- `HttpOnly` enabled by the middleware
- `Secure` enabled in production
- `SameSite=Lax`
- Path `/`
- A 24-hour maximum age by default

The signed cookie will contain only minimal authentication state, such as an
`authenticated` boolean. It must not contain the password, provider keys,
transcripts, or other sensitive data. Signed Starlette session cookies are
readable by the browser but cannot be modified without invalidating the
signature.

### Authentication API

Add typed request and response models and these endpoints:

- `GET /api/auth/status`
  - Returns whether the current session is authenticated.
- `POST /api/auth/login`
  - Accepts a JSON body containing only `password`.
  - Compares the submitted value with `DEMO_PASSWORD` using
    `secrets.compare_digest`.
  - Establishes the signed session after a successful comparison.
  - Returns the same generic error for all failed attempts.
- `POST /api/auth/logout`
  - Clears the current session.

Add a reusable authentication dependency to `POST /api/analyze`. Anonymous,
expired, or tampered sessions receive `401`. Keep `GET /api/health` public for
Docker and external health checks.

### Login throttling

Add a small in-memory failed-login limiter keyed by the effective client IP:

- Limit repeated failures within a short rolling window, such as five failures
  in five minutes.
- Return `429` and `Retry-After` when the limit is exceeded.
- Clear or relax the failure record after successful authentication.
- Keep the implementation process-local, which is appropriate while the
  deployment uses one Uvicorn worker.

Caddy supplies forwarding headers and Uvicorn will be configured to trust them.
This is safe because the API port is not published and only Caddy can reach it
through the Compose network. Revisit the limiter before increasing the worker
count or adding backend replicas because process-local state will no longer be
shared.

## Frontend Authentication Flow

### API client

Extend `frontend/src/api.ts` to:

- Use `http://localhost:8000` by default during Vite development.
- Use an empty base URL in production so requests target the current origin.
- Send `credentials: 'include'` for status, login, logout, and analysis calls.
- Expose functions for authentication status, login, and logout.
- Preserve HTTP status information in `ApiError` so a `401` analysis response can
  return the application to the login screen.

### Authentication gate

Add an `AuthGate` component that owns these states:

- Checking the existing session
- Unauthenticated
- Submitting a password
- Authenticated
- Authentication error

On initial load, call `/api/auth/status`. Render the existing application only
after authentication succeeds. Network errors should show a retry action rather
than incorrectly presenting them as invalid-password errors.

### Password screen

Add a password-only login screen that follows the existing dark, mint-accented
visual language and remains usable on desktop and mobile.

- Do not render or request a username.
- Use `type="password"` and `autocomplete="current-password"`.
- Provide a visible label, keyboard submission, loading state, and accessible
  error message.
- Do not store the password in local storage, session storage, URL parameters,
  or application logs.

Add a logout action to the authenticated header. Logging out should unmount the
practice application so active media tracks and object URLs are cleaned up. If
an analysis call receives `401`, clear the authenticated frontend state and
return to the password screen.

## Backend Image

Add `Dockerfile.backend` using a pinned Python 3.13 slim base and a pinned `uv`
binary/image.

Build requirements:

1. Set `/app` as the working directory.
2. Copy `pyproject.toml`, `uv.lock`, and any metadata required by `uv` before the
   application source to maximize dependency-layer caching.
3. Run `uv sync --frozen --no-dev` so production uses the committed lockfile and
   excludes development tools.
4. Copy the backend package.
5. Create and use a non-root runtime user.
6. Put the project virtual environment on `PATH`.
7. Avoid copying `.env`, frontend dependencies, caches, and repository metadata.

Start the service with:

```sh
uvicorn backend.app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1 \
  --proxy-headers \
  --forwarded-allow-ips="*"
```

Use a Python standard-library health check against
`http://127.0.0.1:8000/api/health` so the production image does not need `curl`
or the development-only `httpx` dependency.

Provide writable temporary space for Starlette's multipart upload spooling, but
do not mount persistent application storage. Size temporary storage to permit at
least one upload at the configured 25 MB application limit plus multipart
overhead.

## Frontend and Caddy Image

Add `Dockerfile.frontend` as a multi-stage image:

### Build stage

- Use a pinned Node Alpine image supported by the current Vite version.
- Copy `frontend/package.json` and `frontend/package-lock.json` first.
- Run `npm ci`.
- Copy the frontend source and configuration.
- Run `npm run build`.

### Runtime stage

- Use a pinned official Caddy Alpine image.
- Copy the built `frontend/dist` directory into `/srv`.
- Copy the production `Caddyfile` to `/etc/caddy/Caddyfile`.
- Do not include Node.js, source maps unless deliberately enabled, development
  dependencies, or frontend source in the final image.

## Caddy Configuration

Add a `Caddyfile` for `speakbetter.duckdns.org` that:

- Enables automatic HTTPS and HTTP-to-HTTPS redirects.
- Enables gzip and Zstandard response compression.
- Routes `/api/*` to `api:8000` without stripping the `/api` prefix.
- Serves files from `/srv` for all non-API routes.
- Uses `try_files {path} /index.html` before `file_server` for Vite SPA fallback.
- Rejects request bodies above approximately 30 MB. This leaves room for
  multipart framing while remaining close to FastAPI's 25 MB audio limit.
- Adds appropriate headers, including:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - A conservative `Referrer-Policy`
  - `Permissions-Policy: microphone=(self)`
- Emits container-friendly access logs without logging request bodies,
  passwords, cookies, transcripts, or authorization data.

Add stricter headers such as HSTS only after the HTTPS deployment has been
verified. Any future Content Security Policy must explicitly account for blob
audio URLs used by browser recordings and WaveSurfer playback.

## Docker Compose

Add `compose.yaml` with `web` and `api` services.

### `web`

- Build from `Dockerfile.frontend`.
- Publish `80:80` and `443:443`.
- Mount named volumes at `/data` and `/config` for Caddy certificate state.
- Use `restart: unless-stopped`.
- Depend on a healthy API service.

### `api`

- Build from `Dockerfile.backend`.
- Load production configuration from `.env`.
- Use `expose: 8000`, not a host `ports` mapping.
- Use `restart: unless-stopped`.
- Include the `/api/health` health check.
- Provide a bounded temporary filesystem for `/tmp` if multipart handling needs
  disk spooling.

Both services should share a dedicated Compose network. Only the Caddy service
needs published ports. Add conservative memory and CPU limits that leave enough
capacity for the OS and Docker daemon on the OVH VPS.

## Repository and Secret Safety

Add `.dockerignore` entries for:

- `.git`
- `.env` and environment variants containing secrets
- `.venv`
- `node_modules`
- local `dist`
- Python, pytest, Ruff, and frontend caches
- editor files and unrelated local artifacts

Expand `.env.example` with the deployment configuration while leaving all
secret values empty. Ensure the real `.env` remains ignored. On the VPS:

```sh
chmod 600 .env
```

The production `.env` will contain at least:

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

No `VITE_*` variable may contain a secret because Vite embeds those values into
the public browser bundle.

## Automated Tests

### Authentication API

Extend backend API coverage with these cases:

1. `/api/health` remains public.
2. Anonymous `/api/analyze` returns `401` before provider services are called.
3. An incorrect password returns a generic `401` response.
4. A correct password creates an authenticated session.
5. An authenticated client can call `/api/analyze`.
6. Logout clears the session and subsequent analysis returns `401`.
7. A tampered session cookie is rejected.
8. Repeated failed logins return `429` and a `Retry-After` header.
9. Authentication-disabled development behavior, if retained, is explicit and
   tested.

Update existing `test_api.py` fixtures so analysis tests authenticate first or
override the authentication dependency deliberately. Tests should not become
order-dependent through shared limiter state.

### Configuration

Add tests confirming that:

- Production rejects missing `DEMO_PASSWORD`.
- Production rejects missing or weak/empty `SESSION_SECRET`.
- Session expiry and secure-cookie settings parse correctly.
- Existing CORS origin parsing continues to work.

### Frontend and containers

The repository has no frontend unit-test harness, so avoid adding one solely for
this deployment unless authentication behavior becomes complex enough to
justify it. Verify frontend correctness through type checking, linting, the
production build, and focused manual checks.

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

Validate the Caddy configuration from the built image, then start the stack and
check container health before external testing.

## OVH Server Preparation

Document these deployment steps in `README.md` rather than automating them in an
opaque bootstrap script initially.

1. Install a supported Ubuntu LTS image on the VPS.
2. Create a non-root deployment user with sudo access.
3. Add an SSH public key and confirm a second key-authenticated session works.
4. Disable root SSH login and password-based SSH authentication.
5. Install Docker Engine and the Docker Compose plugin from Docker's official
   repository.
6. Enable Docker at boot.
7. Allow only SSH, HTTP, and HTTPS through UFW and the OVH network firewall.
8. Confirm `speakbetter.duckdns.org` resolves to `45.147.32.68` from a public
   resolver.
9. Clone the repository into a deployment directory owned by the deployment
   user.
10. Create the production `.env`, generate `SESSION_SECRET`, and set mode `600`.
11. Build and start the stack:

    ```sh
    docker compose up -d --build
    ```

12. Inspect status and logs:

    ```sh
    docker compose ps
    docker compose logs --tail=100 web api
    ```

13. Confirm Caddy obtained a valid certificate before tightening HTTPS headers.

The DNS A record and inbound ports 80 and 443 must be available before Caddy can
complete its standard ACME HTTP challenge.

## Deployment and Operations

Document the normal update procedure:

```sh
git pull --ff-only
docker compose build
docker compose up -d
docker image prune
```

Do not automate image pruning until rollback expectations are clear. Keep at
least the previous known-good Git revision available. A rollback consists of
checking out that revision, rebuilding, and running `docker compose up -d`.

Operational documentation should also cover:

- Viewing and following Caddy and API logs
- Checking container health and restart counts
- Restarting one service without restarting the other
- Backing up the `.env` securely outside the repository
- Preserving the Caddy data volume during normal upgrades
- Rotating the demo password, session secret, and provider keys
- Setting provider-side usage limits and billing alerts
- Avoiding log statements that contain uploaded audio, transcripts, cookies, or
  credentials

Changing `SESSION_SECRET` intentionally invalidates every existing session and
forces users to log in again.

## Manual Acceptance Checks

After deployment, verify:

1. `http://speakbetter.duckdns.org` redirects to HTTPS.
2. `https://speakbetter.duckdns.org` presents a valid trusted certificate.
3. An unauthenticated visitor sees only the password screen.
4. Incorrect passwords show a generic error and repeated failures are throttled.
5. The correct password unlocks the application and survives a page refresh.
6. Logout returns to the password screen and invalidates the session.
7. A direct anonymous request to `/api/analyze` receives `401`.
8. `/api/health` remains available and returns `{"status":"ok"}`.
9. The browser grants microphone access over HTTPS on desktop and mobile.
10. Recording, playback, upload, transcription, metrics, and feedback complete
    successfully.
11. An expired session encountered during analysis returns the user to login
    without exposing provider errors.
12. Recordings, transcripts, and feedback do not survive as server-side files.
13. Rebooting the VPS brings both containers back and retains a valid Caddy
    certificate.
14. Port 8000 is not reachable from the public internet.

## Planned Files

- `Dockerfile.backend`
- `Dockerfile.frontend`
- `compose.yaml`
- `Caddyfile`
- `.dockerignore`
- `.env.example`
- `.gitignore`
- `pyproject.toml`
- `uv.lock`
- `backend/app/config.py`
- `backend/app/main.py`
- `backend/app/models.py`
- `backend/tests/test_api.py`
- `backend/tests/test_config.py`
- `frontend/src/api.ts`
- `frontend/src/main.tsx`
- `frontend/src/App.tsx`
- `frontend/src/AuthGate.tsx`
- `frontend/src/LoginScreen.tsx`
- `frontend/src/styles.css`
- `README.md`

## Implementation Order

1. Add and test production-aware configuration and session authentication.
2. Protect analysis and update backend API tests.
3. Add the frontend authentication API, gate, login screen, logout, and expired
   session behavior.
4. Switch production API calls to same-origin paths and verify local development
   still works.
5. Add the backend production image and health check.
6. Add the frontend/Caddy multi-stage image and Caddy configuration.
7. Add Docker Compose, persistent Caddy volumes, networking, environment wiring,
   and resource limits.
8. Run all application and container verification locally.
9. Expand the README with OVH hardening, deployment, update, rollback, and secret
   rotation instructions.
10. Deploy to the VPS and perform the complete manual acceptance checklist.

## Future Scaling

Keep scaling changes out of the initial deployment. If measurements later show
that one worker is insufficient:

1. Increase Uvicorn to two workers on the same VPS and replace the process-local
   login limiter with shared state or edge-level controls.
2. Run multiple API containers and configure Caddy with multiple upstreams,
   health checks, and a suitable load-balancing policy.
3. Replace Uvicorn's process manager with Gunicorn only if its worker lifecycle
   controls are needed.
4. Move API replicas to multiple hosts and introduce a managed load balancer if
   the single Caddy/VPS edge becomes an availability concern.

Caddy and Uvicorn are independently replaceable. Moving to Nginx, Gunicorn, or a
managed ingress later should not require changes to the core React or FastAPI
business logic.

## Completion Criteria

- `https://speakbetter.duckdns.org` has a valid automatically renewed
  certificate.
- Unauthenticated visitors see only the password screen.
- Anonymous analysis requests receive `401` without invoking paid providers.
- Authentication persists through refresh, expires after the configured period,
  and is cleared by logout.
- Recording works over HTTPS on supported desktop and mobile browsers.
- Caddy serves the frontend and proxies the API from one public origin.
- FastAPI has no public host port and runs as a non-root user with one Uvicorn
  worker.
- Containers recover after Docker or VPS restart.
- Caddy certificate state survives container recreation.
- Audio, transcripts, and feedback are not persisted by the application.
- No secrets are committed, included in image layers or frontend assets, or
  written to application logs.
- Backend tests, Python lint/format checks, frontend lint/build, Compose
  validation, image builds, health checks, and manual acceptance checks pass.
