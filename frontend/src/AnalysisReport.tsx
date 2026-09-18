import type { ReactNode } from 'react'
import Icon from './Icon'
import type { AnalysisResponse, SpeechMetrics } from './types'

function MetricCard({
  label,
  value,
  unit,
  description,
  accent,
}: {
  label: string
  value: number
  unit: string
  description: string
  accent?: string
}) {
  return (
    <div className={`metric-card ${accent ?? ''}`}>
      <span className="metric-label">{label}</span>
      <div className="metric-number">
        {value}
        <span>{unit}</span>
      </div>
      <span className="metric-description">{description}</span>
    </div>
  )
}

function DetailedMetrics({ metrics }: { metrics: SpeechMetrics }) {
  const fillers = Object.entries(metrics.filler_word_breakdown)
  return (
    <details className="disclosure">
      <summary>
        <span>
          Behind the numbers
          <span className="summary-description">
            Word count, filler breakdown & pause details
          </span>
        </span>
        <Icon name="chevron" />
      </summary>
      <div className="disclosure-content">
        <dl className="detail-metrics">
          <div>
            <dt>Total words</dt>
            <dd>{metrics.word_count}</dd>
          </div>
          <div>
            <dt>Fillers per minute</dt>
            <dd>{metrics.filler_words_per_minute}</dd>
          </div>
          <div>
            <dt>Average pause</dt>
            <dd>{metrics.average_pause_seconds}s</dd>
          </div>
          <div>
            <dt>Longest pause</dt>
            <dd>{metrics.longest_pause_seconds}s</dd>
          </div>
        </dl>
        <h3 className="small-heading">Filler breakdown</h3>
        {fillers.length ? (
          <div className="chip-list">
            {fillers.map(([word, count]) => (
              <span className="breakdown-chip" key={word}>
                {word} <strong>{count}</strong>
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">No filler words detected.</p>
        )}
        <p className="field-hint">
          Metrics are based on transcript timestamps. Spoken duration excludes
          leading and trailing silence. Filler detection can also count words
          used meaningfully.
        </p>
      </div>
    </details>
  )
}

export default function AnalysisReport({
  result,
  playback,
}: {
  result: AnalysisResponse
  playback: ReactNode
}) {
  const { metrics, feedback } = result
  return (
    <div className="report">
      <section
        className="assessment-panel panel"
        aria-labelledby="assessment-heading"
      >
        <span className="section-icon">
          <Icon name="spark" />
        </span>
        <div>
          <span className="eyebrow">A fresh perspective</span>
          <h2 id="assessment-heading">Your coach’s take</h2>
          <p className="assessment">{feedback.overall_assessment}</p>
        </div>
      </section>
      <section aria-labelledby="metrics-heading">
        <div className="report-section-heading">
          <h2 id="metrics-heading">Your answer, by the numbers</h2>
          <span className="field-hint">Observations to help you improve</span>
        </div>
        <div className="metrics-grid">
          <MetricCard
            label="Speaking pace"
            value={metrics.words_per_minute}
            unit="wpm"
            description="Words per minute"
            accent="metric-card--mint"
          />
          <MetricCard
            label="Filler words"
            value={metrics.filler_word_count}
            unit="fillers"
            description="Detected in your answer"
            accent="metric-card--amber"
          />
          <MetricCard
            label="Noticeable pauses"
            value={metrics.noticeable_pause_count}
            unit="pauses"
            description="Gaps between spoken words"
            accent="metric-card--blue"
          />
          <MetricCard
            label="Spoken duration"
            value={metrics.duration_seconds}
            unit="sec"
            description="First word to last word"
          />
        </div>
      </section>
      {playback}
      <div className="feedback-columns">
        <section
          className="panel feedback-panel"
          aria-labelledby="strengths-heading"
        >
          <span className="eyebrow text-mint">Keep doing this</span>
          <h2 id="strengths-heading">What’s working</h2>
          <ul className="coaching-list strengths-list">
            {feedback.strengths.map((item, index) => (
              <li key={index}>
                <Icon name="check" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
        <section
          className="panel feedback-panel"
          aria-labelledby="improvements-heading"
        >
          <span className="eyebrow text-amber">Room to grow</span>
          <h2 id="improvements-heading">Make it stronger</h2>
          <ul className="coaching-list improvements-list">
            {feedback.improvements.map((item, index) => (
              <li key={index}>
                <Icon name="arrow" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section
        className="panel structure-panel"
        aria-labelledby="structure-heading"
      >
        <div className="section-heading">
          <span className="eyebrow">Give your answer a shape</span>
          <h2 id="structure-heading">A clearer way to tell your story</h2>
        </div>
        <ol className="structure-list">
          {feedback.suggested_structure.map((item, index) => (
            <li key={index}>
              <span className="structure-number" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <p>{item}</p>
            </li>
          ))}
        </ol>
      </section>
      <section
        className="next-steps-panel panel"
        aria-labelledby="next-steps-heading"
      >
        <div className="section-heading">
          <span className="eyebrow">Small changes, better answers</span>
          <h2 id="next-steps-heading">For your next take</h2>
        </div>
        <ul className="coaching-list">
          {feedback.next_steps.map((item, index) => (
            <li key={index}>
              <Icon name="arrow" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
      <div className="report-details">
        <details className="disclosure transcript">
          <summary>
            <span>
              Your transcript
              <span className="summary-description">
                The verbatim version of your answer
              </span>
            </span>
            <Icon name="chevron" />
          </summary>
          <div className="disclosure-content">
            <p>{result.transcript}</p>
          </div>
        </details>
        <DetailedMetrics metrics={metrics} />
      </div>
    </div>
  )
}
