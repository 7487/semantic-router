from __future__ import annotations

import pytest
from cli.evaluation.evidence import ExecutionRecord
from cli.evaluation.method_contract_v2 import (
    R2_COMPOUND_MODEL_BUDGET_PLUGIN,
    ActionRef,
    CaseArmObservation,
    CompoundModelBudgetOutcome,
    SliceRef,
    reduce_case_arm_observations,
    reduce_compound_model_budget,
)
from cli.evaluation.method_planner_v2 import runnable_gradeable_live_methods
from cli.evaluation.method_registry_v2 import (
    METHOD_PLUGINS,
    method_plugin_for_benchmark,
)
from cli.evaluation.metric_compound_model_budget import r2_compound_metrics
from cli.evaluation.research_benchmark_inventory import RESEARCH_BENCHMARKS


def _outcomes() -> tuple[CompoundModelBudgetOutcome, ...]:
    return (
        CompoundModelBudgetOutcome(
            case_id="case-a",
            action=ActionRef(id="small"),
            budget=100,
            score=0.4,
            slice_refs=(SliceRef(id="all"),),
        ),
        CompoundModelBudgetOutcome(
            case_id="case-a",
            action=ActionRef(id="small"),
            budget=200,
            score=0.6,
            slice_refs=(SliceRef(id="all"),),
        ),
        CompoundModelBudgetOutcome(
            case_id="case-a",
            action=ActionRef(id="large"),
            budget=100,
            score=0.6,
            slice_refs=(SliceRef(id="all"),),
        ),
        CompoundModelBudgetOutcome(
            case_id="case-a",
            action=ActionRef(id="large"),
            budget=200,
            score=0.8,
            slice_refs=(SliceRef(id="all"),),
        ),
        CompoundModelBudgetOutcome(
            case_id="case-b",
            action=ActionRef(id="small"),
            budget=100,
            score=0.2,
            slice_refs=(SliceRef(id="all"),),
        ),
        CompoundModelBudgetOutcome(
            case_id="case-b",
            action=ActionRef(id="small"),
            budget=200,
            score=0.4,
            slice_refs=(SliceRef(id="all"),),
        ),
        CompoundModelBudgetOutcome(
            case_id="case-b",
            action=ActionRef(id="large"),
            budget=100,
            score=0.4,
            slice_refs=(SliceRef(id="all"),),
        ),
        CompoundModelBudgetOutcome(
            case_id="case-b",
            action=ActionRef(id="large"),
            budget=200,
            score=0.6,
            slice_refs=(SliceRef(id="all"),),
        ),
    )


def test_r2_compound_model_budget_preserves_action_identity_and_shared_curve() -> None:
    report = reduce_compound_model_budget(_outcomes())

    assert report.method == R2_COMPOUND_MODEL_BUDGET_PLUGIN
    assert tuple(action.id for action in report.action_refs) == ("large", "small")
    assert [
        (point.action.id, point.budget) for point in report.raw_shared_domain_curve
    ] == [
        ("large", 100),
        ("large", 200),
        ("small", 100),
        ("small", 200),
    ]
    assert [
        point.mean_score for point in report.raw_shared_domain_curve
    ] == pytest.approx([0.5, 0.7, 0.3, 0.5])
    assert report.audc == pytest.approx(100.0)
    assert report.nauc == pytest.approx(0.5)
    assert report.peak == pytest.approx(0.7)
    assert report.qnc == pytest.approx(0.6)
    assert report.missing_case_action_budget_cells == 0


def test_r2_compound_model_budget_fails_closed_on_missing_or_duplicate_cells() -> None:
    rows = _outcomes()
    with pytest.raises(ValueError, match="exact shared"):
        reduce_compound_model_budget(rows[:-1])
    with pytest.raises(ValueError, match="duplicate case x action x budget"):
        reduce_compound_model_budget((*rows, rows[0]))


def test_generic_reducer_fails_closed_on_duplicate_case_arm() -> None:
    row = CaseArmObservation(case_id="case-a", action=ActionRef(id="small"), value=0.5)
    with pytest.raises(ValueError, match="duplicate case x action"):
        reduce_case_arm_observations((row, row))


def test_v2_planner_exposes_only_complete_gradeable_live_methods() -> None:
    with pytest.raises(ValueError, match="no runnable"):
        runnable_gradeable_live_methods(
            (R2_COMPOUND_MODEL_BUDGET_PLUGIN,), selected_tracks=("model_pool",)
        )


def test_r2_execution_records_reduce_without_generic_model_pool_semantics() -> None:
    records = [
        ExecutionRecord(
            id=f"r2-{case}-{action}-{budget}",
            track_id="model_pool",
            case_id=case,
            attempt_id=f"attempt-{case}-{action}-{budget}",
            status="succeeded",
            method_id="r2.compound-model-budget.v2",
            action_id=action,
            budget_tokens=budget,
            slice_ids=("all",),
            success=True,
            quality=score,
        )
        for case, action, budget, score in (
            ("case-a", "small", 100, 0.4),
            ("case-a", "small", 200, 0.6),
            ("case-a", "large", 100, 0.6),
            ("case-a", "large", 200, 0.8),
        )
    ]
    metrics = {metric.id: metric.value for metric in r2_compound_metrics(records)}
    assert metrics["r2.compound_model_budget.audc"] == pytest.approx(120.0)
    assert metrics["r2.compound_model_budget.nauc"] == pytest.approx(0.6)


def test_all_benchmark_methods_have_one_explicit_v2_declaration() -> None:
    assert len(METHOD_PLUGINS) == 13
    assert len(RESEARCH_BENCHMARKS) == 13
    assert method_plugin_for_benchmark("routejudge-orbit").status == "blocked"
    assert method_plugin_for_benchmark("routereval").status == "blocked"
    assert sum(plugin.status == "exploratory-import" for plugin in METHOD_PLUGINS) == 8
    assert sum(plugin.status == "data-required" for plugin in METHOD_PLUGINS) == 3
    assert all(plugin.evidence_ceiling == "E0" for plugin in METHOD_PLUGINS)
    assert all(plugin.native_parity != "native" for plugin in METHOD_PLUGINS)
    assert R2_COMPOUND_MODEL_BUDGET_PLUGIN.applicable_tracks == (
        "routing",
        "model_pool",
        "joint",
        "capacity",
    )
    assert R2_COMPOUND_MODEL_BUDGET_PLUGIN.live_tracks == ()
    assert method_plugin_for_benchmark("routerarena").applicable_tracks == (
        "routing",
        "model_pool",
        "joint",
    )
