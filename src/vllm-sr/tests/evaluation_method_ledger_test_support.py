"""Shared immutable fixtures for evaluation method-ledger contract tests."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

from cli.evaluation.http_client import HTTPResult


def _digest(label: str) -> str:
    return "sha256:" + hashlib.sha256(label.encode()).hexdigest()


_START = datetime(2026, 8, 30, 1, tzinfo=UTC)
_POLICY = _digest("1")
_CONFIG = _digest("2")
_BROKER_RECEIPT = _digest("3")
_TOPOLOGY = _digest("method-topology")


class _LedgerClient:
    def __init__(
        self, payload: dict[str, object], *, fetched_at: datetime | None = None
    ):
        self.payload = payload
        self.fetched_at = fetched_at or _START + timedelta(hours=1)
        self.calls: list[dict[str, object]] = []

    def get(self, endpoint: str, **kwargs: object) -> HTTPResult:
        self.calls.append({"endpoint": endpoint, **kwargs})
        return HTTPResult(
            success=True,
            status_code=200,
            payload=self.payload,
            latency_ms=1.0,
            headers={},
            broker_receipt=_BROKER_RECEIPT,
            fetched_at=self.fetched_at,
        )
