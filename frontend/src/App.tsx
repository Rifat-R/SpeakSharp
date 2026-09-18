import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, analyzeAnswer } from './api'
import AnalysisReport from './AnalysisReport'
import Icon from './Icon'
import QuestionPicker from './QuestionPicker'
import RecordingStudio, { type Phase } from './RecordingStudio'
import { formatClock, PRESET_QUESTIONS } from './practice'
import WaveformPlayer, { type WaveformPlayerHandle } from './WaveformPlayer'
import type {
  AnalysisResponse,
  FillerOccurrence,
  PauseOccurrence,
} from './types'

const NO_FILLERS: FillerOccurrence[] = []
const NO_PAUSES: PauseOccurrence[] = []
const MAX_RECORDING_SECONDS = 120
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]

interface Recording {
  blob: Blob
  url: string
  mimeType: string
  durationSeconds: number
  question: string
}

function extensionFor(mimeType: string): string {
  return mimeType.includes('ogg')
    ? 'ogg'
    : mimeType.includes('mp4')
      ? 'mp4'
      : 'webm'
}

function App() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [question, setQuestion] = useState(PRESET_QUESTIONS[0].question)
  const [customQuestion, setCustomQuestion] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [recording, setRecording] = useState<Recording | null>(null)
  const [result, setResult] = useState<AnalysisResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const startedAtRef = useRef(0)
  const activeRef = useRef(false)
  const playerRef = useRef<WaveformPlayerHandle>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null)
  const previousPhaseRef = useRef<Phase>('idle')

  const effectiveQuestion = useCustom ? customQuestion : question
  const isBusy = phase === 'requesting' || phase === 'analyzing'

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  const startRecording = useCallback(async () => {
    const recordedQuestion = effectiveQuestion.trim()
    if (!recordedQuestion) return
    setError(null)
    setResult(null)
    setElapsed(0)
    setPhase('requesting')

    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setError(
        'This browser does not support microphone recording. Try a recent version of Chrome, Firefox, or Safari.',
      )
      setPhase('error')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!activeRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      const mimeType = PREFERRED_MIME_TYPES.find((type) =>
        MediaRecorder.isTypeSupported(type),
      )
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onerror = () => {
        recorder.onstop = null
        releaseStream()
        setError(
          'The microphone stopped unexpectedly. Check your microphone and start a new recording.',
        )
        setPhase('error')
      }
      recorder.onstop = () => {
        releaseStream()
        if (!activeRef.current) return
        const recordedMime = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(chunks, { type: recordedMime })
        if (!blob.size) {
          setError(
            'No audio was captured. Check your microphone and try recording again.',
          )
          setPhase('error')
          return
        }
        const durationSeconds = Math.max(
          0,
          (performance.now() - startedAtRef.current) / 1000,
        )
        setRecording({
          blob,
          url: URL.createObjectURL(blob),
          mimeType: recordedMime,
          durationSeconds,
          question: recordedQuestion,
        })
        setPhase('ready')
      }
      mediaRecorderRef.current = recorder
      startedAtRef.current = performance.now()
      recorder.start()
      setPhase('recording')
    } catch {
      releaseStream()
      if (!activeRef.current) return
      setError(
        'Microphone access was denied or is unavailable. Allow microphone access in your browser settings, then try again.',
      )
      setPhase('error')
    }
  }, [effectiveQuestion, releaseStream])

  const discardRecording = useCallback(() => {
    setRecording(null)
    setElapsed(0)
    setResult(null)
    setError(null)
    setPhase('idle')
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (!recording) return
    playerRef.current?.pause()
    setPhase('analyzing')
    setError(null)
    try {
      const response = await analyzeAnswer(
        recording.question,
        recording.blob,
        `recording.${extensionFor(recording.mimeType)}`,
      )
      if (!activeRef.current) return
      setResult(response)
      setPhase('complete')
    } catch (caught) {
      if (!activeRef.current) return
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Something went wrong while analyzing the recording.',
      )
      setPhase('error')
    }
  }, [recording])

  useEffect(() => {
    if (phase !== 'recording') return
    const interval = window.setInterval(() => {
      const seconds = Math.floor(
        (performance.now() - startedAtRef.current) / 1000,
      )
      setElapsed(Math.min(seconds, MAX_RECORDING_SECONDS))
      if (seconds >= MAX_RECORDING_SECONDS) stopRecording()
    }, 200)
    return () => window.clearInterval(interval)
  }, [phase, stopRecording])

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      const recorder = mediaRecorderRef.current
      if (recorder) {
        recorder.onstop = null
        recorder.onerror = null
        if (recorder.state !== 'inactive') recorder.stop()
      }
      releaseStream()
    }
  }, [releaseStream])

  useEffect(() => {
    if (!recording) return
    return () => URL.revokeObjectURL(recording.url)
  }, [recording])

  useEffect(() => {
    if (previousPhaseRef.current === phase) return
    previousPhaseRef.current = phase
    if (phase === 'complete') resultsHeadingRef.current?.focus()
    else if (phase === 'error') errorRef.current?.focus()
    else if (phase === 'idle' || phase === 'ready' || phase === 'recording')
      actionRef.current?.focus({ preventScroll: true })
  }, [phase])

  const step = result ? 2 : recording ? 1 : 0
  const playback = recording ? (
    <WaveformPlayer
      key={recording.url}
      ref={playerRef}
      src={recording.url}
      measuredDuration={recording.durationSeconds}
      fillerOccurrences={result?.metrics.filler_occurrences ?? NO_FILLERS}
      pauseOccurrences={result?.metrics.pause_occurrences ?? NO_PAUSES}
      showInsights={Boolean(result)}
    />
  ) : null

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="audio" />
          </span>
          SpeakSharp<span className="brand-period">.</span>
        </div>
        <div className="header-note">
          <span className="status-dot" />
          Your space to get better
        </div>
      </header>
      <main id="main-content" className="app" tabIndex={-1}>
        <div className="page-intro">
          <div>
            <span className="eyebrow intro-eyebrow">
              A little practice. A lot more confidence.
            </span>
            <h1 ref={resultsHeadingRef} tabIndex={result ? -1 : undefined}>
              {result ? (
                <>
                  Good practice.
                  <br className="mobile-break" /> <span>Real progress.</span>
                </>
              ) : (
                <>
                  Find your words.
                  <br className="mobile-break" /> <span>Own the room.</span>
                </>
              )}
            </h1>
            <p>
              {result
                ? 'Take a closer look at your answer, and make the next one even stronger.'
                : 'Turn your next interview answer into your best one. Let’s practice.'}
            </p>
          </div>
          {result && (
            <button
              type="button"
              className="button primary"
              onClick={discardRecording}
            >
              <Icon name="retry" />
              Practice again
              <Icon name="arrow" />
            </button>
          )}
        </div>
        <ol className="journey" aria-label="Practice progress">
          {['Practice', 'Review', 'Your insights'].map((label, index) => (
            <li
              key={label}
              className={
                index === step ? 'is-current' : index < step ? 'is-done' : ''
              }
              aria-current={index === step ? 'step' : undefined}
            >
              <span className="journey-number">
                {index < step ? <Icon name="check" /> : `0${index + 1}`}
              </span>
              <span>{label}</span>
              {index < 2 && (
                <span className="journey-line" aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>

        {result && recording ? (
          <>
            <div className="recorded-question">
              <Icon name="mic" />
              <div>
                <span className="small-label">The question you practiced</span>
                <p>{recording.question}</p>
              </div>
              <span className="recorded-duration">
                <Icon name="clock" />
                {formatClock(recording.durationSeconds)} recording
              </span>
            </div>
            <AnalysisReport
              result={result}
              playback={
                <section
                  className="panel report-playback"
                  aria-labelledby="playback-heading"
                >
                  <div className="report-section-heading">
                    <div>
                      <span className="eyebrow">Hear it for yourself</span>
                      <h2 id="playback-heading">Listen. Notice. Improve.</h2>
                    </div>
                    <Icon name="audio" />
                  </div>
                  {playback}
                </section>
              }
            />
          </>
        ) : (
          <>
            <div className="practice-layout">
              <QuestionPicker
                question={question}
                customQuestion={customQuestion}
                useCustom={useCustom}
                disabled={phase === 'recording' || isBusy || Boolean(recording)}
                onSelect={(value) => {
                  setQuestion(value)
                  setUseCustom(false)
                }}
                onCustomSelect={() => setUseCustom(true)}
                onCustomChange={setCustomQuestion}
              />
              <RecordingStudio
                phase={phase}
                question={recording?.question ?? effectiveQuestion}
                elapsed={elapsed}
                maxSeconds={MAX_RECORDING_SECONDS}
                hasRecording={Boolean(recording)}
                error={error}
                canRecord={effectiveQuestion.trim().length > 0}
                playback={playback}
                actionRef={actionRef}
                errorRef={errorRef}
                onStart={startRecording}
                onStop={stopRecording}
                onAnalyze={handleAnalyze}
                onReset={discardRecording}
              />
            </div>
            <aside className="practice-note">
              <span className="note-icon">
                <Icon name="spark" />
              </span>
              <div>
                <strong>Progress starts with showing up.</strong>
                <p>
                  Speak naturally, not perfectly. You’ll get insights on your
                  pace, clarity, and how to tell a stronger story.
                </p>
              </div>
              <span className="note-label">One answer at a time</span>
            </aside>
          </>
        )}
      </main>
      <footer className="site-footer">
        <span>Made for your next big moment.</span>
        <span>
          English practice <span aria-hidden="true">·</span> Recordings aren’t
          saved
        </span>
      </footer>
    </div>
  )
}

export default App
