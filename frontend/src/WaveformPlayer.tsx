import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import Icon from './Icon'
import { formatClock } from './practice'
import type { FillerOccurrence, PauseOccurrence } from './types'

const FILLER_REGION_COLOR = 'rgba(237, 193, 129, 0.22)'
const PAUSE_REGION_COLOR = 'rgba(165, 198, 243, 0.2)'
const MIN_REGION_SECONDS = 0.08

export interface WaveformPlayerHandle {
  seekTo: (seconds: number) => void
  pause: () => void
}

interface WaveformPlayerProps {
  src: string
  measuredDuration: number
  fillerOccurrences: FillerOccurrence[]
  pauseOccurrences: PauseOccurrence[]
  showInsights: boolean
}

function addRegions(
  regions: RegionsPlugin,
  fillers: FillerOccurrence[],
  pauses: PauseOccurrence[],
): void {
  for (const filler of fillers) {
    regions.addRegion({
      start: filler.start,
      end: Math.max(filler.end, filler.start + MIN_REGION_SECONDS),
      color: FILLER_REGION_COLOR,
      drag: false,
      resize: false,
    })
  }

  for (const pause of pauses) {
    regions.addRegion({
      start: pause.start,
      end: Math.max(pause.end, pause.start + MIN_REGION_SECONDS),
      color: PAUSE_REGION_COLOR,
      drag: false,
      resize: false,
    })
  }
}

