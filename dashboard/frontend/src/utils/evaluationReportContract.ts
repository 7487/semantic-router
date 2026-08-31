import type {
  EvaluationMetricAnalysisProvenance,
  EvaluationReport,
} from '../types/evaluationReport'
import type { EvaluationRun } from '../types/evaluationPlane'
import {
  EVALUATION_ATTESTATION_REVISION,
  EVALUATION_GATE_CONTRACT_VERSION,
  EVALUATION_SCHEMA_VERSION,
} from '../types/evaluationPlane'
import {
  assertCurrentEvaluationContract,
  EVALUATION_CHANGE_PROFILE_SET,
  EVALUATION_EVIDENCE_LEVEL_SET,
  EVALUATION_GATE_DISPOSITION_SET,
  EVALUATION_GATE_VERDICT_SET,
  EVALUATION_TRACK_ID_SET,
  hasOnlyEvaluationFields,
  isEvaluationRecord,
  isFiniteNumber,
  isKnownValue,
  isNonEmptyText,
  isNonNegativeInteger,
  isOptionalText,
  isStringRecord,
  isTextArray,
} from './evaluationContractValidation'
import { decodeEvaluationRun } from './evaluationRunContract'
import { decodeEvaluationRoutingRecipeReport } from './evaluationRoutingRecipeContract'
import {
  METRIC_ANALYSIS_CONTRACT_VERSION,
  resolveMetricAnalysisCatalog,
  tryResolveMetricAnalysisCatalog,
} from '../contracts/metricAnalysisCatalog'

const TRACK_STATUS_SET = new Set([
  'pending',
  'running',
  'sealing',
  'completed',
  'failed',
  'cancelled',
  'unavailable',
  'skipped',
])

export function isEvaluationCoverage(value: unknown): boolean {
  if (
    !isEvaluationRecord(value) ||
    !hasOnlyEvaluationFields(value, [
      'evaluated',
      'total',
      'fraction',
      'unavailable',
      'confidence_level',
      'confidence_interval',
    ]) ||
    !isNonNegativeInteger(value.evaluated) ||
    !isNonNegativeInteger(value.total) ||
    value.evaluated > value.total ||
    !isFiniteNumber(value.fraction) ||
    value.fraction < 0 ||
    value.fraction > 1 ||
    (value.unavailable !== undefined && !isNonNegativeInteger(value.unavailable)) ||
    (value.confidence_level !== undefined &&
      (!isFiniteNumber(value.confidence_level) ||
        value.confidence_level < 0 ||
        value.confidence_level > 1))
  ) {
    return false
  }
  return (
    value.confidence_interval === undefined ||
    (Array.isArray(value.confidence_interval) &&
      value.confidence_interval.length === 2 &&
      value.confidence_interval.every(isFiniteNumber))
  )
}

export function isEvaluationMetric(value: unknown): boolean {
  return (
    isEvaluationRecord(value) &&
    hasOnlyEvaluationFields(value, [
      'id',
      'name',
      'track_id',
      'value',
      'unit',
      'direction',
      'baseline_value',
      'delta',
      'confidence_interval',
      'sample_count',
      'analysis_provenance',
    ]) &&
    isNonEmptyText(value.id) &&
    isNonEmptyText(value.name) &&
    (value.track_id === undefined || isKnownValue(value.track_id, EVALUATION_TRACK_ID_SET)) &&
    (value.value === null || isFiniteNumber(value.value)) &&
    typeof value.unit === 'string' &&
    (value.direction === undefined ||
      ['higher_is_better', 'lower_is_better', 'target'].includes(String(value.direction))) &&
    (value.baseline_value === undefined ||
      value.baseline_value === null ||
      isFiniteNumber(value.baseline_value)) &&
    (value.delta === undefined || value.delta === null || isFiniteNumber(value.delta)) &&
    (value.confidence_interval === undefined ||
      (Array.isArray(value.confidence_interval) &&
        value.confidence_interval.length === 2 &&
        value.confidence_interval.every(isFiniteNumber))) &&
    (value.sample_count === undefined || isNonNegativeInteger(value.sample_count)) &&
    isMetricAnalysisProvenance(value.analysis_provenance, value.id)
  )
}

