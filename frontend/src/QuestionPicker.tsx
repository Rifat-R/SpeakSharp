import Icon from './Icon'
import { PRESET_QUESTIONS } from './practice'

interface QuestionPickerProps {
  question: string
  customQuestion: string
  useCustom: boolean
  disabled: boolean
  onSelect: (question: string) => void
  onCustomSelect: () => void
  onCustomChange: (question: string) => void
}

export default function QuestionPicker({
  question,
  customQuestion,
  useCustom,
  disabled,
  onSelect,
  onCustomSelect,
  onCustomChange,
}: QuestionPickerProps) {
  return (
    <section className="question-panel" aria-labelledby="question-heading">
      <div className="section-heading">
        <span className="eyebrow">01 / Set the scene</span>
        <h2 id="question-heading">Choose your question</h2>
        <p>A familiar prompt. A fresh opportunity.</p>
      </div>
      <fieldset className="question-list" disabled={disabled}>
        <legend className="sr-only">Interview question</legend>
        {PRESET_QUESTIONS.map((preset, index) => (
          <label
            key={preset.question}
            className={`question-card ${!useCustom && question === preset.question ? 'is-selected' : ''}`}
          >
            <input
              type="radio"
              name="question"
              value={preset.question}
              checked={!useCustom && question === preset.question}
              onChange={() => onSelect(preset.question)}
            />
            <span className="question-number" aria-hidden="true">
              0{index + 1}
            </span>
            <span className="question-copy">
              <span className="question-category">{preset.category}</span>
              <span className="question-title">{preset.question}</span>
            </span>
            <span className="selection-indicator" aria-hidden="true">
              <Icon name="check" />
            </span>
          </label>
        ))}
        <label
          className={`question-card question-card--custom ${useCustom ? 'is-selected' : ''}`}
        >
          <input
            type="radio"
            name="question"
            checked={useCustom}
            onChange={onCustomSelect}
          />
          <span className="question-number" aria-hidden="true">
            +
          </span>
          <span className="question-copy">
            <span className="question-title">Make it your own</span>
            <span className="question-category">
              Practice a custom question
            </span>
          </span>
          <span className="selection-indicator" aria-hidden="true">
            <Icon name="check" />
          </span>
        </label>
        {useCustom && (
          <div className="custom-question-wrap">
            <label htmlFor="custom-question">Your interview question</label>
            <textarea
              id="custom-question"
              value={customQuestion}
              maxLength={500}
              rows={3}
              placeholder="What would you like to practice?"
              onChange={(event) => onCustomChange(event.target.value)}
              aria-describedby="question-length"
            />
            <span className="field-hint" id="question-length">
              {customQuestion.length} / 500 characters
            </span>
          </div>
        )}
      </fieldset>
      {disabled && (
        <p className="field-hint locked-hint">
          Your question stays with this recording. Start a new take to change
          it.
        </p>
      )}
    </section>
  )
}
