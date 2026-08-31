"""Server-owned metrics for the R2 compound model+budget method."""

from __future__ import annotations

from cli.evaluation.evidence import ExecutionRecord
from cli.evaluation.method_contract_v2 import (
    COMPOUND_MODEL_BUDGET_METHOD_ID,
    ActionRef,
    CompoundModelBudgetOutcome,
    CompoundModelBudgetReport,
    SliceRef,
    reduce_compound_model_budget,
)
from cli.evaluation.metric_core import _metric
from cli.evaluation.reporting import EvaluationMetric


def r2_compound_report(
    records: list[ExecutionRecord],
) -> CompoundModelBudgetReport | None:
    rows = [row for row in records if row.method_id == COMPOUND_MODEL_BUDGET_METHOD_ID]
    if not rows:
        return None
    outcomes = tuple(
        CompoundModelBudgetOutcome(
            case_id=row.case_id,
            action=ActionRef(id=_require(row.action_id, "action")),
            budget=_require(row.budget_tokens, "budget"),
            score=_require(row.quality, "score"),
            slice_refs=tuple(SliceRef(id=slice_id) for slice_id in row.slice_ids),
        )
        for row in rows
    )
    return reduce_compound_model_budget(outcomes)


def r2_compound_metrics(records: list[ExecutionRecord]) -> list[EvaluationMetric]:
    report = r2_compound_report(records)
    if report is None:
        return []
    count = len(report.raw_shared_domain_curve)
    return [
        _metric(
            "r2.compound_model_budget.audc",
            "R2 area under deployment curve",
            "model_pool",
            report.audc,
            "score-token",
            "higher_is_better",
            count,
        ),
        _metric(
            "r2.compound_model_budget.nauc",
            "R2 normalized area under deployment curve",
            "model_pool",
            report.nauc,
            "fraction",
            "higher_is_better",
            count,
        ),
        _metric(
            "r2.compound_model_budget.peak",
            "R2 peak quality",
            "model_pool",
            report.peak,
            "fraction",
            "higher_is_better",
            count,
        ),
        _metric(
            "r2.compound_model_budget.qnc",
            "R2 quality at the common maximum budget",
            "model_pool",
            report.qnc,
            "fraction",
            "higher_is_better",
            count,
        ),
    ]


def _require(value: str | int | float | None, label: str) -> str | int | float:
    if value is None:
        raise ValueError(f"R2 execution record lacks {label}")
    return value
