"""Load the canonical, package-safe inventory of audited research benchmarks.

The manifest ships with ``cli.evaluation``. The Go control plane embeds a
byte-for-byte mirrored copy, protected by an explicit parity test. It is about
readiness, source parity, and evidence ceilings; it never asserts native runs.
"""

from __future__ import annotations

import json
from importlib.resources import files
from types import MappingProxyType
from typing import Any

INVENTORY_SCHEMA_VERSION = "evaluation-research-benchmark-inventory.v1"
_EXPECTED_BENCHMARK_COUNT = 13
_EXPECTED_IDS = frozenset(
    {
        "routerarena",
        "routejudge-orbit",
        "coderouterbench",
        "llmrouterbench",
        "routereval",
        "routerbench",
        "xroutebench",
        "twinrouterbench",
        "mmr-bench",
        "acebench",
        "continuity-bench",
        "fusionfactory",
        "r2-router",
    }
)


def _load_inventory() -> tuple[dict[str, Any], ...]:
    try:
        document = json.loads(
            files("cli.evaluation")
            .joinpath("golden/research_benchmark_inventory.v1.json")
            .read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"read research benchmark inventory: {exc}") from exc
    if (
        not isinstance(document, dict)
        or document.get("schema_version") != INVENTORY_SCHEMA_VERSION
        or not isinstance(document.get("benchmarks"), list)
    ):
        raise RuntimeError("research benchmark inventory has an invalid envelope")
    benchmarks = tuple(document["benchmarks"])
    ids = {item.get("adapter_id") for item in benchmarks if isinstance(item, dict)}
    if len(benchmarks) != _EXPECTED_BENCHMARK_COUNT or ids != _EXPECTED_IDS:
        raise RuntimeError(
            "research benchmark inventory must contain exactly the audited thirteen"
        )
    for item in benchmarks:
        if not isinstance(item, dict) or not isinstance(
            item.get("import_tracks"), list
        ):
            raise RuntimeError(
                "research benchmark inventory has an invalid benchmark entry"
            )
        if (
            item.get("status") == "native-qualified"
            or item.get("native_parity") == "native"
            or item.get("evidence_ceiling") != "E0"
        ):
            raise RuntimeError(
                "research benchmark inventory overstates unqualified evidence"
            )
        if item.get("status") == "blocked" and item["import_tracks"]:
            raise RuntimeError("blocked research benchmark advertises an import track")
    return benchmarks


RESEARCH_BENCHMARKS = _load_inventory()
RESEARCH_BENCHMARKS_BY_ADAPTER = MappingProxyType(
    {item["adapter_id"]: MappingProxyType(item) for item in RESEARCH_BENCHMARKS}
)


def research_benchmark(adapter_id: str) -> MappingProxyType:
    try:
        return RESEARCH_BENCHMARKS_BY_ADAPTER[adapter_id]
    except KeyError as exc:
        raise ValueError(f"unknown research benchmark: {adapter_id}") from exc
