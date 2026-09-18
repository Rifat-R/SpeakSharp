# Waveform Seeking Fix Plan

## Goal

Make waveform seeking reliable for recordings created by `MediaRecorder`:

1. Clicking the waveform while audio is playing jumps to the selected time.
2. Clicking while paused preserves the selected time when playback starts.
3. Clicking inside a highlighted filler or pause region seeks to the exact
   clicked position rather than the beginning of the region.
4. Filler and pause timestamp chips continue to seek to their associated
   timestamps and start playback.

## Background

`frontend/src/WaveformPlayer.tsx` uses WaveSurfer.js 7.12.12 with its default
`MediaElement` backend. Recordings are created in the browser as WebM blobs,
which may not contain usable duration metadata. The browser can consequently
report an infinite duration and fail to apply changes to the underlying media
element's `currentTime`.

WaveSurfer can still decode the recording and render the waveform with the
correct duration. A waveform click may therefore move the visual cursor
temporarily, while the unseekable media element remains at its previous time.
The next playback update then moves the cursor back to that original time.

The Regions plugin introduces a separate interaction problem. The current
`region-clicked` handler stops the click from reaching the waveform, seeks to
`region.start`, and starts playback. This means any position clicked inside a
highlighted region is replaced with the region's start time.

## Documentation Findings

The current WaveSurfer.js v7 documentation and 7.12.12 API establish that:

- The default playback backend is `MediaElement`.
- `backend: 'WebAudio'` uses decoded audio for playback.
- Waveform interaction is enabled by default, and clicking the waveform seeks
  to the clicked position.
- `setTime(seconds)` seeks to an absolute time in seconds.
- `seekTo(progress)` expects a relative value between `0` and `1` and is not a
  replacement for the existing timestamp-chip behavior.
- Regions emit `region-clicked` events, but region DOM clicks can otherwise
  bubble to the waveform's normal click handler.

References:

- Context7 library: `/katspaugh/wavesurfer.js`
- WaveSurfer options and methods:
  <https://github.com/katspaugh/wavesurfer.js/blob/main/_autodocs/api-reference/wavesurfer.md>
- WaveSurfer configuration:
  <https://github.com/katspaugh/wavesurfer.js/blob/main/_autodocs/configuration.md>
- Regions plugin events:
  <https://github.com/katspaugh/wavesurfer.js/blob/main/_autodocs/types.md>

## Root Causes

### Media playback backend

The default `MediaElement` backend depends on the recorded WebM's native media
metadata and seekability. The decoded waveform duration does not make an
otherwise unseekable HTML media element reliably seekable.

### Region click override

`frontend/src/WaveformPlayer.tsx` handles every highlighted region click by:

1. Stopping event propagation.
2. Calling `waveSurfer.setTime(region.start)`.
3. Calling `waveSurfer.play()`.

This deliberately replaces the user's exact click position with the region's
start position.

## Implementation

### 1. Use the WebAudio backend

Update the options passed to `WaveSurfer.create` in
`frontend/src/WaveformPlayer.tsx`:

```ts
const waveSurfer = WaveSurfer.create({
  container,
  backend: 'WebAudio',
  // Existing visual options remain unchanged.
})
```

This makes playback and seeking use the decoded audio buffer rather than the
WebM media element's incomplete duration metadata.

Keep the existing `waveSurfer.load(src, undefined, measuredDuration)` call. The
measured duration remains useful while loading, while decoded audio supplies
the actual playback data and duration once ready.

### 2. Restore precise clicks inside regions

Remove the custom `regions.on('region-clicked', ...)` handler. The regions are
already configured with `drag: false` and `resize: false`; without the custom
handler, a click can bubble to WaveSurfer's built-in waveform click handling
and seek to the exact horizontal position.

Do not replace this with another region-start handler. Timestamp chips already
provide explicit navigation to the start of each detected occurrence.

### 3. Preserve imperative timestamp seeking

Keep the existing imperative API:

```ts
waveSurfer.setTime(seconds)
void waveSurfer.play().catch(() => {})
```

This is the correct WaveSurfer API for the absolute timestamps supplied by the
filler and pause chips. Continue using the visible native `<audio>` element in
fallback mode.

### 4. Avoid unrelated interaction changes

Do not enable drag-to-seek unless separate product requirements call for
scrubbing. WaveSurfer's normal click interaction is sufficient for this bug,
and keeping the change focused reduces behavioral risk.

## Verification

### Automated

Run from `frontend/`:

```sh
npm run build
npm run lint
```

The frontend currently has no automated test setup. Do not add a test framework
solely for this focused fix.

### Manual

Use a newly recorded clip in a browser that records WebM:

1. Start playback, click several earlier and later waveform positions, and
   confirm playback immediately continues from each selected position.
2. Pause playback, click another position, wait briefly, then press Play and
   confirm playback starts from the selected position.
3. Complete analysis so filler and pause regions appear, then click at several
   positions within a long highlighted region and confirm each exact position
   is retained.
4. Click filler and pause timestamp chips and confirm playback starts at the
   occurrence's start timestamp.
5. Seek close to the beginning and end of the recording and confirm values are
   clamped correctly without playback errors.
6. Confirm Play/Pause state, current-time display, waveform progress, and the
   decode-failure native audio fallback still behave correctly.

## Files

- `frontend/src/WaveformPlayer.tsx`

No backend or API changes are required.