const WaveformPlayer = forwardRef<WaveformPlayerHandle, WaveformPlayerProps>(
  function WaveformPlayer(
    {
      src,
      measuredDuration,
      fillerOccurrences,
      pauseOccurrences,
      showInsights,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null)
    const audioRef = useRef<HTMLAudioElement>(null)
    const waveSurferRef = useRef<WaveSurfer | null>(null)
    const regionsRef = useRef<RegionsPlugin | null>(null)
    const [isReady, setIsReady] = useState(false)
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(measuredDuration)
    const [failed, setFailed] = useState(false)
    const [playbackError, setPlaybackError] = useState<string | null>(null)

    const seekTo = useCallback(
      (seconds: number) => {
        setPlaybackError(null)
        const target = Math.max(0, Math.min(seconds, duration))
        const audio = audioRef.current
        if (audio) {
          audio.currentTime = target
          void audio
            .play()
            .catch(() =>
              setPlaybackError(
                'Playback could not start. Try the audio play control.',
              ),
            )
          return
        }
        const waveSurfer = waveSurferRef.current
        if (!waveSurfer || !isReady) return
        waveSurfer.setTime(target)
        void waveSurfer
          .play()
          .catch(() =>
            setPlaybackError('Playback could not start. Please try again.'),
          )
      },
      [duration, isReady],
    )

    useImperativeHandle(
      ref,
      () => ({
        seekTo,
        pause() {
          audioRef.current?.pause()
          waveSurferRef.current?.pause()
        },
      }),
      [seekTo],
    )

    useEffect(() => {
      if (failed) return

      const container = containerRef.current
      if (!container) return

      let active = true

      const waveSurfer = WaveSurfer.create({
        container,
        backend: 'WebAudio',
        height: 96,
        waveColor: '#526d5f',
        progressColor: '#9ce5c5',
        cursorColor: '#eeefeb',
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
      })
      waveSurferRef.current = waveSurfer

      let destroyed = false
      const safeDestroy = () => {
        if (destroyed) return
        destroyed = true
        waveSurfer.destroy()
      }

      const handleFailure = () => {
        if (!active) return
        setFailed(true)
        safeDestroy()
      }

      const regions = RegionsPlugin.create()
      waveSurfer.registerPlugin(regions)
      regionsRef.current = regions

      waveSurfer.on('ready', (readyDuration) => {
        if (!active) return
        setDuration(readyDuration)
        setIsReady(true)
      })
      waveSurfer.on('timeupdate', (time) => {
        if (!active) return
        setCurrentTime(time)
      })
      waveSurfer.on('play', () => {
        if (active) setIsPlaying(true)
      })
      waveSurfer.on('pause', () => {
        if (active) setIsPlaying(false)
      })
      waveSurfer.on('finish', () => {
        if (active) setIsPlaying(false)
      })
      waveSurfer.on('error', handleFailure)

      waveSurfer.load(src, undefined, measuredDuration).catch(handleFailure)

      return () => {
        active = false
        if (waveSurferRef.current === waveSurfer) waveSurferRef.current = null
        if (regionsRef.current === regions) regionsRef.current = null
        safeDestroy()
      }
    }, [src, measuredDuration, failed])

    useEffect(() => {
      const regions = regionsRef.current
      if (!regions || !isReady) return
      regions.clearRegions()
      addRegions(regions, fillerOccurrences, pauseOccurrences)
    }, [isReady, fillerOccurrences, pauseOccurrences])

    const togglePlay = useCallback(() => {
      const waveSurfer = waveSurferRef.current
      if (!waveSurfer) return
      setPlaybackError(null)
      if (waveSurfer.isPlaying()) {
        waveSurfer.pause()
      } else {
        void waveSurfer
          .play()
          .catch(() =>
            setPlaybackError('Playback could not start. Please try again.'),
          )
      }
    }, [])

    return (
      <div className="player">
        {failed ? (
          <>
            <p className="playback-fallback">
              The waveform isn’t available. You can still listen to your
              recording below.
            </p>
            <audio
              ref={audioRef}
              className="playback"
              controls
              src={src}
              aria-label="Your recorded answer"
              onTimeUpdate={(event) =>
                setCurrentTime(event.currentTarget.currentTime)
              }
              onError={() =>
                setPlaybackError(
                  'This browser could not play the recording. Try recording another answer.',
                )
              }
            />
            <span className="player-time">
              {formatClock(currentTime)} / {formatClock(measuredDuration)}
            </span>
          </>
        ) : (
          <>
            <div className="waveform-wrap">
              <div className="waveform" ref={containerRef} aria-hidden="true" />
              {!isReady && (
                <div className="waveform-loading" role="status">
                  <span className="spinner" />
                  Preparing your audio…
                </div>
              )}
            </div>
            <div className="player-controls">
              <button
                className="player-toggle"
                type="button"
                onClick={togglePlay}
                disabled={!isReady}
              >
                <Icon name={isPlaying ? 'pause' : 'play'} />
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <input
                className="player-seek"
                type="range"
                min={0}
                max={duration || measuredDuration}
                step={0.1}
                value={Math.min(currentTime, duration)}
                disabled={!isReady}
                aria-label="Playback position"
                aria-valuetext={`${formatClock(currentTime)} of ${formatClock(duration)}`}
                onChange={(event) =>
                  waveSurferRef.current?.setTime(Number(event.target.value))
                }
              />
              <span className="player-time">
                {formatClock(currentTime)} / {formatClock(duration)}
              </span>
            </div>
          </>
        )}
        {playbackError && (
          <p className="player-error" role="alert">
            {playbackError}
          </p>
        )}
        {showInsights && (
          <>
            {!failed && (
              <p className="player-legend">
                <span>
                  <i className="legend-swatch legend-swatch--filler" />
                  Filler words
                </span>
                <span>
                  <i className="legend-swatch legend-swatch--pause" />
                  Pauses
                </span>
                <span className="legend-hint">Select a moment to listen</span>
              </p>
            )}
            <div className="moments">
              <section aria-label="Filler moments">
                <h3>
                  Filler moments{' '}
                  <span className="muted">/ {fillerOccurrences.length}</span>
                </h3>
                {fillerOccurrences.length ? (
                  <div className="chip-list">
                    {fillerOccurrences.map((occurrence, index) => (
                      <button
                        key={`filler-${index}`}
                        type="button"
                        className="chip chip--filler"
                        disabled={!failed && !isReady}
                        onClick={() => seekTo(occurrence.start)}
                        aria-label={`Play filler ${occurrence.text} at ${formatClock(occurrence.start)}`}
                      >
                        {occurrence.text} · {formatClock(occurrence.start)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="field-hint">
                    No filler words detected in this answer.
                  </p>
                )}
              </section>
              <section aria-label="Pause moments">
                <h3>
                  Noticeable pauses{' '}
                  <span className="muted">/ {pauseOccurrences.length}</span>
                </h3>
                {pauseOccurrences.length ? (
                  <div className="chip-list">
                    {pauseOccurrences.map((pause, index) => (
                      <button
                        key={`pause-${index}`}
                        type="button"
                        className="chip chip--pause"
                        disabled={!failed && !isReady}
                        onClick={() => seekTo(pause.start)}
                        aria-label={`Play pause at ${formatClock(pause.start)}, ${pause.duration_seconds} seconds long`}
                      >
                        {formatClock(pause.start)} · {pause.duration_seconds}s
                        pause
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="field-hint">
                    No noticeable pauses detected in this answer.
                  </p>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    )
  },
)

export default WaveformPlayer
