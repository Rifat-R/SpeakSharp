from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str


class FillerOccurrence(BaseModel):
    text: str = Field(description="The detected filler word or phrase.")
    start: float = Field(description="Start time in seconds on the audio timeline.")
    end: float = Field(description="End time in seconds on the audio timeline.")


class PauseOccurrence(BaseModel):
    start: float = Field(description="Start time of the pause in seconds.")
    end: float = Field(description="End time of the pause in seconds.")
    duration_seconds: float = Field(description="Length of the pause in seconds.")


class SpeechMetrics(BaseModel):
    duration_seconds: float = Field(
        description="Spoken duration in seconds, excluding leading and trailing silence."
    )
    word_count: int = Field(description="Number of transcribed words.")
    words_per_minute: float = Field(description="Speaking pace in words per minute.")
    filler_word_count: int = Field(description="Total number of detected filler words.")
    filler_words_per_minute: float = Field(description="Filler words spoken per minute.")
    filler_word_breakdown: dict[str, int] = Field(
        description="Count of each detected filler word or phrase."
    )
    filler_occurrences: list[FillerOccurrence] = Field(
        description="Each filler word with its position on the audio timeline."
    )
    noticeable_pause_count: int = Field(
        description="Number of pauses at or above the noticeable pause threshold."
    )
    average_pause_seconds: float = Field(
        description="Average duration of noticeable pauses in seconds."
    )
    longest_pause_seconds: float = Field(description="Longest noticeable pause in seconds.")
    pause_occurrences: list[PauseOccurrence] = Field(
        description="Each noticeable pause with its position on the audio timeline."
    )


class InterviewFeedback(BaseModel):
    overall_assessment: str = Field(
        description="Two to three sentence summary of how the answer landed."
    )
    strengths: list[str] = Field(
        description="Specific things the candidate did well in this answer."
    )
    improvements: list[str] = Field(
        description="Specific, actionable areas to improve in this answer."
    )
    suggested_structure: list[str] = Field(
        description="An outline the candidate could use to restructure the answer."
    )
    next_steps: list[str] = Field(
        description="Two or three concrete practice actions for the candidate."
    )


class AnalysisResponse(BaseModel):
    transcript: str
    metrics: SpeechMetrics
    feedback: InterviewFeedback