function isMetricAnalysisProvenance(value: unknown, metricID: string): boolean {
  if (!isEvaluationRecord(value)) return false
  const match = tryResolveMetricAnalysisCatalog(metricID)
  if (!match) return false
  const specification = match.specification
  return (
    hasOnlyEvaluationFields(value, [
      'contract_version',
      'estimator_id',
      'estimator_version',
      'analysis_unit',
      'cluster_unit',
      'weighting',
      'missingness',
      'exclusion_policy',
      'observed_exclusions',
    ]) &&
    value.contract_version === METRIC_ANALYSIS_CONTRACT_VERSION &&
    value.estimator_id === specification.estimator_id &&
    value.estimator_version === specification.estimator_version &&
    value.analysis_unit === specification.analysis_unit &&
    value.cluster_unit === specification.cluster_unit &&
    value.weighting === specification.weighting &&
    value.missingness === specification.missingness &&
    value.exclusion_policy === specification.exclusion_policy &&
    isNonNegativeInteger(value.observed_exclusions)
  )
}

type MetricAnalysisSpecification = Pick<
  EvaluationMetricAnalysisProvenance,
  | 'estimator_id'
  | 'estimator_version'
  | 'analysis_unit'
  | 'cluster_unit'
  | 'weighting'
  | 'missingness'
  | 'exclusion_policy'
>

export function metricAnalysisSpecification(metricID: string): MetricAnalysisSpecification {
  const specification = resolveMetricAnalysisCatalog(metricID).specification
  return {
    estimator_id: specification.estimator_id,
    estimator_version: specification.estimator_version,
    analysis_unit: specification.analysis_unit,
    cluster_unit: specification.cluster_unit,
    weighting: specification.weighting as MetricAnalysisSpecification['weighting'],
    missingness: specification.missingness,
    exclusion_policy: specification.exclusion_policy,
  }
}

export function isEvaluationGate(value: unknown): boolean {
  if (
    !isEvaluationRecord(value) ||
    !hasOnlyEvaluationFields(value, [
      'id',
      'name',
      'description',
      'track_id',
      'disposition',
      'verdict',
      'change_profile',
      'contract_version',
      'evidence_refs',
      'evidence_level',
      'observed',
      'threshold',
      'sample_count',
      'coverage',
      'owner',
      'evaluated_at',
      'rationale',
    ]) ||
    !isNonEmptyText(value.id) ||
    !isNonEmptyText(value.name) ||
    !isKnownValue(value.disposition, EVALUATION_GATE_DISPOSITION_SET) ||
    !isKnownValue(value.verdict, EVALUATION_GATE_VERDICT_SET) ||
    !isKnownValue(value.change_profile, EVALUATION_CHANGE_PROFILE_SET) ||
    value.contract_version !== EVALUATION_GATE_CONTRACT_VERSION ||
    !isTextArray(value.evidence_refs) ||
    (value.track_id !== undefined && !isKnownValue(value.track_id, EVALUATION_TRACK_ID_SET)) ||
    (value.evidence_level !== undefined &&
      !isKnownValue(value.evidence_level, EVALUATION_EVIDENCE_LEVEL_SET)) ||
    (value.observed !== undefined && value.observed !== null && !isFiniteNumber(value.observed)) ||
    (value.sample_count !== undefined && !isNonNegativeInteger(value.sample_count)) ||
    (value.coverage !== undefined && !isEvaluationCoverage(value.coverage)) ||
    !isOptionalText(value.description) ||
    !isOptionalText(value.owner) ||
    !isOptionalText(value.evaluated_at) ||
    !isOptionalText(value.rationale)
  ) {
    return false
  }
  return (
    value.threshold === undefined ||
    (isEvaluationRecord(value.threshold) &&
      hasOnlyEvaluationFields(value.threshold, ['operator', 'value', 'unit']) &&
      isNonEmptyText(value.threshold.operator) &&
      isFiniteNumber(value.threshold.value) &&
      isOptionalText(value.threshold.unit))
  )
}

