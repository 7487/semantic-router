import type {
  EvaluationAttestationRevision,
  EvaluationCapacityLoadProtocol,
  EvaluationCapacitySLO,
  EvaluationChangeProfileId,
  EvaluationGateContractVersion,
  EvaluationRun,
  EvaluationSchemaVersion,
  EvaluationTrackId,
  EvaluationTrackStatus,
  EvidenceLevel,
  GateDisposition,
  GateVerdict,
} from './evaluationPlane'

export interface EvaluationCoverage {
  evaluated: number
  total: number
  fraction: number
  unavailable?: number
  confidence_level?: number
  confidence_interval?: [number, number]
}

export interface EvaluationMetric {
  id: string
  name: string
  track_id?: EvaluationTrackId
  value: number | null
  unit: string
  direction?: 'higher_is_better' | 'lower_is_better' | 'target'
  baseline_value?: number | null
  delta?: number | null
  confidence_interval?: [number, number]
  sample_count?: number
  analysis_provenance: EvaluationMetricAnalysisProvenance
}

export interface EvaluationMetricAnalysisProvenance {
  contract_version: 'metric-analysis.v1'
  estimator_id: string
  estimator_version: string
  analysis_unit: string
  cluster_unit: string
  weighting:
    | 'inverse_propensity'
    | 'uniform_arm'
    | 'uniform_arm_pair'
    | 'uniform_assignment'
    | 'uniform_attempt'
    | 'uniform_case'
    | 'uniform_level'
    | 'uniform_observation'
    | 'uniform_pair'
    | 'uniform_repetition'
    | 'uniform_request'
    | 'uniform_task'
    | 'uniform_tool_call'
    | 'unweighted'
  missingness: 'fail_closed'
  exclusion_policy: 'exclude_unavailable_evidence'
  observed_exclusions: number
}

export interface EvaluationGate {
  id: string
  name: string
  description?: string
  track_id?: EvaluationTrackId
  disposition: GateDisposition
  verdict: GateVerdict
  change_profile: EvaluationChangeProfileId
  contract_version: EvaluationGateContractVersion
  evidence_refs: string[]
  evidence_level?: EvidenceLevel
  observed?: number | null
  threshold?: {
    operator: string
    value: number
    unit?: string
  }
  sample_count?: number
  coverage?: EvaluationCoverage
  owner?: string
  evaluated_at?: string
  rationale?: string
}

export interface EvaluationArtifact {
  id: string
  name: string
  kind: string
  uri?: string
  digest?: string
  media_type?: string
  size_bytes?: number
}

export interface EvaluationProvenance {
  schema_version: EvaluationSchemaVersion
  generated_at: string
  code_revision?: string
  benchmark_revisions?: Record<string, string>
  workload_snapshot_digest?: string
  policy_snapshot_digest?: string
  binding_snapshot_digest?: string
  pool_snapshot_digest?: string
  environment_snapshot_digest?: string
  target_id: string
  seed: number
  redaction_policy?: string
}

export interface EvaluationCostAmount {
  amount: number | null
  currency: string
  input_tokens?: number
  output_tokens?: number
  gpu_seconds?: number
  energy_kwh?: number
}

export interface EvaluationCostLedgers {
  runtime: EvaluationCostAmount
  evaluation_overhead: EvaluationCostAmount
  capacity_tco: EvaluationCostAmount
}

export interface EvaluationTrackReport {
  track_id: EvaluationTrackId
  status: EvaluationTrackStatus
  evidence_level: EvidenceLevel
  summary: string
  coverage: EvaluationCoverage
  metrics: EvaluationMetric[]
  gates: EvaluationGate[]
  artifacts?: EvaluationArtifact[]
  error?: string
}

export interface EvaluationReportSummary {
  verdict: GateVerdict
  quality_score: number | null
  latency_p95_ms: number | null
  runtime_cost: number | null
  capacity_tco: number | null
  coverage: EvaluationCoverage
  passed_gates: number
  failed_gates: number
  unavailable_gates: number
}

