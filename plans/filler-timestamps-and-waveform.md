# Filler Timestamps + Waveform Plan

## Goal

1. Surface clickable filler-word timestamps (and noticeable-pause timestamps)
   aligned to the recording.
2. Replace the native `<audio controls>` with WaveSurfer.js so playback shows
   an accurate total duration, a seekable waveform, and visual marker regions.

## Background

- ElevenLabs Scribe already returns word-level `start`/`end` timestamps, but
  `backend/app/metrics.py` discards them when counting fillers and pauses.
- Chrome's `MediaRecorder` writes WebM files without a `Duration` header
  element, so `HTMLMediaElement.duration` is `Infinity` and the native control
  renders the current time with no total.
- WaveSurfer's default WebAudio backend decodes the blob with
  `decodeAudioData`, which yields the true duration. `load()` also accepts the
  measured wall-clock duration as a fallback.

## Backend

- `backend/app/metrics.py`
  - Add `FillerOccurrence(text, start, end)` and
    `PauseOccurrence(start, end, duration_seconds)` dataclasses.
  - Replace `_count_fillers` with `_find_fillers` returning occurrences;
    derive `filler_word_breakdown` from them.
  - Return `pause_occurrences` from `_find_pauses` and compute the average and
    longest pause from those occurrences.
  - Add `filler_occurrences` and `pause_occurrences` to the metrics dict.
- `backend/app/models.py`
  - Add `FillerOccurrence` / `PauseOccurrence` models and the two list fields
    on `SpeechMetrics`.
- `backend/tests/test_metrics.py`
  - Assert occurrence text and timestamps, including a multi-word phrase and
    pause bounds.
- The `/api/analyze` change is additive only.

## Frontend

- Add `wavesurfer.js` (core + `plugins/regions`).
- New `frontend/src/WaveformPlayer.tsx`:
  - Create the instance in `useEffect`, register `RegionsPlugin`, then
    `load(src, undefined, measuredDuration)`, and `destroy()` on cleanup.
  - Add read-only regions (no drag/resize) for fillers and pauses on `ready`.
  - Play/pause, `current / total` display, region-click seek-and-play.
  - Fall back to a plain `<audio controls>` if decoding fails.
- `frontend/src/App.tsx`:
  - Measure the real recording length with `performance.now()`.
  - Replace the native audio element with `WaveformPlayer`.
  - Add accessible "Filler moments" and "Pauses" chip lists that seek.
- `frontend/src/types.ts` and `frontend/src/styles.css` updates.

## Verification

- Backend: `uv run pytest`, `uv run ruff check .`, `uv run ruff format --check .`.
- Frontend: `npm run build` and `npm run lint`.
- Manual: confirm the waveform shows a real total duration, and that chips and
  regions seek to the correct moments.