function isEvaluationArtifact(value: unknown): boolean {
  return (
    isEvaluationRecord(value) &&
    hasOnlyEvaluationFields(value, [
      'id',
      'name',
      'kind',
      'uri',
      'digest',
      'media_type',
      'size_bytes',
    ]) &&
    isNonEmptyText(value.id) &&
    isNonEmptyText(value.name) &&
    isNonEmptyText(value.kind) &&
    isOptionalText(value.uri) &&
    isOptionalText(value.digest) &&
    isOptionalText(value.media_type) &&
    (value.size_bytes === undefined || isNonNegativeInteger(value.size_bytes))
  )
}

function isEvaluationCost(value: unknown): boolean {
  return (
    isEvaluationRecord(value) &&
    hasOnlyEvaluationFields(value, [
      'amount',
      'currency',
      'input_tokens',
      'output_tokens',
      'gpu_seconds',
      'energy_kwh',
    ]) &&
    (value.amount === null || isFiniteNumber(value.amount)) &&
    isNonEmptyText(value.currency) &&
    (value.input_tokens === undefined || isNonNegativeInteger(value.input_tokens)) &&
    (value.output_tokens === undefined || isNonNegativeInteger(value.output_tokens)) &&
    (value.gpu_seconds === undefined || isFiniteNumber(value.gpu_seconds)) &&
    (value.energy_kwh === undefined || isFiniteNumber(value.energy_kwh))
  )
}

function isEvaluationReportSummary(value: unknown): boolean {
  return (
    isEvaluationRecord(value) &&
    hasOnlyEvaluationFields(value, [
      'verdict',
      'quality_score',
      'latency_p95_ms',
      'runtime_cost',
      'capacity_tco',
      'coverage',
      'passed_gates',
      'failed_gates',
      'unavailable_gates',
    ]) &&
    isKnownValue(value.verdict, EVALUATION_GATE_VERDICT_SET) &&
    (value.quality_score === null || isFiniteNumber(value.quality_score)) &&
    (value.latency_p95_ms === null || isFiniteNumber(value.latency_p95_ms)) &&
    (value.runtime_cost === null || isFiniteNumber(value.runtime_cost)) &&
    (value.capacity_tco === null || isFiniteNumber(value.capacity_tco)) &&
    isEvaluationCoverage(value.coverage) &&
    isNonNegativeInteger(value.passed_gates) &&
    isNonNegativeInteger(value.failed_gates) &&
    isNonNegativeInteger(value.unavailable_gates)
  )
}

function isEvaluationTrackReport(value: unknown): boolean {
  return (
    isEvaluationRecord(value) &&
    hasOnlyEvaluationFields(value, [
      'track_id',
      'status',
      'evidence_level',
      'summary',
      'coverage',
      'metrics',
      'gates',
      'artifacts',
      'error',
    ]) &&
    isKnownValue(value.track_id, EVALUATION_TRACK_ID_SET) &&
    isKnownValue(value.status, TRACK_STATUS_SET) &&
    isKnownValue(value.evidence_level, EVALUATION_EVIDENCE_LEVEL_SET) &&
    typeof value.summary === 'string' &&
    isEvaluationCoverage(value.coverage) &&
    Array.isArray(value.metrics) &&
    value.metrics.every(isEvaluationMetric) &&
    Array.isArray(value.gates) &&
    value.gates.every(isEvaluationGate) &&
    (value.artifacts === undefined ||
      (Array.isArray(value.artifacts) && value.artifacts.every(isEvaluationArtifact))) &&
    isOptionalText(value.error)
  )
}

