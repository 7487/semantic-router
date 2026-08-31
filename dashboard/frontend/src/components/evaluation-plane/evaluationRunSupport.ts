import type { EvaluationRun } from '../../types/evaluationPlane'
import {
  equalEvaluationCapacityLoadProtocol,
  equalEvaluationCapacitySLO,
} from '../../utils/evaluationCapacitySLOContract'

function sameOrderedMembers<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function sameMixtureIdentity(baseline: EvaluationRun, candidate: EvaluationRun): boolean {
  if (!baseline.mixture || !candidate.mixture) return baseline.mixture === candidate.mixture
  return (
    baseline.mixture.id === candidate.mixture.id &&
    baseline.mixture.recipe_name === candidate.mixture.recipe_name
  )
}

export function cohortMismatches(baseline: EvaluationRun, candidate: EvaluationRun): string[] {
  const mismatches: string[] = []
  if (baseline.mode !== candidate.mode) mismatches.push('mode')
  if (baseline.target_id !== candidate.target_id) mismatches.push('target')
  if (baseline.change_profile !== candidate.change_profile) mismatches.push('change profile')
  if (baseline.sample_limit !== candidate.sample_limit) mismatches.push('sample limit')
  if (baseline.concurrency !== candidate.concurrency) mismatches.push('concurrency')
  if (baseline.seed !== candidate.seed) mismatches.push('seed')
  if (!sameMixtureIdentity(baseline, candidate)) mismatches.push('mixture')
  if (!equalEvaluationCapacitySLO(baseline.capacity_slo, candidate.capacity_slo))
    mismatches.push('capacity SLO')
  if (
    !equalEvaluationCapacityLoadProtocol(
      baseline.capacity_load_protocol,
      candidate.capacity_load_protocol,
    )
  )
    mismatches.push('capacity load protocol')
  if (!sameOrderedMembers(baseline.suite_ids, candidate.suite_ids)) mismatches.push('suites')
  if (!sameOrderedMembers(baseline.track_ids, candidate.track_ids)) mismatches.push('tracks')
  return mismatches
}

export function comparisonCohortMismatches(
  baseline: EvaluationRun,
  candidate: EvaluationRun,
): string[] {
  const baselinePair = baseline.controlled_pair
  const candidatePair = candidate.controlled_pair
  const hasControlledPairMembership = Boolean(baselinePair || candidatePair)
  const sameControlledPair =
    baselinePair?.role === 'baseline' &&
    candidatePair?.role === 'candidate' &&
    baselinePair.pair_id === candidatePair.pair_id &&
    candidate.baseline_run_id === baseline.id

  const mismatches = cohortMismatches(baseline, candidate)
  if (!hasControlledPairMembership) return mismatches
  if (!sameControlledPair) return [...mismatches, 'controlled pair lineage']
  if (baseline.mode !== 'live' || candidate.mode !== 'live') return ['controlled pair mode']
  if (!baseline.mixture || !candidate.mixture) return ['controlled pair mixture']
  if (baseline.target_id === candidate.target_id) return ['controlled pair target']
  return mismatches.filter((mismatch) => mismatch !== 'target')
}

export function eligibleComparisonCandidates(runs: EvaluationRun[]): EvaluationRun[] {
  const completed = new Map(
    runs.filter((run) => run.status === 'completed').map((run) => [run.id, run]),
  )
  return runs.filter((candidate) => {
    if (candidate.status !== 'completed' || !candidate.baseline_run_id) return false
    const baseline = completed.get(candidate.baseline_run_id)
    return Boolean(
      baseline &&
        baseline.id !== candidate.id &&
        comparisonCohortMismatches(baseline, candidate).length === 0,
    )
  })
}

export function defaultComparisonPair(runs: EvaluationRun[]): {
  baselineID: string
  candidateID: string
} | null {
  const candidate = eligibleComparisonCandidates(runs)[0]
  return candidate?.baseline_run_id
    ? { baselineID: candidate.baseline_run_id, candidateID: candidate.id }
    : null
}