export interface EvaluationReport {
  schema_version: EvaluationSchemaVersion
  attestation_revision: EvaluationAttestationRevision
  run: EvaluationRun
  summary: EvaluationReportSummary
  tracks: EvaluationTrackReport[]
  metrics: EvaluationMetric[]
  gates: EvaluationGate[]
  costs: EvaluationCostLedgers
  recommendations: string[]
  provenance: EvaluationProvenance
  artifacts: EvaluationArtifact[]
  method_reports: EvaluationMethodReport[]
  routing_recipe_report?: EvaluationRoutingRecipeReport | null
}

export interface EvaluationRoutingRecipeLatencyReport {
  available: boolean
  reason?: string
  sample_count: number
  p50_ms?: number
  p95_ms?: number
}

export interface EvaluationRoutingRecipeInputAvailabilityReport {
  id: string
  expected: number
  present: number
  missing: number
  error: number
  timeout: number
  latency: EvaluationRoutingRecipeLatencyReport
}

export interface EvaluationRoutingRecipeMetricAvailability {
  available: boolean
  reason?: string
  value?: number
  sample_count: number
}

export interface EvaluationRoutingRecipeReliabilityBin {
  lower: number
  upper: number
  count: number
  mean_prediction?: number
  observed_frequency?: number
}

export interface EvaluationRoutingRecipeProjectionOutcomeReport {
  projection_id: string
  spearman: EvaluationRoutingRecipeMetricAvailability
  brier: EvaluationRoutingRecipeMetricAvailability
  ece_10: EvaluationRoutingRecipeMetricAvailability
  reliability_bins: EvaluationRoutingRecipeReliabilityBin[]
}

export interface EvaluationRoutingRecipeTopKReport {
  k: number
  feasible_oracle_recall: EvaluationRoutingRecipeMetricAvailability
}

export interface EvaluationRoutingRecipeReport {
  contract_version: 'routing-recipe-eval.v1'
  plan_digest: string
  e1: {
    expected_decisions: number
    observed_decisions: number
    signals: EvaluationRoutingRecipeInputAvailabilityReport[]
    projections: EvaluationRoutingRecipeInputAvailabilityReport[]
    eligibility_complete: number
    selected_feasible: number
  }
  e2: {
    projection_outcomes: EvaluationRoutingRecipeProjectionOutcomeReport[]
    top_k: EvaluationRoutingRecipeTopKReport[]
    oracle_regret: EvaluationRoutingRecipeMetricAvailability
  }
}

export interface EvaluationMethodCurvePoint {
  action: { id: string }
  budget: number
  mean_score: number
  case_count: number
}

export type EvaluationMethodReadiness =
  | 'native-qualified'
  | 'exploratory-import'
  | 'data-required'
  | 'blocked'

export interface EvaluationMethodSlice {
  schema_version: 'evaluation-method.v2'
  id: string
}

export interface EvaluationMethodAnalysisPlan {
  schema_version: 'evaluation-method.v2'
  id: string
  analysis_unit: string
  cluster_unit: string
  slices: EvaluationMethodSlice[]
  curve_domain: 'shared_budget' | 'not_applicable'
  missingness: 'fail_closed'
}

export interface EvaluationMethodDescriptor {
  schema_version: 'evaluation-method.v2'
  id: string
  version: 'evaluation-method.v2'
  status: EvaluationMethodReadiness
  execution_owner: 'server' | 'worker' | 'provider' | 'benchmark_native'
  input_schema: string
  export_schema: string
  live_input_complete: boolean
  live_grader: boolean
  applicable_tracks: string[]
  live_tracks: string[]
  produced_metric_ids: string[]
  evidence_ceiling: EvidenceLevel
  native_parity: 'native' | 'source_qualified' | 'none'
  required_artifact_ids: string[]
  analysis_plan: EvaluationMethodAnalysisPlan
}

