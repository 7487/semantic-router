import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { EvaluationRun } from '../../types/evaluationPlane'
import type {
  EvaluationComparison,
  EvaluationMetricAnalysisProvenance,
} from '../../types/evaluationReport'
import { EVALUATION_ATTESTATION_REVISION } from '../../types/evaluationPlane'
import { metricAnalysisSpecification } from '../../utils/evaluationReportContract'
import { buildEvaluationRoutingRecipePlan } from '../../test/evaluationRoutingRecipeFixture'
import EvaluationCompare from './EvaluationCompare'

function analysisProvenance(metricID: string): EvaluationMetricAnalysisProvenance {
  return {
    contract_version: 'metric-analysis.v1',
    ...metricAnalysisSpecification(metricID),
    estimator_version: 'v1',
    missingness: 'fail_closed',
    exclusion_policy: 'exclude_unavailable_evidence',
    observed_exclusions: 0,
  }
}

const baseline: EvaluationRun = {
  schema_version: 'evaluation.v1',
  id: 'baseline',
  client_request_id: 'baseline',
  name: 'Baseline',
  description: '',
  status: 'completed',
  mode: 'replay',
  evidence_level: 'E0',
  track_evidence_levels: { safety: 'E0' },
  target_id: 'target-a',
  change_profile: 'recipe',
  suite_ids: ['suite-a'],
  track_ids: ['safety'],
  sample_limit: 4,
  concurrency: 1,
  seed: 7,
  progress: { percent: 100, completed: 4, total: 4 },
  created_at: '2026-08-30T00:00:00Z',
}

const candidate: EvaluationRun = {
  ...baseline,
  id: 'candidate',
  client_request_id: 'candidate',
  name: 'Candidate',
  baseline_run_id: baseline.id,
}

const comparison: EvaluationComparison = {
  schema_version: 'evaluation.v1',
  attestation_revision: EVALUATION_ATTESTATION_REVISION,
  baseline_run_id: baseline.id,
  candidate_run_id: candidate.id,
  verdict: 'unavailable',
  summary: 'Diagnostic comparison',
  metrics: [
    {
      id: 'safety.violation_rate',
      name: 'Safety violation rate',
      track_id: 'safety',
      value: 0,
      unit: 'violations/case',
      analysis_provenance: analysisProvenance('safety.violation_rate'),
    },
  ],
  statistics: [
    {
      id: 'joint.normalized_regret',
      track_id: 'joint',
      estimator_id: 'paired-bootstrap-case-clustered-delta',
      estimator_version: 'v1',
      analysis_unit: 'case_normalized_regret',
      direction: 'lower_is_better',
      non_inferiority_margin: 0.05,
      baseline_value: 0.2,
      candidate_value: 0.1,
      delta: -0.1,
      confidence_level: 0.95,
      delta_confidence_interval: [],
      candidate_confidence_interval: [],
      sample_count: 4,
      verdict: 'unavailable',
    },
  ],
  gates: [],
  recommendations: [],
  created_at: '2026-08-30T00:02:00Z',
}

function renderComparison(
  value: EvaluationComparison,
  runs: EvaluationRun[] = [candidate, baseline],
  baselineID = baseline.id,
  candidateID = candidate.id,
): string {
  return renderToStaticMarkup(
    createElement(EvaluationCompare, {
      runs,
      baselineID,
      candidateID,
      comparison: value,
      runLedgerAvailable: true,
      runLedgerComplete: true,
      totalRuns: 2,
      hasMoreRuns: false,
      loadingMoreRuns: false,
      resourcesLoading: false,
      resourcesError: null,
      loading: false,
      error: null,
      onPairChange: () => undefined,
      onCompare: () => undefined,
      onLoadMoreRuns: () => undefined,
      onRetryResources: () => undefined,
    }),
  )
}

describe('EvaluationCompare evidence labels', () => {
  it('renders the current attested comparison contract', () => {
    const markup = renderComparison(comparison)

    expect(markup).toContain('Server-reduced E0')
    expect(markup).toContain('Diagnostic comparison')
    expect(markup).toContain('Paired scientific statistics')
    expect(markup).toContain('Case normalized regret')
    expect(markup).toContain('Needs at least 20 independent case units; observed 4.')
    expect(markup).toContain('Not estimable')
    expect(markup.match(/<select/g)).toHaveLength(1)
    expect(markup).toContain('Read-only scientific lineage')
  })

  it('states that server-owned Routing Recipe aggregates are not generic comparison metrics', () => {
    const mixtureBase = {
      id: 'mom',
      entrypoint_model: 'vllm-sr/auto',
      aliases: ['vllm-sr/auto'],
      recipe_name: 'balanced',
      recipe_description: '',
      recipe_digest: `sha256:${'1'.repeat(64)}`,
      pool_digest: `sha256:${'2'.repeat(64)}`,
      selector_policy_digest: `sha256:${'3'.repeat(64)}`,
      selector_digest: `sha256:${'4'.repeat(64)}`,
      adaptation_digest: `sha256:${'5'.repeat(64)}`,
      binding_digest: `sha256:${'6'.repeat(64)}`,
      model_arms: [
        {
          id: 'arm',
          model: 'model',
          provider_model_id_digest: `sha256:${'7'.repeat(64)}`,
          input_cost_per_million_tokens_usd: 0,
          output_cost_per_million_tokens_usd: 0,
        },
      ],
      support_models: [],
      fallback_arm_id: 'arm',
      decisions: [{ name: 'route', algorithm: 'static', arm_ids: ['arm'] }],
    }
    const mixture = {
      ...mixtureBase,
      routing_recipe_plan: buildEvaluationRoutingRecipePlan(mixtureBase),
    }
    const routingBaseline: EvaluationRun = {
      ...baseline,
      id: 'routing-baseline',
      client_request_id: 'routing-baseline',
      mode: 'live',
      track_ids: ['routing'],
      track_evidence_levels: { routing: 'E3' },
      evidence_level: 'E3',
      mixture,
    }
    const routingCandidate: EvaluationRun = {
      ...routingBaseline,
      id: 'routing-candidate',
      client_request_id: 'routing-candidate',
      baseline_run_id: routingBaseline.id,
    }
    const markup = renderComparison(
      { ...comparison, baseline_run_id: routingBaseline.id, candidate_run_id: routingCandidate.id },
      [routingCandidate, routingBaseline],
      routingBaseline.id,
      routingCandidate.id,
    )
    expect(markup).toContain('Routing Recipe comparison unavailable')
    expect(markup).toContain('not projected into generic paired metrics')

    const replayBaseline = { ...routingBaseline, mode: 'replay' as const }
    const replayCandidate = {
      ...routingCandidate,
      mode: 'replay' as const,
      baseline_run_id: replayBaseline.id,
    }
    expect(
      renderComparison(
        {
          ...comparison,
          baseline_run_id: replayBaseline.id,
          candidate_run_id: replayCandidate.id,
        },
        [replayCandidate, replayBaseline],
        replayBaseline.id,
        replayCandidate.id,
      ),
    ).not.toContain('Routing Recipe comparison unavailable')
  })
})
