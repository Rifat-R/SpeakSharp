export const PRESET_QUESTIONS = [
  { question: 'Tell me about yourself.', category: 'The introduction' },
  {
    question: 'Why are you interested in this role?',
    category: 'The motivation',
  },
  {
    question: 'Describe a difficult problem you solved.',
    category: 'The challenge',
  },
  {
    question: 'Tell me about a time you handled conflict.',
    category: 'The collaboration',
  },
]

export function formatClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60)
    .toString()
    .padStart(2, '0')}`
}
