from backend.app.config import Settings


def test_cors_origin_list_trims_and_drops_empty_entries() -> None:
    settings = Settings(
        _env_file=None,
        cors_origins="http://a.test, http://b.test ,,http://c.test",
    )

    assert settings.cors_origin_list == [
        "http://a.test",
        "http://b.test",
        "http://c.test",
    ]


def test_cors_origin_list_defaults_to_local_vite_origins() -> None:
    settings = Settings(_env_file=None)

    assert settings.cors_origin_list == [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
