import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, analyzeAnswer } from './api'
import type { AnalysisResponse, SpeechMetrics } from './types'

const PRESET_QUESTIONS = [
  'Tell me about yourself.',
  'Why are you interested in this role?',
  'Describe a difficult problem you solved.',
  'Tell me about a time you handled conflict.',
]

const MAX_RECORDING_SECONDS = 120

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]

type Phase =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'ready'
  | 'analyzing'
  | 'complete'
  | 'error'

interface Recording {
  blob: Blob
  url: string
  mimeType: string
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4')) return 'mp4'
  return 'webm'
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  )
}

function MetricsPanel({ metrics }: { metrics: SpeechMetrics }) {
  const fillers = Object.entries(metrics.filler_word_breakdown)

  return (
    <div className="metrics-grid">
      <MetricCard label="Duration" value={`${metrics.duration_seconds}s`} />
      <MetricCard label="Words" value={String(metrics.word_count)} />
      <MetricCard label="Words / min" value={String(metrics.words_per_minute)} />
      <MetricCard label="Filler words" value={String(metrics.filler_word_count)} />
      <MetricCard
        label="Fillers / min"
        value={String(metrics.filler_words_per_minute)}
      />
      <MetricCard
        label="Noticeable pauses"
        value={String(metrics.noticeable_pause_count)}
      />
      <MetricCard
        label="Longest pause"
        value={`${metrics.longest_pause_seconds}s`}
      />
      <MetricCard
        label="Avg. pause"
        value={`${metrics.average_pause_seconds}s`}
      />
      <div className="metric-card metric-card--wide">
        <span className="metric-label">Filler breakdown</span>
        <span className="metric-value metric-value--small">
          {fillers.length > 0
            ? fillers.map(([word, count]) => `${word} (${count})`).join(', ')
            : 'None detected'}
        </span>
      </div>
    </div>
  )
}

