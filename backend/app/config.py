from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

MINIMUM_SESSION_SECRET_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: str = "development"
    elevenlab_api_key: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    transcription_model: str = "scribe_v2"

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    max_audio_bytes: int = 25 * 1024 * 1024
    pause_threshold_seconds: float = 1.0
    max_question_length: int = 500

    demo_password: str = ""
    session_secret: str = ""
    session_max_age_seconds: int = 24 * 60 * 60
    session_https_only: bool = False

    @property
    def is_production(self) -> bool:
        return self.app_env.strip().lower() == "production"

    @property
    def auth_enabled(self) -> bool:
        """Authentication is always on in production and opt-in elsewhere."""
        return self.is_production or bool(self.demo_password)

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @model_validator(mode="after")
    def _validate_production(self) -> "Settings":
        if not self.is_production:
            return self
        if not self.demo_password:
            raise ValueError("DEMO_PASSWORD must be set when APP_ENV=production.")
        if not self.session_secret:
            raise ValueError("SESSION_SECRET must be set when APP_ENV=production.")
        if len(self.session_secret) < MINIMUM_SESSION_SECRET_LENGTH:
            raise ValueError(
                "SESSION_SECRET must be at least "
                f"{MINIMUM_SESSION_SECRET_LENGTH} characters when APP_ENV=production."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