function isEvaluationProvenance(value: unknown, run: EvaluationRun): boolean {
  return (
    isEvaluationRecord(value) &&
    hasOnlyEvaluationFields(value, [
      'schema_version',
      'generated_at',
      'code_revision',
      'benchmark_revisions',
      'workload_snapshot_digest',
      'policy_snapshot_digest',
      'binding_snapshot_digest',
      'pool_snapshot_digest',
      'environment_snapshot_digest',
      'target_id',
      'seed',
      'redaction_policy',
    ]) &&
    value.schema_version === EVALUATION_SCHEMA_VERSION &&
    isNonEmptyText(value.generated_at) &&
    isOptionalText(value.code_revision) &&
    (value.benchmark_revisions === undefined || isStringRecord(value.benchmark_revisions)) &&
    isOptionalText(value.workload_snapshot_digest) &&
    isOptionalText(value.policy_snapshot_digest) &&
    isOptionalText(value.binding_snapshot_digest) &&
    isOptionalText(value.pool_snapshot_digest) &&
    isOptionalText(value.environment_snapshot_digest) &&
    isOptionalText(value.redaction_policy) &&
    value.target_id === run.target_id &&
    value.seed === run.seed
  )
}

const METHOD_V2 = 'evaluation-method.v2'
const METHOD_STATUSES = new Set([
  'native-qualified',
  'exploratory-import',
  'data-required',
  'blocked',
])
const METHOD_OWNERS = new Set(['server', 'worker', 'provider', 'benchmark_native'])
const METHOD_PARITIES = new Set(['native', 'source_qualified', 'none'])

type MethodSliceWire = { schema_version: typeof METHOD_V2; id: string }
type MethodAnalysisPlanWire = {
  schema_version: typeof METHOD_V2
  id: string
  analysis_unit: string
  cluster_unit: string
  slices: MethodSliceWire[]
  curve_domain: 'shared_budget' | 'not_applicable'
  missingness: 'fail_closed'
}
type MethodCurvePointWire = {
  action: MethodSliceWire
  budget: number
  mean_score: number
  case_count: number
}

function isMethodIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
}

function isMethodIdentityArray(value: unknown, nonEmpty = false): value is string[] {
  return Array.isArray(value) && (!nonEmpty || value.length > 0) && value.every(isMethodIdentity)
}

function isMethodSlice(value: unknown): value is MethodSliceWire {
  return (
    isEvaluationRecord(value) &&
    hasOnlyEvaluationFields(value, ['schema_version', 'id']) &&
    value.schema_version === METHOD_V2 &&
    isMethodIdentity(value.id)
  )
}

function isMethodAnalysisPlan(value: unknown): value is MethodAnalysisPlanWire {
  return (
    isEvaluationRecord(value) &&
    hasOnlyEvaluationFields(value, [
      'schema_version',
      'id',
      'analysis_unit',
      'cluster_unit',
      'slices',
      'curve_domain',
      'missingness',
    ]) &&
    value.schema_version === METHOD_V2 &&
    isMethodIdentity(value.id) &&
    isNonEmptyText(value.analysis_unit) &&
    isNonEmptyText(value.cluster_unit) &&
    Array.isArray(value.slices) &&
    value.slices.length > 0 &&
    value.slices.every(isMethodSlice) &&
    new Set(value.slices.map((slice) => (slice as { id: string }).id)).size ===
      value.slices.length &&
    (value.curve_domain === 'shared_budget' || value.curve_domain === 'not_applicable') &&
    value.missingness === 'fail_closed'
  )
}

function sameMethodAnalysisPlan(
  left: MethodAnalysisPlanWire,
  right: MethodAnalysisPlanWire,
): boolean {
  return (
    left.schema_version === right.schema_version &&
    left.id === right.id &&
    left.analysis_unit === right.analysis_unit &&
    left.cluster_unit === right.cluster_unit &&
    left.curve_domain === right.curve_domain &&
    left.missingness === right.missingness &&
    left.slices.length === right.slices.length &&
    left.slices.every((slice, index) => slice.id === right.slices[index]?.id)
  )
}