function FeedbackPanel({ result }: { result: AnalysisResponse }) {
  const { feedback } = result

  return (
    <div className="feedback">
      <p className="assessment">{feedback.overall_assessment}</p>

      <div className="feedback-columns">
        <section>
          <h3>Strengths</h3>
          <ul>
            {feedback.strengths.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3>What to improve</h3>
          <ul>
            {feedback.improvements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <section>
        <h3>Suggested structure</h3>
        <ol>
          {feedback.suggested_structure.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>

      <section>
        <h3>Next steps</h3>
        <ul>
          {feedback.next_steps.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <details className="transcript">
        <summary>View verbatim transcript</summary>
        <p>{result.transcript}</p>
      </details>
    </div>
  )
}

function App() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [question, setQuestion] = useState(PRESET_QUESTIONS[0])
  const [customQuestion, setCustomQuestion] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [recording, setRecording] = useState<Recording | null>(null)
  const [result, setResult] = useState<AnalysisResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const effectiveQuestion = useCustom ? customQuestion : question
  const canAnalyze = effectiveQuestion.trim().length > 0
  const isBusy = phase === 'requesting' || phase === 'analyzing'

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }, [])

  const startRecording = useCallback(async () => {
    setError(null)
    setResult(null)
    setPhase('requesting')

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support microphone recording.')
      setPhase('error')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = pickMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const recordedMime = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: recordedMime })
        const url = URL.createObjectURL(blob)
        setRecording((previous) => {
          if (previous) URL.revokeObjectURL(previous.url)
          return { blob, url, mimeType: recordedMime }
        })
        setPhase('ready')
        releaseStream()
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setElapsed(0)
      setPhase('recording')
    } catch {
      releaseStream()
      setError('Microphone access was denied or is unavailable.')
      setPhase('error')
    }
  }, [releaseStream])

  const discardRecording = useCallback(() => {
    setRecording((previous) => {
      if (previous) URL.revokeObjectURL(previous.url)
      return null
    })
    setElapsed(0)
    setResult(null)
    setError(null)
    setPhase('idle')
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (!recording) return
    setPhase('analyzing')
    setError(null)

    try {
      const response = await analyzeAnswer(
        effectiveQuestion.trim(),
        recording.blob,
        `recording.${extensionFor(recording.mimeType)}`,
      )
      setResult(response)
      setPhase('complete')
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Something went wrong while analyzing the recording.',
      )
      setPhase('error')
    }
  }, [effectiveQuestion, recording])

  useEffect(() => {
    if (phase !== 'recording') return
    const interval = window.setInterval(() => {
      setElapsed((seconds) => seconds + 1)
    }, 1000)
    return () => window.clearInterval(interval)
  }, [phase])

  useEffect(() => {
    if (phase === 'recording' && elapsed >= MAX_RECORDING_SECONDS) {
      stopRecording()
    }
  }, [elapsed, phase, stopRecording])

  useEffect(
    () => () => {
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
    },
    [],
  )

  const statusMessage = useMemo(() => {
    switch (phase) {
      case 'requesting':
        return 'Requesting microphone access…'
      case 'recording':
        return `Recording… ${formatClock(elapsed)} of ${formatClock(MAX_RECORDING_SECONDS)}`
      case 'ready':
        return 'Recording ready. Review it or submit for analysis.'
      case 'analyzing':
        return 'Transcribing and analyzing your answer…'
      case 'complete':
        return 'Analysis complete.'
      case 'error':
        return error ?? 'Something went wrong.'
      default:
        return 'Select a question and start recording when you are ready.'
    }
  }, [elapsed, error, phase])

  return (
    <main className="app">
      <header>
        <h1>SpeakSharp</h1>
        <p className="tagline">
          Practice an interview answer, then get objective metrics and coaching.
        </p>
      </header>

      <section className="panel">
        <h2>1. Choose your question</h2>
        <fieldset disabled={phase === 'recording' || isBusy}>
          <legend className="sr-only">Interview question</legend>
          {PRESET_QUESTIONS.map((preset) => (
            <label key={preset} className="question-option">
              <input
                type="radio"
                name="question"
                value={preset}
                checked={!useCustom && question === preset}
                onChange={() => {
                  setQuestion(preset)
                  setUseCustom(false)
                }}
              />
              <span>{preset}</span>
            </label>
          ))}
          <label className="question-option">
            <input
              type="radio"
              name="question"
              checked={useCustom}
              onChange={() => setUseCustom(true)}
            />
            <span>Custom question</span>
          </label>
          {useCustom && (
            <input
              className="custom-question"
              type="text"
              value={customQuestion}
              maxLength={500}
              placeholder="Type the interview question you want to practice"
              onChange={(event) => setCustomQuestion(event.target.value)}
            />
          )}
        </fieldset>
      </section>

      <section className="panel">
        <h2>2. Record your answer</h2>
        <p className="status" role="status" aria-live="polite">
          {statusMessage}
        </p>

        <div className="controls">
          {(phase === 'idle' || phase === 'error') && (
            <button
              type="button"
              className="primary"
              onClick={startRecording}
              disabled={!canAnalyze || isBusy}
            >
              Start recording
            </button>
          )}

          {phase === 'recording' && (
            <button type="button" className="danger" onClick={stopRecording}>
              Stop recording
            </button>
          )}

          {(phase === 'requesting' || phase === 'analyzing') && (
            <button type="button" className="primary" disabled>
              {phase === 'requesting' ? 'Requesting…' : 'Analyzing…'}
            </button>
          )}

          {recording && (phase === 'ready' || phase === 'error') && (
            <>
              <button
                type="button"
                className="primary"
                onClick={handleAnalyze}
                disabled={!canAnalyze}
              >
                {phase === 'error' ? 'Try analysis again' : 'Analyze answer'}
              </button>
              <button type="button" onClick={discardRecording}>
                Discard
              </button>
            </>
          )}

          {result && (
            <button type="button" onClick={discardRecording}>
              Record another answer
            </button>
          )}
        </div>

        {recording && (
          <audio className="playback" controls src={recording.url} />
        )}
      </section>

      {result && (
        <>
          <section className="panel">
            <h2>3. Objective metrics</h2>
            <MetricsPanel metrics={result.metrics} />
          </section>

          <section className="panel">
            <h2>4. Interview feedback</h2>
            <FeedbackPanel result={result} />
          </section>
        </>
      )}
    </main>
  )
}

export default App
