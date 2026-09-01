import type {
  EvaluationCatalog,
  EvaluationCatalogCampaignSlot,
  EvaluationRun,
} from '../types/evaluationPlane'
import { EVALUATION_TRACK_IDS } from '../types/evaluationPlane'

export const RUN_ID = '11111111-1111-4111-8111-111111111111'

export const canonicalCampaignSlots = [
  ['G2', 'run'],
  ['G3', 'controlled_pair'],
  ['G4', 'run'],
  ['G5', 'fidelity_pair'],
  ['G6', 'run'],
  ['G7', 'run'],
  ['G8', 'run'],
  ['G9', 'run'],
].map(([gate_id, binding_kind]) => ({
  gate_id,
  name: `${gate_id} evidence`,
  description: 'Server campaign slot.',
  disposition: 'not_applicable',
  binding_kind,
  minimum_evidence_level: 'E0',
  accepted_executor_ids: [],
})) as EvaluationCatalogCampaignSlot[]

const canonicalBuiltinSuiteIDs = [
  'evaluation-smoke',
  'live-mom-core',
  'live-agent-tasks',
  'live-fault-recovery',
  'live-multimodal',
  'live-hard-policy',
  'live-production-experiment',
  'live-capacity',
] as const

const canonicalCatalogTracks: EvaluationCatalog['tracks'] = EVALUATION_TRACK_IDS.map((trackID) => ({
  id: trackID,
  name: trackID,
  description: `${trackID} evaluation area`,
  modes: ['replay'],
  metrics: [],
  evidence_levels: ['E2'],
}))

export const canonicalBuiltinSuites: EvaluationCatalog['suites'] = canonicalBuiltinSuiteIDs.map(
  (suiteID, index) => {
    const trackID = EVALUATION_TRACK_IDS[index]
    return {
      id: suiteID,
      executors: { replay: `fixture-${trackID}.v1` },
      name: suiteID,
      description: `${trackID} built-in benchmark`,
      track_ids: [trackID],
      modes: ['replay'],
      evidence_level: 'E2',
      campaign_eligible: false,
      campaign_minimum_cases: 0,
      revision: `${suiteID}.v1`,
      tags: ['fixture'],
      methods: [
        {
          id: `fixture.${trackID}.builtin.v1`,
          track_id: trackID,
          qualified_gate_ids: [],
          evidence_source: 'diagnostic_fixture',
          status: 'configured',
        },
      ],
    }
  },
)

export function evaluationCatalogFixture(
  overrides: Partial<EvaluationCatalog> = {},
): EvaluationCatalog {
  return {
    schema_version: 'evaluation.v1',
    gate_contract_version: 'evaluation-release-gates.v2',
    generated_at: '2026-08-29T00:00:00Z',
    change_profiles: [
      {
        id: 'recipe',
        name: 'Routing recipe',
        description: 'Recipe signal, decision, algorithm, and policy changes.',
        campaign_slots: canonicalCampaignSlots,
      },
    ],
    tracks: canonicalCatalogTracks,
    suites: canonicalBuiltinSuites,
    targets: [],
    ...overrides,
  }
}

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
