import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError } from './api'
import Icon from './Icon'

interface PasswordDialogProps {
  open: boolean
  onCancel: () => void
  onSubmit: (password: string) => Promise<void>
}

export default function PasswordDialog({
  open,
  onCancel,
  onSubmit,
}: PasswordDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      setPassword('')
      setError(null)
      setSubmitting(false)
      dialog.showModal()
      inputRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!password || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(password)
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Something went wrong. Please try again.',
      )
      setSubmitting(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="password-dialog"
      aria-labelledby="password-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!submitting) onCancel()
      }}
    >
      <form className="password-dialog-form" onSubmit={handleSubmit}>
        <span className="eyebrow intro-eyebrow">Private demo</span>
        <h2 id="password-dialog-title">Enter the demo password</h2>
        <p className="password-dialog-lede">
          Analysis uses paid speech and language models, so this step keeps the
          demo from being used anonymously. Your recording stays on this page.
        </p>
        <div className="password-dialog-field">
          <label htmlFor="demo-password">Password</label>
          <input
            ref={inputRef}
            id="demo-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'password-error' : undefined}
          />
        </div>
        {error && (
          <p id="password-error" className="auth-error" role="alert">
            <Icon name="lock" />
            <span>{error}</span>
          </p>
        )}
        <div className="password-dialog-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={submitting || !password}
          >
            {submitting ? (
              <>
                <span className="spinner" />
                Checking…
              </>
            ) : (
              <>
                Unlock and analyze
                <Icon name="arrow" />
              </>
            )}
          </button>
        </div>
      </form>
    </dialog>
  )
}
