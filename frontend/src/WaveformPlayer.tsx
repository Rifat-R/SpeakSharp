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
import type { FillerOccurrence, PauseOccurrence } from './types'

const FILLER_REGION_COLOR = 'rgba(207, 59, 59, 0.25)'
const PAUSE_REGION_COLOR = 'rgba(47, 111, 237, 0.18)'
const MIN_REGION_SECONDS = 0.08

export interface WaveformPlayerHandle {
  seekTo: (seconds: number) => void
}

interface WaveformPlayerProps {
  src: string
  measuredDuration: number
  fillerOccurrences: FillerOccurrence[]
  pauseOccurrences: PauseOccurrence[]
}

function formatClock(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = Math.floor(safeSeconds % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
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
    { src, measuredDuration, fillerOccurrences, pauseOccurrences },
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

    useImperativeHandle(
      ref,
      () => ({
        seekTo(seconds: number) {
          const audio = audioRef.current
          if (audio) {
            audio.currentTime = seconds
            const playPromise = audio.play()
            if (playPromise) playPromise.catch(() => {})
            return
          }

          const waveSurfer = waveSurferRef.current
          if (!waveSurfer) return
          waveSurfer.setTime(seconds)
          void waveSurfer.play().catch(() => {})
        },
      }),
      [],
    )

    useEffect(() => {
      if (failed) return

      const container = containerRef.current
      if (!container) return

      let active = true

      const waveSurfer = WaveSurfer.create({
        container,
        height: 96,
        waveColor: '#b9c2d0',
        progressColor: '#2f6fed',
        cursorColor: '#1c2430',
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

      regions.on('region-clicked', (region, event) => {
        event.stopPropagation()
        waveSurfer.setTime(region.start)
        void waveSurfer.play().catch(() => {})
      })

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
      if (waveSurfer.isPlaying()) {
        waveSurfer.pause()
      } else {
        void waveSurfer.play().catch(() => {})
      }
    }, [])

    if (failed) {
      return (
        <div className="player">
          <audio
            ref={audioRef}
            className="playback"
            controls
            src={src}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          />
          <span className="player-time">
            {formatClock(currentTime)} / {formatClock(measuredDuration)}
          </span>
        </div>
      )
    }

    return (
      <div className="player">
        <div className="waveform" ref={containerRef} aria-hidden="true" />
        <div className="player-controls">
          <button type="button" onClick={togglePlay}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <span className="player-time">
            {formatClock(currentTime)} / {formatClock(duration)}
          </span>
        </div>
        <p className="player-legend">
          <span className="legend-swatch legend-swatch--filler" /> Filler words
          <span className="legend-swatch legend-swatch--pause" /> Pauses
        </p>
      </div>
    )
  },
)

export default WaveformPlayer