function isMethodCurvePoint(value: unknown): value is MethodCurvePointWire {
  return (
    isEvaluationRecord(value) &&
    hasOnlyEvaluationFields(value, ['action', 'budget', 'mean_score', 'case_count']) &&
    isMethodSlice(value.action) &&
    isNonNegativeInteger(value.budget) &&
    value.budget > 0 &&
    isFiniteNumber(value.mean_score) &&
    value.mean_score >= 0 &&
    value.mean_score <= 1 &&
    isNonNegativeInteger(value.case_count) &&
    value.case_count > 0
  )
}

function isMethodDescriptor(value: unknown): boolean {
  if (
    !isEvaluationRecord(value) ||
    !hasOnlyEvaluationFields(value, [
      'schema_version',
      'id',
      'version',
      'status',
      'execution_owner',
      'input_schema',
      'export_schema',
      'live_input_complete',
      'live_grader',
      'applicable_tracks',
      'live_tracks',
      'produced_metric_ids',
      'evidence_ceiling',
      'native_parity',
      'required_artifact_ids',
      'analysis_plan',
    ]) ||
    value.schema_version !== METHOD_V2 ||
    value.version !== METHOD_V2 ||
    !isMethodIdentity(value.id) ||
    typeof value.status !== 'string' ||
    !METHOD_STATUSES.has(value.status) ||
    typeof value.execution_owner !== 'string' ||
    !METHOD_OWNERS.has(value.execution_owner) ||
    !isMethodIdentity(value.input_schema) ||
    !isMethodIdentity(value.export_schema) ||
    typeof value.live_input_complete !== 'boolean' ||
    typeof value.live_grader !== 'boolean' ||
    !Array.isArray(value.applicable_tracks) ||
    value.applicable_tracks.length === 0 ||
    !value.applicable_tracks.every(isMethodIdentity) ||
    !Array.isArray(value.live_tracks) ||
    !value.live_tracks.every(isMethodIdentity) ||
    !Array.isArray(value.produced_metric_ids) ||
    value.produced_metric_ids.length === 0 ||
    !value.produced_metric_ids.every(isMethodIdentity) ||
    typeof value.evidence_ceiling !== 'string' ||
    !EVALUATION_EVIDENCE_LEVEL_SET.has(value.evidence_ceiling) ||
    typeof value.native_parity !== 'string' ||
    !METHOD_PARITIES.has(value.native_parity) ||
    !Array.isArray(value.required_artifact_ids) ||
    value.required_artifact_ids.length === 0 ||
    !value.required_artifact_ids.every(isMethodIdentity) ||
    !isMethodAnalysisPlan(value.analysis_plan)
  ) {
    return false
  }
  const applicableTracks = value.applicable_tracks
  const liveTracks = value.live_tracks
  const metricIDs = value.produced_metric_ids
  const artifactIDs = value.required_artifact_ids
  if (
    !isMethodIdentityArray(applicableTracks, true) ||
    !isMethodIdentityArray(liveTracks) ||
    !isMethodIdentityArray(metricIDs, true) ||
    !isMethodIdentityArray(artifactIDs, true)
  ) {
    return false
  }
  const unique = (values: unknown[]) => new Set(values).size === values.length
  if (
    !unique(applicableTracks) ||
    !unique(liveTracks) ||
    !unique(metricIDs) ||
    !unique(artifactIDs) ||
    liveTracks.some((track) => !applicableTracks.includes(track))
  )
    return false
  if (value.status === 'native-qualified') {
    return value.live_input_complete && value.live_grader && value.live_tracks.length > 0
  }
  return !value.live_input_complete && !value.live_grader && value.live_tracks.length === 0
}

