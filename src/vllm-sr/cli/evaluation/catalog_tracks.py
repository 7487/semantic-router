"""Track and evidence-method contracts for the evaluation catalog."""

from __future__ import annotations

import re
from collections.abc import Mapping
from types import MappingProxyType
from typing import Literal

from pydantic import field_validator, model_validator

from cli.evaluation.contracts import StrictModel
from cli.evaluation.metric_analysis_catalog import static_metric_ids_for_track
from cli.evaluation.reporting import EvidenceLevel, TrackID


class CatalogTrack(StrictModel):
    id: TrackID
    name: str
    description: str
    modes: tuple[Literal["replay", "live"], ...]
    metrics: tuple[str, ...]
    evidence_levels: tuple[EvidenceLevel, ...] = ()


_METHOD_GATE_TRACKS: Mapping[str, TrackID] = MappingProxyType(
    {
        "G2": "safety",
        "G4": "routing",
        "G6": "agentic",
        "G7": "capacity",
        "G8": "preference",
        "G9": "preference",
    }
)


class CatalogMethod(StrictModel):
    """One server-derived evidence method shown by catalog-driven readiness UI."""

    id: str
    track_id: TrackID
    qualified_gate_ids: tuple[str, ...]
    evidence_source: Literal[
        "diagnostic_fixture",
        "live_runtime",
        "normalized_import",
        "server_brokered_live",
        "live_production",
    ]
    status: Literal["qualified", "configured", "data_required"]
    reason: str | None = None

    @field_validator("id")
    @classmethod
    def portable_id(cls, value: str) -> str:
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", value) is None:
            raise ValueError("catalog method id must be portable")
        return value

    @model_validator(mode="after")
    def validate_readiness(self) -> CatalogMethod:
        if len(self.qualified_gate_ids) != len(set(self.qualified_gate_ids)) or any(
            _METHOD_GATE_TRACKS.get(gate_id) != self.track_id
            for gate_id in self.qualified_gate_ids
        ):
            raise ValueError("catalog method gates must be unique and track-owned")
        if self.status == "data_required":
            if self.reason is None or not self.reason.strip():
                raise ValueError("data-required catalog method needs an exact reason")
        elif self.reason is not None:
            raise ValueError("ready catalog methods cannot carry an unavailable reason")
        if self.status == "qualified":
            raise ValueError(
                "method qualification requires server-owned native execution provenance"
            )
        if self.evidence_source == "normalized_import" and (
            self.status != "configured" or self.qualified_gate_ids
        ):
            raise ValueError(
                "normalized imports are configured exploratory methods without gates"
            )
        if self.evidence_source == "server_brokered_live" and (
            self.status != "configured"
            or self.track_id != "routing"
            or self.qualified_gate_ids != ("G4",)
        ):
            raise ValueError(
                "server-brokered declared-shift methods qualify only routing G4"
            )
        return self


CATALOG_TRACKS = (
    CatalogTrack(
        id="routing",
        name="Routing",
        description="Recipe decisions, coverage, abstention, fallback, and oracle regret.",
        modes=("replay", "live"),
        metrics=static_metric_ids_for_track("routing"),
        evidence_levels=("E0", "E3", "E4"),
    ),
    CatalogTrack(
        id="model_pool",
        name="Model pool",
        description="Arm quality, complementarity, unique wins, and pool oracle quality.",
        modes=("replay", "live"),
        metrics=static_metric_ids_for_track("model_pool"),
        evidence_levels=("E0", "E4"),
    ),
    CatalogTrack(
        id="joint",
        name="Routing + pool",
        description="Realized system utility, oracle regret, latency, reliability, and cost.",
        modes=("replay", "live"),
        metrics=static_metric_ids_for_track("joint"),
        evidence_levels=("E0", "E5"),
    ),
    CatalogTrack(
        id="agentic",
        name="Agentic",
        description=(
            "Task quality, trajectory and explicit tool-policy integrity, privacy, complete cost, "
            "and separately qualified recovery continuity."
        ),
        modes=("replay", "live"),
        metrics=static_metric_ids_for_track("agentic"),
        evidence_levels=("E0", "E5"),
    ),
    CatalogTrack(
        id="multimodal",
        name="Multimodal",
        description="Capability-aware routing, grounding quality, and privacy signals.",
        modes=("replay", "live"),
        metrics=static_metric_ids_for_track("multimodal"),
        evidence_levels=("E0", "E4", "E5"),
    ),
    CatalogTrack(
        id="preference",
        name="Preference",
        description="Offline preference agreement and propensity-qualified online evidence.",
        modes=("replay", "live"),
        metrics=static_metric_ids_for_track("preference"),
        evidence_levels=("E0", "E4", "E5"),
    ),
    CatalogTrack(
        id="safety",
        name="Safety",
        description="Policy adherence, blocking correctness, privacy, and unsafe regressions.",
        modes=("replay", "live"),
        metrics=static_metric_ids_for_track("safety"),
        evidence_levels=("E0", "E3", "E4"),
    ),
    CatalogTrack(
        id="capacity",
        name="Capacity",
        description=(
            "Repeated closed-loop throughput, tail latency, statistical error "
            "bounds, stability, SLO headroom, and measurement cost."
        ),
        modes=("replay", "live"),
        metrics=static_metric_ids_for_track("capacity"),
        evidence_levels=("E0", "E5"),
    ),
)
