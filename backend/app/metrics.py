"""Objective speech metrics derived from a timestamped transcript.

Metrics are intentionally transcript-based. No acoustic analysis (pitch,
intonation, volume) is performed in this version.
"""

import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise

DEFAULT_PAUSE_THRESHOLD_SECONDS = 1.0

SINGLE_WORD_FILLERS = frozenset(
    {"um", "uh", "erm", "hmm", "er", "ah", "like", "basically", "actually"}
)

MULTI_WORD_FILLERS: tuple[tuple[str, ...], ...] = (
    ("you", "know"),
    ("i", "mean"),
)

_NON_ALPHANUMERIC = re.compile(r"[^a-z0-9']")


@dataclass(frozen=True)
class Word:
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class FillerOccurrence:
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class PauseOccurrence:
    start: float
    end: float
    duration_seconds: float


def compute_metrics(
    words: Sequence[Word],
    pause_threshold_seconds: float = DEFAULT_PAUSE_THRESHOLD_SECONDS,
) -> dict[str, object]:
    """Compute objective metrics from word-level timestamps."""
    normalized = sorted(words, key=lambda word: word.start)
    word_count = len(normalized)

    if normalized:
        spoken_start = normalized[0].start
        spoken_end = max(word.end for word in normalized)
        duration = max(0.0, spoken_end - spoken_start)
    else:
        duration = 0.0

    duration_minutes = duration / 60 if duration > 0 else 0.0
    words_per_minute = word_count / duration_minutes if duration_minutes > 0 else 0.0

    filler_occurrences = _find_fillers(normalized)
    filler_breakdown = _summarize_fillers(filler_occurrences)
    filler_word_count = len(filler_occurrences)
    filler_words_per_minute = filler_word_count / duration_minutes if duration_minutes > 0 else 0.0

    pauses = _find_pauses(normalized, pause_threshold_seconds)
    pause_durations = [pause.duration_seconds for pause in pauses]
    average_pause = sum(pause_durations) / len(pause_durations) if pauses else 0.0
    longest_pause = max(pause_durations) if pauses else 0.0

    return {
        "duration_seconds": round(duration, 1),
        "word_count": word_count,
        "words_per_minute": round(words_per_minute, 1),
        "filler_word_count": filler_word_count,
        "filler_words_per_minute": round(filler_words_per_minute, 1),
        "filler_word_breakdown": filler_breakdown,
        "filler_occurrences": [
            {
                "text": occurrence.text,
                "start": round(occurrence.start, 2),
                "end": round(occurrence.end, 2),
            }
            for occurrence in filler_occurrences
        ],
        "noticeable_pause_count": len(pauses),
        "average_pause_seconds": round(average_pause, 1),
        "longest_pause_seconds": round(longest_pause, 1),
        "pause_occurrences": [
            {
                "start": round(pause.start, 2),
                "end": round(pause.end, 2),
                "duration_seconds": round(pause.duration_seconds, 2),
            }
            for pause in pauses
        ],
    }


def _normalize(token: str) -> str:
    return _NON_ALPHANUMERIC.sub("", token.lower())


def _find_fillers(words: Sequence[Word]) -> list[FillerOccurrence]:
    tokens = [_normalize(word.text) for word in words]
    occurrences: list[FillerOccurrence] = []
    index = 0

    while index < len(tokens):
        matched_phrase = False
        for phrase in MULTI_WORD_FILLERS:
            length = len(phrase)
            if tuple(tokens[index : index + length]) == phrase:
                occurrences.append(
                    FillerOccurrence(
                        text=" ".join(phrase),
                        start=words[index].start,
                        end=words[index + length - 1].end,
                    )
                )
                index += length
                matched_phrase = True
                break

        if matched_phrase:
            continue

        token = tokens[index]
        if token in SINGLE_WORD_FILLERS:
            occurrences.append(
                FillerOccurrence(
                    text=token,
                    start=words[index].start,
                    end=words[index].end,
                )
            )
        index += 1

    return occurrences


def _summarize_fillers(occurrences: Sequence[FillerOccurrence]) -> dict[str, int]:
    counts: Counter[str] = Counter(occurrence.text for occurrence in occurrences)
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def _find_pauses(words: Sequence[Word], pause_threshold_seconds: float) -> list[PauseOccurrence]:
    """Return gaps between consecutive words that meet the pause threshold.

    Leading and trailing silence is excluded because only gaps between two
    spoken words are considered.
    """
    pauses: list[PauseOccurrence] = []
    for previous, current in pairwise(words):
        gap = current.start - previous.end
        if gap >= pause_threshold_seconds:
            pauses.append(
                PauseOccurrence(
                    start=previous.end,
                    end=current.start,
                    duration_seconds=gap,
                )
            )
    return pauses
