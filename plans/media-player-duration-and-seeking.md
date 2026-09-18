# Media Player Duration + Seeking Fix Plan

## Goal

1. Always show the total length of a recorded audio clip, even when the
   browser/WebM metadata does not expose a usable duration.
2. Make clicking a filler moment or pause chip seek the currently visible
   player to that exact timestamp.

## Background

- Chrome's `MediaRecorder` writes WebM blobs without a `Duration` header, so
  `HTMLMediaElement.duration` is `Infinity` and native `<audio controls>` shows
  no total.
- `WaveformPlayer` measures wall-clock duration in `App.tsx` and passes it as
  `measuredDuration`, but the native `<audio>` fallback ignores it.
- The fallback `<audio>` has no ref and is not used by `seekTo`; the imperative
  handle always targets `waveSurferRef.current`.
- Under React `StrictMode`, the first mount effect is set up, cleaned up, and
  set up again. The aborted first `load()` can reject after cleanup and call
  `setFailed(true)`, incorrectly switching the live component into fallback
  mode with no duration display and no seek wiring.
- WaveSurfer 7.12.x defaults to its `MediaElement` backend, but still decodes
  the fetched blob to render the waveform and uses the decoded duration when
  the media element reports `0` or `Infinity`. Changing playback backends is
  therefore not required to fix this defect.

The filler/pause timestamps produced by the backend are correct; the defect is
entirely in the frontend playback component.

## Root Cause

`frontend/src/WaveformPlayer.tsx`:

- Stale/aborted loads are not guarded, so they can activate the fallback.
- The fallback does not render `measuredDuration`.
- `seekTo` ignores the fallback element.
- Refs are never cleared on cleanup.

## Implementation

### 1. `frontend/src/WaveformPlayer.tsx`

- Make setup race-safe:
  - Track an `active` / cancelled flag per effect run.
  - Guard asynchronous `ready` and failure handlers so only the active
    WaveSurfer instance can update React state.
  - In cleanup, clear `waveSurferRef.current` and `regionsRef.current` only when
    they still point at that effect's instance.
  - Mark the effect inactive before destroying WaveSurfer so an abort rejection
    from cleanup cannot activate the fallback.
  - Consolidate the `error` event listener and `load().catch()` through one
    guarded failure handler.
- Keep WaveSurfer's default backend. Its decoded-data duration fallback already
  handles `MediaRecorder` blobs whose media metadata reports `Infinity`, while
  avoiding an unrelated playback-backend change.
- Add an `audioRef` for the fallback element.
- Update `seekTo` to prefer the visible fallback when present:
  ```ts
  const audio = audioRef.current
  if (audio) {
    audio.currentTime = seconds
    void audio.play()
    return
  }
  const waveSurfer = waveSurferRef.current
  if (!waveSurfer) return
  waveSurfer.setTime(seconds)
  void waveSurfer.play()
  ```
- Render fallback with controls plus a `current / total` readout:
  - Track `currentTime` via `timeupdate` on the fallback audio.
  - Display `formatClock(currentTime) / formatClock(measuredDuration)`.
- At the start of each new load, reset `currentTime`, `duration`, `isReady`,
  `isPlaying`, and `failed` so a new recording starts clean.
- Keep rejected `play()` promises from becoming unhandled errors. Playback can
  legitimately be rejected by browser policy or an unsupported fallback
  codec, and this should not break the click handler.

### 2. `frontend/src/App.tsx`

- Harden `formatClock` to sanitize and floor values:
  ```ts
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0
  const minutes = Math.floor(safe / 60)
  const seconds = Math.floor(safe % 60)
  ```
  This prevents outputs like `1:1.25` for `61.25`.

### 3. Backend

- No changes required. `filler_occurrences[].start` and
  `pause_occurrences[].start` already carry the provider word timestamps.
- Keep `metrics.duration_seconds` as spoken duration (first word to last word);
  the player's total comes from `measuredDuration` / decoded audio, not the
  metric card.

## Verification

- Automated:
  - `npm --prefix frontend run test`
  - `npm --prefix frontend run build`
  - `npm --prefix frontend run lint`
- Manual:
  - Record a clip; confirm the player shows `current / total` before and after
    the waveform is ready.
  - Click each filler chip and each pause chip; confirm the cursor/playhead
    jumps to the matching moment and playback starts.
  - Click a highlighted waveform region; confirm the same behavior.
  - Force a decode failure (unsupported codec) and confirm the fallback still
    shows the total duration and responds to chip clicks.

## Tests

Add a minimal frontend test setup because `frontend/package.json` currently has
no test script or test dependencies:

- Add Vitest, `@testing-library/react`, and `jsdom` as dev dependencies.
- Add a `test` script that runs Vitest once.
- Configure the test environment as `jsdom`.
- Mock `wavesurfer.js` and the regions plugin in
  `frontend/src/WaveformPlayer.test.tsx` so lifecycle failures and imperative
  seeking can be exercised without decoding real audio.

High-value cases:

1. Measured duration is visible before WaveSurfer emits `ready`.
2. `ready(duration)` replaces the estimated duration.
3. Strict Mode stale load rejection does not activate the fallback.
4. Imperative `seekTo(12.5)` calls `setTime(12.5)` on the active WaveSurfer
   instance.
5. Fallback mode: `seekTo(12.5)` sets `currentTime` on the visible `<audio>`.
6. Fallback mode: measured duration is rendered.
7. Regions are added whether results arrive before or after `ready`.
8. Fractional timestamps format consistently (`61.25` -> `1:01`).

Filler and pause chip clicks are thin wrappers around `onSeek(start)` in
`MetricsPanel`; verify them during the manual acceptance check rather than
expanding the unit-test surface of `App` solely to expose an internal component.

Backend coverage already exists for occurrence timestamps in
`backend/tests/test_metrics.py` and `backend/tests/test_api.py`; consider adding
a non-empty `pause_occurrences` API assertion.

## Files

- `frontend/src/WaveformPlayer.tsx` (primary fix)
- `frontend/src/App.tsx` (timestamp formatting)
- `frontend/src/WaveformPlayer.test.tsx` (regression coverage)
- `frontend/vite.config.ts` (Vitest/jsdom configuration)
- `frontend/package.json` and `frontend/package-lock.json` (test script/dev deps)
