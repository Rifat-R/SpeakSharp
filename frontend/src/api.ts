import type { AnalysisResponse } from './types'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export class ApiError extends Error {}

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
      body: form,
    })
  } catch {
    throw new ApiError(
      'Could not reach the analysis server. Make sure the backend is running.',
    )
  }

  if (!response.ok) {
    let detail = 'Something went wrong while analyzing the recording.'
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
      // Keep the generic message when the response is not JSON.
    }
    throw new ApiError(detail)
  }

  return (await response.json()) as AnalysisResponse
}
