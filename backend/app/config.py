from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    elevenlab_api_key: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    transcription_model: str = "scribe_v2"

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    max_audio_bytes: int = 25 * 1024 * 1024
    pause_threshold_seconds: float = 1.0
    max_question_length: int = 500

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
