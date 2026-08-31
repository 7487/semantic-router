import type { EvaluationChangeProfileId, EvaluationRun } from '../../types/evaluationPlane'

type RunOptionIdentity = Pick<
  EvaluationRun,
  'id' | 'name' | 'change_profile' | 'mode' | 'evidence_level' | 'sample_limit'
>

const CHANGE_PROFILE_LABELS: Record<EvaluationChangeProfileId, string> = {
  schema_adapter: 'Schema adapter',
  recipe: 'Routing recipe',
  selector: 'Selector',
  model_pool: 'Model pool',
  runtime_capacity: 'Runtime capacity',
  agent_multimodal: 'Agent + multimodal',
  online_adaptation: 'Online adaptation',
}

type RunCohortIdentity = Pick<EvaluationRun, 'mixture'>

export function changeProfileLabel(profile: EvaluationChangeProfileId): string {
  return CHANGE_PROFILE_LABELS[profile]
}

/**
 * A run retains an internal target identifier for attestation, but the Compare
 * view should orient people with the evaluated public Mixture instead.
 */
export function runCohortTargetLabel(run: RunCohortIdentity): string {
  return run.mixture?.entrypoint_model || 'Frozen deployment snapshot'
}

function compactRunID(runID: string): string {
  return runID.replace(/-/g, '')
}

function uniqueSuffixWidth(runIDs: string[]): number {
  const compactIDs = [...new Set(runIDs)].map(compactRunID)
  const maximumWidth = Math.max(0, ...compactIDs.map((id) => id.length))
  let width = Math.min(8, maximumWidth)
  while (width < maximumWidth) {
    const suffixes = compactIDs.map((id) => id.slice(-width))
    if (new Set(suffixes).size === suffixes.length) break
    width = Math.min(width + 4, maximumWidth)
  }
  return width
}

export function runOptionLabels(runs: readonly RunOptionIdentity[]): Map<string, string> {
  const distinctRuns = [...new Map(runs.map((run) => [run.id, run])).values()]
  const suffixWidth = uniqueSuffixWidth(distinctRuns.map((run) => run.id))
  return new Map(
    distinctRuns.map((run) => [
      run.id,
      [
        run.name,
        `#${compactRunID(run.id).slice(-suffixWidth)}`,
        changeProfileLabel(run.change_profile),
        run.mode === 'live' ? 'Live' : 'Replay',
        run.evidence_level,
        `n=${run.sample_limit}`,
      ].join(' · '),
    ]),
  )
}
