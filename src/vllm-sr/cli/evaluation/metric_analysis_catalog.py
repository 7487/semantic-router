"""Versioned, fail-closed analysis contracts for every publishable metric.

The JSON package resource is canonical.  Go and TypeScript ship byte-identical
mirrors so each runtime can validate reports without a Python dependency.
This module intentionally does not import the report schema: the report
publisher may depend on this catalog without creating a contract cycle.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from dataclasses import dataclass
from importlib.resources import files
from types import MappingProxyType
from typing import Any, Mapping

CATALOG_SCHEMA_VERSION = "metric-analysis-catalog.v1"
PROVENANCE_CONTRACT_VERSION = "metric-analysis.v1"
CATALOG_RESOURCE = "golden/metric_analysis_catalog.v1.json"
EXPECTED_STATIC_METRIC_COUNT = 132
EXPECTED_DYNAMIC_FAMILY_COUNT = 6

_TRACK_IDS = frozenset(
    {
        "routing",
        "model_pool",
        "joint",
        "agentic",
        "multimodal",
        "preference",
        "safety",
        "capacity",
    }
)
_PROJECTION_SOURCES = frozenset(
    {
        "evaluation_case_plan",
        "frozen_model_pool_matrix",
        "method_ledger",
        "capacity_load_plan",
        "compound_budget_plan",
        "routing_recipe_plan",
    }
)
_CAPTURE_TYPES = frozenset({"encoded_portable_id", "positive_int", "enum"})
_IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9.-]{0,159}$")


@dataclass(frozen=True)
class CatalogMetricAnalysisSpecification:
    analysis_ref: str
    track_id: str
    estimator_id: str
    estimator_version: str
    analysis_unit: str
    cluster_unit: str
    weighting: str
    missingness: str
    exclusion_policy: str
    planned_unit_projection: Mapping[str, Any]


@dataclass(frozen=True)
class CatalogMetricAnalysisMatch:
    metric_id: str
    family_id: str | None
    captures: Mapping[str, str]
    specification: CatalogMetricAnalysisSpecification


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise RuntimeError(f"metric analysis catalog repeats JSON key {key!r}")
        result[key] = value
    return result


def metric_analysis_catalog_bytes() -> bytes:
    """Read the package resource used by source installs and built wheels."""

    try:
        return files("cli.evaluation").joinpath(CATALOG_RESOURCE).read_bytes()
    except OSError as exc:  # pragma: no cover - exercised by package smoke gates
        raise RuntimeError(f"read metric analysis catalog: {exc}") from exc


def _load_document() -> dict[str, Any]:
    try:
        value = json.loads(
            metric_analysis_catalog_bytes().decode("utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"decode metric analysis catalog: {exc}") from exc
    if not isinstance(value, dict):
        raise RuntimeError("metric analysis catalog root must be an object")
    _validate_document(value)
    return value


def _exact_keys(value: Mapping[str, Any], expected: set[str], context: str) -> None:
    if set(value) != expected:
        raise RuntimeError(f"{context} fields are invalid")


def _sorted_unique(values: list[str], context: str) -> None:
    if values != sorted(values) or len(values) != len(set(values)):
        raise RuntimeError(f"{context} must be sorted and unique")


def _validate_identifier(value: Any, context: str) -> str:
    if not isinstance(value, str) or _IDENTIFIER.fullmatch(value) is None:
        raise RuntimeError(f"{context} identifier is invalid")
    return value


def _validate_projection(value: Any, captures: set[str] | None = None) -> None:
    if not isinstance(value, dict):
        raise RuntimeError("planned-unit projection must be an object")
    allowed = {"source", "track_id", "coordinates", "required_dimensions", "filters"}
    if set(value) - allowed or not {"source", "track_id", "coordinates"} <= set(value):
        raise RuntimeError("planned-unit projection fields are invalid")
    if (
        value["source"] not in _PROJECTION_SOURCES
        or value["track_id"] not in _TRACK_IDS
    ):
        raise RuntimeError("planned-unit projection source or track is invalid")
    for field in ("coordinates", "required_dimensions"):
        rows = value.get(field, [])
        if not isinstance(rows, list) or any(
            not isinstance(item, str) or not item or item.strip() != item
            for item in rows
        ):
            raise RuntimeError("planned-unit projection coordinates are invalid")
        if len(rows) != len(set(rows)):
            raise RuntimeError(f"planned-unit projection {field} must be unique")
    if not value["coordinates"]:
        raise RuntimeError("planned-unit projection requires a coordinate")
    filters = value.get("filters", [])
    if not isinstance(filters, list):
        raise RuntimeError("planned-unit projection filters are invalid")
    filter_fields: list[str] = []
    for item in filters:
        if not isinstance(item, dict):
            raise RuntimeError("planned-unit projection filter must be an object")
        _exact_keys(item, {"field", "capture"}, "planned-unit projection filter")
        if (
            not isinstance(item["field"], str)
            or not item["field"]
            or not isinstance(item["capture"], str)
            or (captures is not None and item["capture"] not in captures)
        ):
            raise RuntimeError("planned-unit projection filter is invalid")
        filter_fields.append(item["field"])
    if len(filter_fields) != len(set(filter_fields)):
        raise RuntimeError("planned-unit projection filter fields must be unique")


def _validate_template(value: Any) -> None:
    if not isinstance(value, dict):
        raise RuntimeError("analysis template must be an object")
    _exact_keys(
        value,
        {
            "id",
            "track_id",
            "estimator_id",
            "estimator_version",
            "analysis_unit",
            "cluster_unit",
            "weighting",
            "missingness",
            "exclusion_policy",
            "planned_unit_projection",
        },
        "analysis template",
    )
    _validate_identifier(value["id"], "analysis template")
    for field in (
        "estimator_id",
        "estimator_version",
        "analysis_unit",
        "cluster_unit",
        "weighting",
    ):
        if (
            not isinstance(value[field], str)
            or not value[field]
            or value[field].strip() != value[field]
        ):
            raise RuntimeError(f"analysis template {field} is invalid")
    if value["track_id"] not in _TRACK_IDS:
        raise RuntimeError("analysis template track is invalid")
    if (
        value["missingness"] != "fail_closed"
        or value["exclusion_policy"] != "exclude_unavailable_evidence"
    ):
        raise RuntimeError("analysis template missingness contract is invalid")
    _validate_projection(value["planned_unit_projection"])


def _encoding(document: Mapping[str, Any]) -> Mapping[str, Any]:
    value = document.get("identifier_encoding")
    if not isinstance(value, dict):
        raise RuntimeError("metric identifier encoding is missing")
    _exact_keys(
        value,
        {
            "scheme",
            "raw_pattern",
            "direct_pattern",
            "reserved_prefix",
            "encoded_pattern",
            "vectors",
        },
        "metric identifier encoding",
    )
    if (
        value["scheme"] != "portable-segment-base64url.v1"
        or value["reserved_prefix"] != "u-"
    ):
        raise RuntimeError("metric identifier encoding version is invalid")
    for field in ("raw_pattern", "direct_pattern", "encoded_pattern"):
        if not isinstance(value[field], str):
            raise RuntimeError("metric identifier encoding pattern is invalid")
        re.compile(value[field])
    if not isinstance(value["vectors"], list) or not value["vectors"]:
        raise RuntimeError("metric identifier encoding vectors are missing")
    return value


def encode_metric_subject_id(raw_id: str) -> str:
    encoding = _ENCODING
    if re.fullmatch(encoding["raw_pattern"], raw_id) is None:
        raise ValueError("metric subject id is not a portable raw identifier")
    if (
        not raw_id.startswith(encoding["reserved_prefix"])
        and re.fullmatch(encoding["direct_pattern"], raw_id) is not None
    ):
        return raw_id
    encoded = (
        base64.urlsafe_b64encode(raw_id.encode("ascii")).decode("ascii").rstrip("=")
    )
    result = f"{encoding['reserved_prefix']}{encoded}"
    if re.fullmatch(encoding["encoded_pattern"], result) is None:
        raise ValueError("metric subject id exceeds the encoded segment contract")
    return result


def decode_metric_subject_id(encoded_id: str) -> str:
    encoding = _ENCODING
    if not encoded_id.startswith(encoding["reserved_prefix"]):
        if re.fullmatch(encoding["direct_pattern"], encoded_id) is None:
            raise ValueError("metric subject segment is not canonical")
        return encoded_id
    if re.fullmatch(encoding["encoded_pattern"], encoded_id) is None:
        raise ValueError("metric subject segment is not canonical base64url")
    payload = encoded_id[len(encoding["reserved_prefix"]) :]
    try:
        padding = "=" * (-len(payload) % 4)
        raw = base64.b64decode(payload + padding, altchars=b"-_", validate=True).decode(
            "ascii"
        )
    except (binascii.Error, UnicodeDecodeError) as exc:
        raise ValueError("metric subject segment is not canonical base64url") from exc
    if encode_metric_subject_id(raw) != encoded_id:
        raise ValueError("metric subject segment has a non-canonical encoding")
    return raw


def _capture_values(family: Mapping[str, Any], match: re.Match[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for capture in family["captures"]:
        raw = match.group(capture["group"])
        capture_type = capture["type"]
        if capture_type == "encoded_portable_id":
            decode_metric_subject_id(raw)
        elif capture_type == "positive_int":
            number = int(raw)
            if (
                raw != str(number)
                or not capture["minimum"] <= number <= capture["maximum"]
            ):
                raise ValueError("metric identifier integer capture is out of range")
        elif capture_type == "enum":
            if raw not in capture["values"]:
                raise ValueError("metric identifier enum capture is invalid")
        else:  # pragma: no cover - rejected during catalog load
            raise ValueError("metric identifier capture type is invalid")
        result[capture["name"]] = raw
    return result


def _resolve_from_parts(metric_id: str) -> CatalogMetricAnalysisMatch:
    static = _STATIC_BY_ID.get(metric_id)
    if static is not None:
        specification = _SPECIFICATIONS[static["analysis_ref"]]
        return CatalogMetricAnalysisMatch(
            metric_id, None, MappingProxyType({}), specification
        )
    matches: list[tuple[Mapping[str, Any], dict[str, str]]] = []
    for family, pattern in _COMPILED_FAMILIES:
        match = pattern.fullmatch(metric_id)
        if match is None:
            continue
        captures = _capture_values(family, match)
        matches.append((family, captures))
    if len(matches) != 1:
        kind = "unknown" if not matches else "ambiguous"
        raise ValueError(f"{kind} evaluation metric id: {metric_id}")
    family, captures = matches[0]
    selector = captures[family["selector_capture"]]
    variants = {item["value"]: item["analysis_ref"] for item in family["variants"]}
    analysis_ref = variants.get(selector, variants.get("*"))
    if analysis_ref is None:  # pragma: no cover - rejected during catalog load
        raise ValueError(f"evaluation metric id has no analysis variant: {metric_id}")
    return CatalogMetricAnalysisMatch(
        metric_id,
        family["id"],
        MappingProxyType(captures),
        _SPECIFICATIONS[analysis_ref],
    )


def resolve_metric_analysis(metric_id: str) -> CatalogMetricAnalysisMatch:
    """Resolve exactly one registered metric, rejecting unknown or ambiguity."""

    if (
        not isinstance(metric_id, str)
        or not metric_id
        or metric_id.strip() != metric_id
    ):
        raise ValueError("evaluation metric id must be a trimmed non-empty string")
    return _resolve_from_parts(metric_id)


def static_metric_ids_for_track(track_id: str) -> tuple[str, ...]:
    if track_id not in _TRACK_IDS:
        raise ValueError(f"unknown evaluation track: {track_id}")
    return tuple(
        item["id"]
        for item in _DOCUMENT["static_metrics"]
        if _SPECIFICATIONS[item["analysis_ref"]].track_id == track_id
    )


def _validate_document(document: dict[str, Any]) -> None:
    _exact_keys(
        document,
        {
            "schema_version",
            "provenance_contract_version",
            "identifier_encoding",
            "analysis_templates",
            "static_metrics",
            "dynamic_families",
            "retired_metric_ids",
        },
        "metric analysis catalog",
    )
    if (
        document["schema_version"] != CATALOG_SCHEMA_VERSION
        or document["provenance_contract_version"] != PROVENANCE_CONTRACT_VERSION
    ):
        raise RuntimeError("metric analysis catalog version is invalid")
    encoding = _encoding(document)
    templates = document["analysis_templates"]
    if not isinstance(templates, list) or not templates:
        raise RuntimeError("metric analysis catalog templates are missing")
    for item in templates:
        _validate_template(item)
    template_ids = [item["id"] for item in templates]
    _sorted_unique(template_ids, "analysis template ids")
    refs = set(template_ids)

    families = document["dynamic_families"]
    if not isinstance(families, list) or len(families) != EXPECTED_DYNAMIC_FAMILY_COUNT:
        raise RuntimeError("metric analysis catalog must contain six dynamic families")
    family_ids = [item.get("id") for item in families if isinstance(item, dict)]
    if len(family_ids) != len(families) or any(
        not isinstance(item, str) for item in family_ids
    ):
        raise RuntimeError("dynamic family identity is invalid")
    _sorted_unique(family_ids, "dynamic family ids")
    prefixes: list[str] = []
    compiled: list[tuple[dict[str, Any], re.Pattern[str]]] = []
    for family in families:
        _exact_keys(
            family,
            {
                "id",
                "literal_prefix",
                "pattern",
                "captures",
                "selector_capture",
                "variants",
                "examples",
            },
            "dynamic family",
        )
        _validate_identifier(family["id"], "dynamic family")
        if (
            not isinstance(family["literal_prefix"], str)
            or not family["literal_prefix"]
        ):
            raise RuntimeError("dynamic family literal prefix is invalid")
        if (
            not isinstance(family["pattern"], str)
            or not family["pattern"].startswith("^")
            or not family["pattern"].endswith("$")
        ):
            raise RuntimeError("dynamic family grammar must be anchored")
        pattern = re.compile(family["pattern"])
        captures = family["captures"]
        if not isinstance(captures, list) or len(captures) != pattern.groups:
            raise RuntimeError("dynamic family captures do not match its grammar")
        names: list[str] = []
        for index, capture in enumerate(captures, start=1):
            if (
                not isinstance(capture, dict)
                or capture.get("group") != index
                or capture.get("type") not in _CAPTURE_TYPES
            ):
                raise RuntimeError("dynamic family capture is invalid")
            expected = {"name", "group", "type"}
            if capture["type"] == "enum":
                expected.add("values")
                values = capture.get("values")
                if not isinstance(values, list) or not values:
                    raise RuntimeError("dynamic family enum capture is empty")
                _sorted_unique(values, "dynamic family enum values")
            elif capture["type"] == "positive_int":
                expected |= {"minimum", "maximum"}
                if (
                    not isinstance(capture.get("minimum"), int)
                    or not isinstance(capture.get("maximum"), int)
                    or capture["minimum"] < 1
                    or capture["maximum"] < capture["minimum"]
                ):
                    raise RuntimeError("dynamic family integer bounds are invalid")
            _exact_keys(capture, expected, "dynamic family capture")
            names.append(capture["name"])
        _sorted_unique(sorted(names), "dynamic family capture names")
        if family["selector_capture"] not in names:
            raise RuntimeError("dynamic family selector capture is invalid")
        selector = next(
            item for item in captures if item["name"] == family["selector_capture"]
        )
        variants = family["variants"]
        if not isinstance(variants, list) or not variants:
            raise RuntimeError("dynamic family variants are missing")
        variant_values = [
            item.get("value") for item in variants if isinstance(item, dict)
        ]
        if len(variant_values) != len(variants):
            raise RuntimeError("dynamic family variant is invalid")
        _sorted_unique(variant_values, "dynamic family variant values")
        for item in variants:
            _exact_keys(item, {"value", "analysis_ref"}, "dynamic family variant")
            if item["analysis_ref"] not in refs:
                raise RuntimeError(
                    "dynamic family variant references an unknown analysis"
                )
        expected_variants = (
            selector.get("values") if selector["type"] == "enum" else ["*"]
        )
        if variant_values != expected_variants:
            raise RuntimeError("dynamic family variants do not cover their selector")
        capture_names = set(names)
        for item in variants:
            _validate_projection(
                next(
                    template
                    for template in templates
                    if template["id"] == item["analysis_ref"]
                )["planned_unit_projection"],
                capture_names,
            )
        prefixes.append(family["literal_prefix"])
        compiled.append((family, pattern))
    for index, left in enumerate(prefixes):
        for right in prefixes[index + 1 :]:
            if left.startswith(right) or right.startswith(left):
                raise RuntimeError("dynamic family literal prefixes may overlap")

    static = document["static_metrics"]
    if not isinstance(static, list) or len(static) != EXPECTED_STATIC_METRIC_COUNT:
        raise RuntimeError("metric analysis catalog must contain 132 exact metrics")
    static_ids: list[str] = []
    for item in static:
        if not isinstance(item, dict):
            raise RuntimeError("static metric entry must be an object")
        _exact_keys(item, {"id", "analysis_ref"}, "static metric")
        if (
            not isinstance(item["id"], str)
            or not item["id"]
            or item["analysis_ref"] not in refs
        ):
            raise RuntimeError("static metric entry is invalid")
        if any(pattern.fullmatch(item["id"]) for _, pattern in compiled):
            raise RuntimeError("static metric overlaps a dynamic family")
        static_ids.append(item["id"])
    _sorted_unique(static_ids, "static metric ids")

    retired = document["retired_metric_ids"]
    if not isinstance(retired, list) or len(retired) != 11:
        raise RuntimeError("metric catalog retired-id inventory is invalid")
    retired_ids: list[str] = []
    for item in retired:
        if not isinstance(item, dict):
            raise RuntimeError("retired metric entry must be an object")
        _exact_keys(item, {"id", "replacement", "reason"}, "retired metric")
        if (
            not isinstance(item["id"], str)
            or item["id"] in static_ids
            or not isinstance(item["reason"], str)
            or not item["reason"]
        ):
            raise RuntimeError("retired metric entry is invalid")
        if item["replacement"] is not None and item["replacement"] not in static_ids:
            raise RuntimeError("retired metric replacement is not canonical")
        retired_ids.append(item["id"])
    _sorted_unique(retired_ids, "retired metric ids")

    raw_pattern = re.compile(encoding["raw_pattern"])
    direct_pattern = re.compile(encoding["direct_pattern"])
    encoded_pattern = re.compile(encoding["encoded_pattern"])
    for vector in encoding["vectors"]:
        if not isinstance(vector, dict):
            raise RuntimeError("identifier encoding vector is invalid")
        _exact_keys(vector, {"raw", "encoded"}, "identifier encoding vector")
        if raw_pattern.fullmatch(vector["raw"]) is None:
            raise RuntimeError("identifier encoding raw vector is invalid")
        direct = (
            not vector["raw"].startswith(encoding["reserved_prefix"])
            and direct_pattern.fullmatch(vector["raw"]) is not None
        )
        expected = (
            vector["raw"]
            if direct
            else encoding["reserved_prefix"]
            + base64.urlsafe_b64encode(vector["raw"].encode("ascii"))
            .decode("ascii")
            .rstrip("=")
        )
        if expected != vector["encoded"] or (
            not direct and encoded_pattern.fullmatch(expected) is None
        ):
            raise RuntimeError("identifier encoding vector is not canonical")

    # Every example must resolve through exactly one family and its declared variant.
    for family, pattern in compiled:
        examples = family["examples"]
        if not isinstance(examples, list) or not examples:
            raise RuntimeError("dynamic family requires a golden example")
        for example in examples:
            if not isinstance(example, dict):
                raise RuntimeError("dynamic family example is invalid")
            _exact_keys(
                example,
                {"metric_id", "captures", "analysis_ref"},
                "dynamic family example",
            )
            matches = [
                (candidate, candidate_pattern.fullmatch(example["metric_id"]))
                for candidate, candidate_pattern in compiled
            ]
            matches = [
                (candidate, match) for candidate, match in matches if match is not None
            ]
            if len(matches) != 1 or matches[0][0]["id"] != family["id"]:
                raise RuntimeError("dynamic family example is unknown or ambiguous")
            actual = _capture_values_with_encoding(family, matches[0][1], encoding)
            if actual != example["captures"]:
                raise RuntimeError("dynamic family example captures drifted")
            selector_value = actual[family["selector_capture"]]
            variant_map = {
                item["value"]: item["analysis_ref"] for item in family["variants"]
            }
            if (
                variant_map.get(selector_value, variant_map.get("*"))
                != example["analysis_ref"]
            ):
                raise RuntimeError("dynamic family example analysis drifted")


def _capture_values_with_encoding(
    family: Mapping[str, Any], match: re.Match[str], encoding: Mapping[str, Any]
) -> dict[str, str]:
    result: dict[str, str] = {}
    for capture in family["captures"]:
        raw = match.group(capture["group"])
        if capture["type"] == "encoded_portable_id":
            if raw.startswith(encoding["reserved_prefix"]):
                payload = raw[len(encoding["reserved_prefix"]) :]
                try:
                    decoded = base64.b64decode(
                        payload + "=" * (-len(payload) % 4),
                        altchars=b"-_",
                        validate=True,
                    ).decode("ascii")
                except (binascii.Error, UnicodeDecodeError) as exc:
                    raise RuntimeError(
                        "dynamic family encoded capture is invalid"
                    ) from exc
                direct = (
                    not decoded.startswith(encoding["reserved_prefix"])
                    and re.fullmatch(encoding["direct_pattern"], decoded) is not None
                )
                canonical = (
                    decoded
                    if direct
                    else encoding["reserved_prefix"]
                    + base64.urlsafe_b64encode(decoded.encode("ascii"))
                    .decode("ascii")
                    .rstrip("=")
                )
                if (
                    re.fullmatch(encoding["raw_pattern"], decoded) is None
                    or canonical != raw
                ):
                    raise RuntimeError(
                        "dynamic family encoded capture is non-canonical"
                    )
            elif re.fullmatch(encoding["direct_pattern"], raw) is None:
                raise RuntimeError("dynamic family direct capture is invalid")
        elif capture["type"] == "positive_int":
            number = int(raw)
            if (
                raw != str(number)
                or not capture["minimum"] <= number <= capture["maximum"]
            ):
                raise RuntimeError("dynamic family integer capture is invalid")
        elif capture["type"] == "enum" and raw not in capture["values"]:
            raise RuntimeError("dynamic family enum capture is invalid")
        result[capture["name"]] = raw
    return result


_DOCUMENT = _load_document()
_ENCODING = MappingProxyType(_DOCUMENT["identifier_encoding"])
_SPECIFICATIONS = MappingProxyType(
    {
        item["id"]: CatalogMetricAnalysisSpecification(
            analysis_ref=item["id"],
            track_id=item["track_id"],
            estimator_id=item["estimator_id"],
            estimator_version=item["estimator_version"],
            analysis_unit=item["analysis_unit"],
            cluster_unit=item["cluster_unit"],
            weighting=item["weighting"],
            missingness=item["missingness"],
            exclusion_policy=item["exclusion_policy"],
            planned_unit_projection=MappingProxyType(item["planned_unit_projection"]),
        )
        for item in _DOCUMENT["analysis_templates"]
    }
)
_STATIC_BY_ID = MappingProxyType(
    {item["id"]: item for item in _DOCUMENT["static_metrics"]}
)
_COMPILED_FAMILIES = tuple(
    (item, re.compile(item["pattern"])) for item in _DOCUMENT["dynamic_families"]
)
STATIC_METRIC_IDS = tuple(_STATIC_BY_ID)
DYNAMIC_FAMILY_IDS = tuple(item["id"] for item, _ in _COMPILED_FAMILIES)
RETIRED_DISPLAY_METRIC_IDS = MappingProxyType(
    {item["id"]: item["replacement"] for item in _DOCUMENT["retired_metric_ids"]}
)
