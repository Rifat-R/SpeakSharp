import type { AnalysisResponse } from './types'

const API_URL =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? '' : 'http://localhost:8000')

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function readError(response: Response, fallback: string): Promise<ApiError> {
  let detail = fallback
  try {
    const body: unknown = await response.json()
    if (
      body &&
      typeof body === 'object' &&
      'detail' in body &&
      typeof body.detail === 'string'
    ) {
      detail = body.detail
    }
  } catch {
    // Keep the fallback message when the response is not JSON.
  }
  return new ApiError(detail, response.status)
}

export async function login(password: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password }),
    })
  } catch {
    throw new ApiError('Could not reach the server. Check your connection.', 0)
  }

  if (!response.ok) {
    throw await readError(response, 'Incorrect password.')
  }
}

export async function analyzeAnswer(
  question: string,
  audio: Blob,
  filename: string,
): Promise<AnalysisResponse> {
  const form = new FormData()
  form.append('question', question)
  form.append('audio', audio, filename)

  let response: Response
  try {
    response = await fetch(`${API_URL}/api/analyze`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
  } catch {
    throw new ApiError(
      'Could not reach the analysis server. Make sure the backend is running.',
      0,
    )
  }

  if (!response.ok) {
    throw await readError(
      response,
      'Something went wrong while analyzing the recording.',
    )
  }

  return (await response.json()) as AnalysisResponse
}
