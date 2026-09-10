from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(Path(__file__).resolve().parents[2] / ".env", Path(__file__).resolve().parents[1] / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "FinMate API"
    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    market_provider: str = "auto"
    market_cache_ttl_seconds: int = 60
    database_host: str = "127.0.0.1"
    database_port: int = 5432
    database_name: str = "finmate"
    database_user: str = "finmate"
    database_password: SecretStr = SecretStr("finmate-local")
    cors_origins: str = "http://localhost:5173,http://localhost:8080"
    openrouter_api_key: SecretStr | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model: str = "qwen/qwen3.5-flash-02-23"
    openrouter_fallback_model: str = "deepseek/deepseek-v3.2"
    openrouter_http_referer: str = "http://localhost:8080"
    openrouter_app_title: str = "FinMate"

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def openrouter_configured(self) -> bool:
        return bool(self.openrouter_api_key and self.openrouter_api_key.get_secret_value().strip())

    @property
    def database_dsn(self) -> str:
        return (
            f"host={self.database_host} port={self.database_port} dbname={self.database_name} "
            f"user={self.database_user} password={self.database_password.get_secret_value()}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
