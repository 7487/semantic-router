import type { EvaluationRun } from '../types/evaluationPlane'

export const RUN_ID = '11111111-1111-4111-8111-111111111111'

export const run: EvaluationRun = {
  schema_version: 'evaluation.v1',
  id: RUN_ID,
  client_request_id: RUN_ID,
  name: 'Candidate',
  description: 'Compare recipe',
  status: 'pending',
  mode: 'replay',
  evidence_level: 'E2',
  track_evidence_levels: { routing: 'E2' },
  target_id: 'target-approved',
  change_profile: 'recipe',
  suite_ids: ['suite-routing'],
  track_ids: ['routing'],
  sample_limit: 25,
  concurrency: 2,
  seed: 42,
  progress: { percent: 0, completed: 0, total: 1 },
  created_at: '2026-08-29T00:00:00Z',
}
