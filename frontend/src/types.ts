export interface SpeechMetrics {
  duration_seconds: number
  word_count: number
  words_per_minute: number
  filler_word_count: number
  filler_words_per_minute: number
  filler_word_breakdown: Record<string, number>
  noticeable_pause_count: number
  average_pause_seconds: number
  longest_pause_seconds: number
}

export interface InterviewFeedback {
  overall_assessment: string
  strengths: string[]
  improvements: string[]
  suggested_structure: string[]
  next_steps: string[]
}

export interface AnalysisResponse {
  transcript: string
  metrics: SpeechMetrics
  feedback: InterviewFeedback
}