export interface EvaluationMethodReport {
  method: EvaluationMethodDescriptor
  analysis_plan: EvaluationMethodAnalysisPlan
  action_refs: EvaluationMethodSlice[]
  slice_refs: EvaluationMethodSlice[]
  raw_shared_domain_curve: EvaluationMethodCurvePoint[]
  audc: number
  nauc: number
  peak: number
  qnc: number
  missing_case_action_budget_cells: number
}

export interface EvaluationComparison {
  schema_version: EvaluationSchemaVersion
  attestation_revision: EvaluationAttestationRevision
  baseline_run_id: string
  candidate_run_id: string
  verdict: GateVerdict
  summary: string
  metrics: EvaluationMetric[]
  statistics: EvaluationComparisonStatistic[]
  gates: EvaluationGate[]
  recommendations: string[]
  created_at: string
}

export interface EvaluationComparisonStatistic {
  id: string
  track_id: EvaluationTrackId
  /** Server-owned paired delta estimator; distinct from Metric point-estimate provenance. */
  estimator_id: 'paired-bootstrap-case-clustered-delta'
  estimator_version: 'v1'
  analysis_unit: 'case_mean' | 'case_max' | 'case_oracle_regret' | 'case_normalized_regret'
  direction: 'higher_is_better' | 'lower_is_better'
  non_inferiority_margin: number
  baseline_value: number
  candidate_value: number
  delta: number
  confidence_level: number
  delta_confidence_interval: number[]
  candidate_confidence_interval: number[]
  sample_count: number
  verdict: Extract<GateVerdict, 'pass' | 'fail' | 'unavailable'>
}

export interface EvaluationFailureSummaryRow {
  track_id: EvaluationTrackId
  succeeded: number
  failed: number
  unavailable: number
}

export interface EvaluationFailureSummary {
  schema_version: EvaluationSchemaVersion
  total_records: number
  failed: number
  unavailable: number
  by_track: EvaluationFailureSummaryRow[]
}

export interface EvaluationCapacityRepetition {
  concurrency: number
  requests: number
  successes: number
  errors: number
  elapsed_seconds: number
  throughput_rps: number
  latency_p95_ms: number
  repetition: number
}

export interface EvaluationCapacityLevel {
  concurrency: number
  warmup_requests: number
  warmup_errors: number
  warmup_elapsed_seconds: number
  measurement_requests: number
  successes: number
  errors: number
  elapsed_seconds: number
  throughput_rps: number
  throughput_cv: number
  latency_p50_ms: number
  latency_p95_ms: number
  latency_p99_ms: number
  latency_p95_cv: number
  error_rate: number
  error_rate_upper_bound: number
  input_tokens: number
  output_tokens: number
  runtime_cost_usd: number
  repetitions: EvaluationCapacityRepetition[]
  throughput_scaling_efficiency: number | null
  warmup_passed: boolean
  latency_slo_passed: boolean
  error_slo_passed: boolean
  throughput_slo_passed: boolean
  scaling_slo_passed: boolean
  throughput_stability_passed: boolean
  latency_stability_passed: boolean
  qualified: boolean
}

export type EvaluationCapacityFailureReason =
  | 'required_concurrency'
  | 'warmup_errors'
  | 'latency_p95'
  | 'error_rate_upper_bound'
  | 'throughput'
  | 'throughput_scaling'
  | 'throughput_stability'
  | 'latency_stability'

export interface EvaluationCapacitySLOAssessment {
  qualified_concurrency: number | null
  saturation_concurrency: number | null
  slo_headroom: number
  verdict: 'pass' | 'fail'
  failure_reasons: EvaluationCapacityFailureReason[]
}

export interface EvaluationCapacityProfile {
  schema_version: EvaluationSchemaVersion
  kind: 'repeated-closed-loop-capacity'
  protocol: EvaluationCapacityLoadProtocol
  levels: EvaluationCapacityLevel[]
  slo: EvaluationCapacitySLO
  assessment: EvaluationCapacitySLOAssessment
}
