"""Catalog projection and planning for clean-break v2 evaluation methods."""

from __future__ import annotations

from collections.abc import Iterable

from cli.evaluation.method_contract_v2 import EvaluationMethodPlugin


def runnable_gradeable_live_methods(
    methods: Iterable[EvaluationMethodPlugin], *, selected_tracks: Iterable[str]
) -> tuple[EvaluationMethodPlugin, ...]:
    """Expose only complete, grader-backed methods covering selected live tracks.

    Incomplete declarations are an admission error rather than an optimistic
    catalog entry.  This is deliberately not a fallback path for v1 methods.
    """

    tracks = frozenset(selected_tracks)
    if not tracks:
        raise ValueError("v2 live method planning requires selected tracks")
    admitted: list[EvaluationMethodPlugin] = []
    covered: set[str] = set()
    for method in methods:
        if (
            method.status != "native-qualified"
            or not method.live_input_complete
            or not method.live_grader
        ):
            continue
        method_tracks = frozenset(method.live_tracks)
        if method_tracks.intersection(tracks):
            admitted.append(method)
            covered.update(method_tracks.intersection(tracks))
    missing = sorted(tracks - covered)
    if missing:
        raise ValueError(
            "no runnable and gradeable v2 method covers: " + ", ".join(missing)
        )
    return tuple(admitted)
