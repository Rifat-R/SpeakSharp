# SpeakSharp Initial Implementation Plan

## Goal

Build a small web application that lets a user answer an interview question in a one-to-two-minute audio recording, transcribes the response, calculates objective speaking metrics, and returns actionable interview feedback.

The initial version will support English only, retain no recordings or results, and exclude intonation, pitch, and other acoustic analysis.

## Technical Decisions

- Frontend: React, TypeScript, Vite, and the browser `MediaRecorder` API
- Backend: FastAPI and Python, with dependencies managed by `uv`
- Transcription: ElevenLabs Scribe v2 with word-level timestamps
- Objective analysis: Python calculations based on transcript words and timestamps
- Qualitative feedback: OpenAI Responses API with structured output
- Persistence: None; audio and results remain in memory for the duration of a request
- Interview prompts: A small preset list plus a custom question option
- Language: English only
- OpenAI model: Configured through `OPENAI_MODEL` with a documented default

## Project Structure

```text
SpeakSharp/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── models.py
│   │   ├── metrics.py
│   │   └── services.py
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api.ts
│   │   ├── types.ts
│   │   └── styles.css
│   └── package.json
├── plans/
├── .env.example
├── .gitignore
├── pyproject.toml
└── README.md
```

The exact backend module split may be reduced if keeping related logic together produces a simpler implementation.

## User Flow

1. The user selects a preset interview question or enters a custom question.
2. The browser requests microphone permission.
3. The user records an answer while seeing an elapsed timer.
4. Recording stops automatically after two minutes, or earlier when the user clicks stop.
5. The user can play back the recording, discard it, or submit it for analysis.
6. The frontend uploads the question and audio as multipart form data.
7. The backend transcribes the audio and calculates speech metrics.
8. OpenAI evaluates the answer using the question, transcript, and objective metrics.
9. The frontend displays the transcript, metrics, strengths, and improvement suggestions.

## Interview Questions

The initial preset list will include:

- Tell me about yourself.
- Why are you interested in this role?
- Describe a difficult problem you solved.
- Tell me about a time you handled conflict.

The user can switch to a custom question and enter their own prompt.

## Frontend

### Recording

- Use `navigator.mediaDevices.getUserMedia` to request microphone access.
- Use `MediaRecorder.isTypeSupported` to select a compatible format.
- Prefer `audio/webm;codecs=opus` and fall back to another browser-supported format.
- Keep audio chunks in memory and create a `Blob` when recording stops.
- Display an elapsed timer and enforce a two-minute maximum.
- Stop microphone tracks when recording ends or the component is disposed.

### Interface States

The page will explicitly represent these states:

- Ready to record
- Requesting microphone permission
- Recording
- Recording ready for playback
- Uploading and analyzing
- Analysis complete
- Error with retry guidance

### Results

Display results in three clear sections:

- Transcript
- Objective metrics
- Interview feedback

The initial design will be a usable, responsive single-page layout rather than a full design system. Controls will have accessible labels, visible focus styles, and text status indicators.

## Backend API

### `GET /api/health`

Returns a small response confirming that the API is running.

### `POST /api/analyze`

Accepts multipart form data containing:

- `question`: The selected or custom interview question
- `audio`: The browser recording

Processing steps:

1. Validate the question, content type, and file size.
2. Read the uploaded audio without permanently storing it.
3. Send the audio to ElevenLabs Scribe v2 with English and word timestamps enabled.
4. Normalize the transcript and timestamp data.
5. Calculate objective speech metrics.
6. Request structured qualitative feedback from OpenAI.
7. Return one typed JSON response.

Example response shape:

```json
{
  "transcript": "I am a software engineer...",
  "metrics": {
    "duration_seconds": 72.4,
    "word_count": 143,
    "words_per_minute": 118.5,
    "filler_word_count": 5,
    "filler_words_per_minute": 4.1,
    "filler_word_breakdown": {
      "um": 3,
      "like": 2
    },
    "noticeable_pause_count": 2,
    "average_pause_seconds": 1.3,
    "longest_pause_seconds": 2.1
  },
  "feedback": {
    "overall_assessment": "A clear introduction that would benefit from more focus.",
    "strengths": ["Explains current experience clearly"],
    "improvements": ["Connect experience more directly to the target role"],
    "suggested_structure": ["Present", "Relevant past", "Why this role"],
    "next_steps": ["Practice a version under 90 seconds"]
  }
}
```

