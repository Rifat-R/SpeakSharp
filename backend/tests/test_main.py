import pytest

from backend.app.main import _is_supported_audio


@pytest.mark.parametrize(
    ("content_type", "filename", "expected"),
    [
        ("audio/webm", "recording.webm", True),
        ("audio/webm;codecs=opus", "recording.webm", True),
        ("video/webm", "recording.webm", True),
        ("application/octet-stream", "recording.webm", True),
        ("", "recording.webm", True),
        (None, "recording.webm", True),
        ("text/plain", "recording.webm", False),
        ("application/octet-stream", "recording.txt", False),
        ("", None, False),
    ],
)
def test_is_supported_audio(content_type: str | None, filename: str | None, expected: bool) -> None:
    assert _is_supported_audio(content_type, filename) is expected