function isMethodReport(value: unknown): boolean {
  if (
    !isEvaluationRecord(value) ||
    !hasOnlyEvaluationFields(value, [
      'method',
      'analysis_plan',
      'action_refs',
      'slice_refs',
      'raw_shared_domain_curve',
      'audc',
      'nauc',
      'peak',
      'qnc',
      'missing_case_action_budget_cells',
    ]) ||
    !isMethodDescriptor(value.method) ||
    !isMethodAnalysisPlan(value.analysis_plan) ||
    !Array.isArray(value.action_refs) ||
    !value.action_refs.every(isMethodSlice) ||
    !Array.isArray(value.slice_refs) ||
    !value.slice_refs.every(isMethodSlice) ||
    !Array.isArray(value.raw_shared_domain_curve) ||
    !value.raw_shared_domain_curve.every(isMethodCurvePoint) ||
    !isFiniteNumber(value.audc) ||
    value.audc < 0 ||
    !isFiniteNumber(value.nauc) ||
    value.nauc < 0 ||
    value.nauc > 1 ||
    !isFiniteNumber(value.peak) ||
    value.peak < 0 ||
    value.peak > 1 ||
    !isFiniteNumber(value.qnc) ||
    value.qnc < 0 ||
    value.qnc > 1 ||
    !isNonNegativeInteger(value.missing_case_action_budget_cells) ||
    value.missing_case_action_budget_cells !== 0
  ) {
    return false
  }
  const actionRefs = value.action_refs
  const sliceRefs = value.slice_refs
  const curve = value.raw_shared_domain_curve
  const methodPlan = isEvaluationRecord(value.method) ? value.method.analysis_plan : undefined
  if (
    actionRefs.length === 0 ||
    sliceRefs.length === 0 ||
    curve.length === 0 ||
    new Set(actionRefs.map((action) => action.id)).size !== actionRefs.length ||
    new Set(sliceRefs.map((slice) => slice.id)).size !== sliceRefs.length ||
    !isMethodAnalysisPlan(methodPlan) ||
    !sameMethodAnalysisPlan(methodPlan, value.analysis_plan) ||
    !sameMethodAnalysisPlan(value.analysis_plan, {
      ...value.analysis_plan,
      slices: sliceRefs,
    })
  ) {
    return false
  }
  const declaredActions = new Set(actionRefs.map((action) => action.id))
  const coordinates = new Set<string>()
  for (const point of curve) {
    const coordinate = `${point.action.id}\u0000${point.budget}`
    if (!declaredActions.has(point.action.id) || coordinates.has(coordinate)) return false
    coordinates.add(coordinate)
  }
  return true
}

export function decodeEvaluationReport(payload: unknown, runID: string): EvaluationReport {
  assertCurrentEvaluationContract(payload, 'Evaluation report response')
  if (payload.attestation_revision !== EVALUATION_ATTESTATION_REVISION) {
    throw new Error('Evaluation report is not attested by the current server contract.')
  }
  const run = decodeEvaluationRun(payload.run, runID)
  if (
    !hasOnlyEvaluationFields(payload, [
      'schema_version',
      'attestation_revision',
      'run',
      'summary',
      'tracks',
      'metrics',
      'gates',
      'costs',
      'recommendations',
      'provenance',
      'artifacts',
      'method_reports',
      'routing_recipe_report',
    ]) ||
    run.status !== 'completed' ||
    !isEvaluationReportSummary(payload.summary) ||
    !Array.isArray(payload.tracks) ||
    !payload.tracks.every(isEvaluationTrackReport) ||
    !Array.isArray(payload.metrics) ||
    !payload.metrics.every(isEvaluationMetric) ||
    !Array.isArray(payload.gates) ||
    !payload.gates.every(isEvaluationGate) ||
    !isEvaluationRecord(payload.costs) ||
    !hasOnlyEvaluationFields(payload.costs, ['runtime', 'evaluation_overhead', 'capacity_tco']) ||
    !isEvaluationCost(payload.costs.runtime) ||
    !isEvaluationCost(payload.costs.evaluation_overhead) ||
    !isEvaluationCost(payload.costs.capacity_tco) ||
    !isTextArray(payload.recommendations) ||
    !isEvaluationProvenance(payload.provenance, run) ||
    !Array.isArray(payload.artifacts) ||
    !payload.artifacts.every(isEvaluationArtifact) ||
    !Array.isArray(payload.method_reports) ||
    !payload.method_reports.every(isMethodReport)
  ) {
    throw new Error('Evaluation report response is incomplete.')
  }
  decodeEvaluationRoutingRecipeReport(payload.routing_recipe_report, run)
  return payload as unknown as EvaluationReport
}
