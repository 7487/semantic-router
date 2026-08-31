from __future__ import annotations

import json
from importlib.resources import files

import pytest
from cli.evaluation.canonical import digest_value, sha256_digest
from cli.evaluation.catalog import get_catalog
from cli.evaluation.constants import SCHEMA_VERSION
from cli.evaluation.contracts import (
    ArtifactRef,
    EvaluationTarget,
    RunManifest,
    WorkloadSnapshot,
)
from cli.evaluation.executor_contracts import BUILTIN_EXECUTOR_CONTRACTS
from cli.evaluation.manifest_identity import seal_manifest_fields
from cli.evaluation.target_capabilities import DEFAULT_TARGET_REGISTRY
from pydantic import ValidationError


def _golden(name: str) -> dict[str, object]:
    path = files("cli.evaluation").joinpath("golden", name)
    return json.loads(path.read_text(encoding="utf-8"))


def test_runtime_catalog_tracks_are_capability_dependent() -> None:
    matrix = _golden("capability-matrix.json")
    assert matrix["schema_version"] == SCHEMA_VERSION
    for case in matrix["cases"]:
        if not case["valid"]:
            with pytest.raises(ValidationError):
                EvaluationTarget.model_validate(case["target"])
            continue
        target = EvaluationTarget.model_validate(case["target"])
        catalog = get_catalog(
            generated_at=False,
            router_api_url=target.router_api_url,
            envoy_url=target.envoy_url,
            agent_task_ledger=target.agent_task_ledger,
            fault_recovery_ledger=target.fault_recovery_ledger,
            hard_policy_ledger=target.hard_policy_ledger,
            production_experiment_ledger=target.production_experiment_ledger,
            mixture=target.mixture,
            backend_topology_digest=target.backend_topology_digest,
        )
        if target.mixture is None:
            assert tuple(item.id for item in catalog.targets) == (
                "fixture",
                "benchmark-source",
            )
            assert case["expected_tracks"] == []
            continue
        mixture_target = next(
            item for item in catalog.targets if item.id == target.mixture.id
        )
        assert mixture_target.track_ids == tuple(case["expected_tracks"]), case["name"]
        assert mixture_target.healthy is bool(case["expected_tracks"]), case["name"]
        assert mixture_target.mixture == target.mixture.public_summary()


def test_live_manifest_requires_the_current_runtime_endpoint_contract() -> None:
    payload = _golden("live-manifest.json")
    frozen_mixture = dict(dict(payload["target"])["mixture"])
    mixture_id = frozen_mixture["id"]
    payload = seal_manifest_fields(
        {
            **{
                key: value for key, value in payload.items() if key != "manifest_digest"
            },
            "mode": "live",
            "target": {
                "schema_version": SCHEMA_VERSION,
                "id": mixture_id,
                "kind": "mixture-of-models",
                "router_api_url": "http://router:8080",
                "envoy_url": "http://envoy:8801",
                "backend_topology_digest": sha256_digest(b"backend-topology"),
                "mixture": frozen_mixture,
            },
        }
    )
    parsed = RunManifest.model_validate(payload)
    live_executor = next(
        executor
        for executor in BUILTIN_EXECUTOR_CONTRACTS
        if executor.id == "live-runtime.v1"
    )
    DEFAULT_TARGET_REGISTRY.resolve(parsed, live_executor)
    scoped = parsed.with_semantic_updates(
        target=parsed.target.model_copy(update={"id": f"candidate--{mixture_id}"})
    )
    DEFAULT_TARGET_REGISTRY.resolve(scoped, live_executor)
    assert parsed.target.envoy_url == "http://envoy:8801"
    assert parsed.target.mixture is not None
    assert parsed.target.mixture.model_arms[0].id == "fast"
    missing_topology = dict(payload)
    missing_topology["target"] = {
        key: value
        for key, value in dict(payload["target"]).items()
        if key != "backend_topology_digest"
    }
    missing_topology_manifest = RunManifest.model_validate(
        seal_manifest_fields(
            {
                key: value
                for key, value in missing_topology.items()
                if key != "manifest_digest"
            }
        )
    )
    with pytest.raises(ValueError, match="brokered-runtime target is incomplete"):
        DEFAULT_TARGET_REGISTRY.resolve(missing_topology_manifest, live_executor)
    payload["target"] = {
        "schema_version": SCHEMA_VERSION,
        "id": mixture_id,
        "kind": "mixture-of-models",
        "mixture": frozen_mixture,
    }
    missing_endpoints = RunManifest.model_validate(
        seal_manifest_fields(
            {key: value for key, value in payload.items() if key != "manifest_digest"}
        )
    )
    with pytest.raises(ValueError, match="brokered-runtime target is incomplete"):
        DEFAULT_TARGET_REGISTRY.resolve(missing_endpoints, live_executor)


def test_visible_and_grading_case_artifacts_must_be_physically_separate() -> None:
    ref = ArtifactRef(
        digest="sha256:" + "a" * 64,
        media_type="application/json",
        size_bytes=10,
    )
    with pytest.raises(ValidationError, match="separate artifacts"):
        WorkloadSnapshot(id="hidden-label-check", visible_cases=ref, grading_cases=ref)


def test_canonical_digest_is_key_order_independent() -> None:
    assert digest_value({"b": 2, "a": [3, 1]}) == digest_value({"a": [3, 1], "b": 2})
