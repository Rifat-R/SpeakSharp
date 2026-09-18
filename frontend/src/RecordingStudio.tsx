import { useEffect, useState, type ReactNode, type Ref } from 'react'
import Icon from './Icon'
import { formatClock } from './practice'

const REQUESTING_UI_DELAY_MS = 250

export type Phase =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'ready'
  | 'analyzing'
  | 'complete'
  | 'error'

interface RecordingStudioProps {
  phase: Phase
  question: string
  elapsed: number
  maxSeconds: number
  hasRecording: boolean
  error: string | null
  canRecord: boolean
  playback: ReactNode
  actionRef: Ref<HTMLButtonElement>
  errorRef: Ref<HTMLDivElement>
  onStart: () => void
  onStop: () => void
  onAnalyze: () => void
  onReset: () => void
}

export default function RecordingStudio({
  phase,
  question,
  elapsed,
  maxSeconds,
  hasRecording,
  error,
  canRecord,
  playback,
  actionRef,
  errorRef,
  onStart,
  onStop,
  onAnalyze,
  onReset,
}: RecordingStudioProps) {
  const isRecording = phase === 'recording'
  const busy = phase === 'requesting' || phase === 'analyzing'
  const [showRequesting, setShowRequesting] = useState(false)
  const [trackedPhase, setTrackedPhase] = useState(phase)
  if (trackedPhase !== phase) {
    setTrackedPhase(phase)
    setShowRequesting(false)
  }
  const requesting = phase === 'requesting' && showRequesting
  const showBusy = phase === 'analyzing' || requesting

  useEffect(() => {
    if (phase !== 'requesting') return
    const timeout = window.setTimeout(
      () => setShowRequesting(true),
      REQUESTING_UI_DELAY_MS,
    )
    return () => window.clearTimeout(timeout)
  }, [phase])

  const status =
    phase === 'requesting'
      ? 'Waiting for microphone access'
      : isRecording
        ? 'Recording in progress'
        : phase === 'analyzing'
          ? 'Preparing your feedback'
          : hasRecording
            ? 'Your recording is ready'
            : 'Ready when you are'

  return (
    <section
      className={`studio panel ${isRecording ? 'studio--recording' : ''}`}
      aria-labelledby="studio-heading"
    >
      <div className="studio-topline">
        <span className="eyebrow">
          02 / {hasRecording ? 'Listen & reflect' : 'Find your voice'}
        </span>
        <span
          className={`status-badge ${isRecording ? 'status-badge--recording' : ''}`}
        >
          <span className={showBusy ? 'spinner' : 'status-dot'} />
          {isRecording
            ? 'Recording'
            : showBusy
              ? 'One moment'
              : hasRecording
                ? 'Ready to review'
                : 'Practice studio'}
        </span>
      </div>
      <div className="studio-question">
        <span className="small-label">Your interview question</span>
        <h2 id="studio-heading">
          {question.trim() || 'What would you like to practice?'}
        </h2>
      </div>

      {!hasRecording && (
        <div className="recording-stage">
          <div
            className={`mic-orbit ${isRecording ? 'is-recording' : ''}`}
            aria-hidden="true"
          >
            <div className="mic-disc">
              <Icon name="mic" />
            </div>
          </div>
          <div
            className="recording-clock"
            aria-label={`${formatClock(elapsed)} elapsed, ${formatClock(maxSeconds)} maximum`}
          >
            {formatClock(elapsed)}
            <span> / {formatClock(maxSeconds)}</span>
          </div>
          <p className="recording-caption">
            {isRecording
              ? 'Take your time. You’ve got this.'
              : requesting
                ? 'Allow microphone access in your browser to begin.'
                : 'A deep breath. Then, just be yourself.'}
          </p>
          <div
            className="recording-progress"
            role="progressbar"
            aria-label="Recording time"
            aria-valuemin={0}
            aria-valuemax={maxSeconds}
            aria-valuenow={Math.min(elapsed, maxSeconds)}
          >
            <span
              style={{ width: `${Math.min(elapsed / maxSeconds, 1) * 100}%` }}
            />
          </div>
        </div>
      )}

      {hasRecording && <div className="studio-playback">{playback}</div>}

      {phase === 'analyzing' && (
        <div className="analysis-progress">
          <span className="spinner" />
          <div>
            <strong>A little reflection goes a long way.</strong>
            <p>
              Transcribing your answer and preparing your coaching feedback.
              This may take a moment.
            </p>
          </div>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      {error && (
        <div
          className="error-message"
          role="alert"
          ref={errorRef}
          tabIndex={-1}
        >
          <strong>
            {hasRecording
              ? 'Let’s give that another try.'
              : 'We couldn’t start recording.'}
          </strong>
          <p>{error}</p>
        </div>
      )}

      <div className="studio-actions">
        {!hasRecording && !isRecording && (
          <button
            ref={actionRef}
            className="button primary"
            type="button"
            onClick={onStart}
            disabled={!canRecord || busy}
          >
            {showBusy ? <span className="spinner" /> : <Icon name="mic" />}
            {requesting ? 'Connecting microphone…' : 'Start recording'}
            {!showBusy && <Icon name="arrow" />}
          </button>
        )}
        {isRecording && (
          <button
            ref={actionRef}
            className="button danger"
            type="button"
            onClick={onStop}
          >
            <Icon name="stop" />
            Stop recording
          </button>
        )}
        {hasRecording && (
          <>
            <button
              ref={actionRef}
              className="button primary"
              type="button"
              onClick={onAnalyze}
              disabled={busy}
            >
              {busy ? <span className="spinner" /> : <Icon name="spark" />}
              {busy
                ? 'Analyzing your answer…'
                : error
                  ? 'Try analysis again'
                  : 'Analyze answer'}
              {!busy && <Icon name="arrow" />}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={onReset}
              disabled={busy}
            >
              <Icon name="retry" />
              Record again
            </button>
          </>
        )}
      </div>
      <div className="studio-footnote">
        <Icon name="clock" />
        <span>
          {isRecording
            ? 'Recording stops automatically at 2 minutes'
            : hasRecording
              ? 'Listen back, then discover what you can build on'
              : 'Up to 2 minutes · Just you and your next great answer'}
        </span>
      </div>
    </section>
  )
}
