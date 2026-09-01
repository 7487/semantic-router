"""Test-only builders for canonical evaluation contracts."""

from cli.evaluation.capacity_load_contract import (
    CAPACITY_LOAD_CONFIDENCE_LEVEL,
    CAPACITY_LOAD_KIND,
    MAX_CAPACITY_STABILITY_CV,
    MIN_CAPACITY_MEASUREMENT_REQUESTS,
    MIN_CAPACITY_REPETITIONS,
    MIN_CAPACITY_WARMUP_MULTIPLIER,
    capacity_concurrency_levels,
)
from cli.evaluation.contracts import CapacityLoadProtocol
from cli.evaluation.manifest_identity import (
    routing_recipe_plan_digest,
    routing_recipe_target_snapshot_digest,
)
from cli.evaluation.routing_recipe_plan import (
    ROUTING_RECIPE_PLAN_CONTRACT_VERSION,
    RoutingRecipeInputSpec,
    RoutingRecipePlan,
    RoutingRecipeProjectionSpec,
    routing_recipe_top_k,
)


def default_capacity_load_protocol(maximum: int) -> CapacityLoadProtocol:
    return CapacityLoadProtocol(
        kind=CAPACITY_LOAD_KIND,
        concurrency_levels=capacity_concurrency_levels(maximum),
        warmup_request_multiplier=MIN_CAPACITY_WARMUP_MULTIPLIER,
        measurement_requests_per_repetition=MIN_CAPACITY_MEASUREMENT_REQUESTS,
        repetitions_per_level=MIN_CAPACITY_REPETITIONS,
        confidence_level=CAPACITY_LOAD_CONFIDENCE_LEVEL,
        max_throughput_cv=MAX_CAPACITY_STABILITY_CV,
        max_latency_p95_cv=MAX_CAPACITY_STABILITY_CV,
    )


def build_routing_recipe_plan(
    *,
    recipe_digest: str,
    pool_digest: str,
    selector_policy_digest: str,
    selector_digest: str,
    adaptation_digest: str,
    binding_digest: str,
    arm_ids: tuple[str, ...],
    fallback_arm_id: str | None,
    signals: tuple[RoutingRecipeInputSpec, ...],
    projections: tuple[RoutingRecipeProjectionSpec, ...],
) -> RoutingRecipePlan:
    target_snapshot_digest = routing_recipe_target_snapshot_digest(
        {
            "recipe_digest": recipe_digest,
            "pool_digest": pool_digest,
            "selector_policy_digest": selector_policy_digest,
            "selector_digest": selector_digest,
            "adaptation_digest": adaptation_digest,
            "binding_digest": binding_digest,
        }
    )
    draft = {
        "contract_version": ROUTING_RECIPE_PLAN_CONTRACT_VERSION,
        "target_snapshot_digest": target_snapshot_digest,
        "arm_ids": tuple(sorted(arm_ids)),
        "fallback_arm_id": fallback_arm_id,
        "signals": tuple(sorted(signals, key=lambda spec: spec.id)),
        "projections": tuple(sorted(projections, key=lambda spec: spec.id)),
        "top_k": routing_recipe_top_k(len(arm_ids)),
    }
    return RoutingRecipePlan(
        **draft,
        plan_digest=routing_recipe_plan_digest(draft),
    )
