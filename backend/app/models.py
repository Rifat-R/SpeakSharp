from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str


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
    noticeable_pause_count: int = Field(
        description="Number of pauses at or above the noticeable pause threshold."
    )
    average_pause_seconds: float = Field(
        description="Average duration of noticeable pauses in seconds."
    )
    longest_pause_seconds: float = Field(description="Longest noticeable pause in seconds.")


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