## Objective Speech Metrics

Metrics will be derived from the timestamped transcript rather than from raw acoustic features.

- Speaking duration
- Total word count
- Words per minute
- Filler-word count
- Filler-word breakdown
- Filler words per minute
- Noticeable pause count
- Average noticeable pause duration
- Longest pause duration

Initial filler detection will use an explicit English phrase list such as `um`, `uh`, `erm`, and repeated discourse fillers where transcript normalization allows reliable matching.

A noticeable pause threshold will be documented and kept configurable in code. Leading and trailing silence will not be counted as pauses between words.

## Qualitative Feedback

OpenAI will receive:

- The interview question
- The verbatim transcript
- The calculated objective metrics
- A concise evaluation rubric

The rubric will evaluate:

- Relevance to the question
- Structure and logical flow
- Specificity and supporting examples
- Clarity
- Conciseness

The response will be parsed into a Pydantic model containing:

- A short overall assessment
- Strengths
- Specific improvement areas
- A suggested answer structure
- Two or three concrete next steps

The prompt will instruct the model not to invent details or claim the speaker said something absent from the transcript.

## Configuration

Local `.env` values:

```dotenv
ELEVENLAB_API_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=
```

Optional frontend configuration:

```dotenv
VITE_API_URL=http://localhost:8000
```

The backend will configure CORS for the local Vite development origin. `.env` will remain ignored, and `.env.example` will contain names only.

## Validation and Errors

The backend will return clear errors for:

- Missing or empty audio
- Missing question
- Unsupported media type
- Oversized uploads
- Unintelligible or empty transcripts
- ElevenLabs authentication or transcription failures
- OpenAI authentication, rate-limit, or response failures

The frontend will convert these into short user-facing messages with an appropriate retry action. Provider credentials and raw provider errors will not be exposed to the browser.

## Testing

### Backend

- Unit tests for metric calculations
- Tests for empty and very short transcripts
- Tests for filler normalization and pause thresholds
- API tests with ElevenLabs and OpenAI calls mocked
- Validation tests for missing, invalid, and oversized uploads

### Frontend

- TypeScript type checking
- Production build verification
- Manual testing of microphone permission handling
- Manual testing of record, stop, playback, discard, submit, and retry flows
- Manual testing of the two-minute automatic stop
- Basic mobile and desktop layout verification

## Documentation

The root README will document:

- Prerequisites
- Installing backend dependencies with `uv`
- Installing frontend dependencies
- Required environment variables
- Running both development servers
- Running tests and builds
- Current metrics and their limitations
- The fact that recordings and results are not persisted

## Out of Scope

- User accounts
- A database or analysis history
- Saved or shared recordings
- Streaming transcription
- Multi-speaker interviews
- Intonation, pitch, volume, or sentiment analysis
- Job-description-specific scoring
- Automated rewritten answers that invent user experience
- Production deployment and background job infrastructure

## Implementation Order

1. Add repository configuration, environment examples, and backend dependencies.
2. Implement and test transcript-based metrics.
3. Implement ElevenLabs transcription and OpenAI structured feedback services.
4. Add the FastAPI health and analysis endpoints with validation and error handling.
5. Scaffold the React and TypeScript frontend.
6. Implement recording, playback, upload, and result display states.
7. Verify the complete browser-to-provider flow with local credentials.
8. Finish README instructions and document limitations.

## Completion Criteria

- A user can record an English answer of up to two minutes.
- The recording can be reviewed and submitted from the browser.
- The API returns a verbatim transcript, objective metrics, and structured feedback.
- No audio, transcript, or feedback is persisted by the application.
- Provider failures result in useful, non-sensitive error messages.
- Backend tests pass, and the frontend type check and production build succeed.
