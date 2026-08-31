import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type {
  EvaluationControlledPairExecution,
  EvaluationControlledPairState,
} from '../../types/evaluationControlledPair'
import type { EvaluationRun } from '../../types/evaluationPlane'
import EvaluationRunInspector from './EvaluationRunInspector'

const run: EvaluationRun = {
  schema_version: 'evaluation.v1',
  id: '11111111-1111-4111-8111-111111111111',
  client_request_id: '11111111-1111-4111-8111-111111111111',
  name: 'Durable routing evidence',
  description: '',
  status: 'completed',
  mode: 'replay',
  evidence_level: 'E0',
  track_evidence_levels: { routing: 'E0' },
  target_id: 'fixture',
  change_profile: 'recipe',
  suite_ids: ['evaluation-smoke'],
  track_ids: ['routing'],
  sample_limit: 4,
  concurrency: 1,
  seed: 42,
  progress: { percent: 100, completed: 1, total: 1 },
  created_at: '2026-08-30T00:00:00Z',
  completed_at: '2026-08-30T00:00:30Z',
}

const pairID = '22222222-2222-4222-8222-222222222222'
const pairCandidateID = '33333333-3333-4333-8333-333333333333'

function pairMember(
  role: 'baseline' | 'candidate',
  status: EvaluationRun['status'],
): EvaluationRun {
  const terminal = ['completed', 'failed', 'cancelled'].includes(status)
  return {
    ...run,
    id: role === 'baseline' ? run.id : pairCandidateID,
    client_request_id: role === 'baseline' ? run.id : pairCandidateID,
    name: role === 'baseline' ? 'Controlled baseline' : 'Controlled candidate',
    status,
    mode: 'live',
    baseline_run_id: role === 'candidate' ? run.id : undefined,
    controlled_pair: { pair_id: pairID, role },
    started_at: status === 'pending' ? undefined : run.created_at,
    completed_at: terminal ? run.completed_at : undefined,
  }
}

function pairExecution(
  baseline: EvaluationRun,
  candidate: EvaluationRun,
  state: EvaluationControlledPairState,
): EvaluationControlledPairExecution {
  return {
    schema_version: 'evaluation.v1',
    contract_version: 'evaluation-controlled-pair.v1',
    id: pairID,
    protocol: 'abba-interleaved.v1',
    baseline_source_run_id: '44444444-4444-4444-8444-444444444444',
    candidate_source_run_id: '55555555-5555-4555-8555-555555555555',
    baseline_run: baseline,
    candidate_run: candidate,
    state,
    capabilities:
      state === 'running'
        ? { can_cancel: true, can_delete: false }
        : { can_cancel: false, can_delete: true },
  }
}

function renderInspector(
  value: EvaluationRun | null,
  loading: boolean,
  error: string | null = null,
  options: {
    canRun?: boolean
    canDelete?: boolean
    mutationKey?: string | null
    controlledPairExecution?: EvaluationControlledPairExecution | null
    controlledPairLoading?: boolean
    controlledPairRefreshing?: boolean
    controlledPairError?: string | null
  } = {},
) {
  return renderToStaticMarkup(
    createElement(EvaluationRunInspector, {
      selectedRunID: run.id,
      run: value,
      loading,
      error,
      controlledPairExecution: options.controlledPairExecution ?? null,
      controlledPairLoading: options.controlledPairLoading ?? false,
      controlledPairRefreshing: options.controlledPairRefreshing ?? false,
      controlledPairError: options.controlledPairError ?? null,
      events: [],
      eventsConnected: false,
      eventsError: null,
      canRun: options.canRun ?? true,
      canDelete: options.canDelete ?? true,
      mutationKey: options.mutationKey ?? null,
      onRetry: () => undefined,
      onRetryControlledPair: () => undefined,
      onReconnectEvents: () => undefined,
      onStart: () => undefined,
      onCancel: () => undefined,
      onDelete: () => undefined,
      onOpenReport: () => undefined,
    }),
  )
}

describe('EvaluationRunInspector refresh continuity', () => {
  it('keeps the durable run visible while a detail refresh is in flight', () => {
    const markup = renderInspector(run, true)

    expect(markup).toContain('Durable routing evidence')
    expect(markup).toContain('Refreshing details…')
    expect(markup).toContain('Open report')
    expect(markup).not.toContain('Loading evaluation run')
  })

  it('uses the loading boundary only when no durable run is available', () => {
    const markup = renderInspector(null, true)

    expect(markup).toContain('Loading evaluation run')
    expect(markup).not.toContain('Refreshing details…')
  })

  it('keeps stale evidence inspectable when the latest detail refresh fails', () => {
    const markup = renderInspector(run, false, 'temporary detail failure')

    expect(markup).toContain('Showing the last durable ledger snapshot')
    expect(markup).toContain('temporary detail failure')
    expect(markup).toContain('Retry details')
    expect(markup).toContain('Durable routing evidence')
  })

  it('uses aggregate capabilities when one member is terminal but the pair is running', () => {
    const baseline = pairMember('baseline', 'completed')
    const candidate = pairMember('candidate', 'running')
    const running = pairExecution(baseline, candidate, 'running')
    const terminalMember = renderInspector(baseline, false, null, {
      controlledPairExecution: running,
    })

    expect(terminalMember).toContain('>Open report<')
    expect(terminalMember).toContain(`aria-label="Cancel controlled pair ${pairID}"`)
    expect(terminalMember).toContain('>Cancel pair<')
    expect(terminalMember).not.toContain('>Start<')
    expect(terminalMember).not.toContain('>Delete pair<')
  })

  it('exposes only authoritative aggregate lifecycle actions for controlled-pair members', () => {
    const baseline = pairMember('baseline', 'completed')
    const candidate = pairMember('candidate', 'completed')
    const terminal = renderInspector(baseline, false, null, {
      controlledPairExecution: pairExecution(baseline, candidate, 'terminal'),
    })
    expect(terminal).toContain('>Open report<')
    expect(terminal).toContain(`aria-label="Delete controlled pair ${pairID}"`)
    expect(terminal).toContain('>Delete pair<')
    expect(terminal).not.toContain('aria-label="Delete Controlled baseline"')

    const pendingBaseline = pairMember('baseline', 'pending')
    const pendingCandidate = pairMember('candidate', 'pending')
    const queued = renderInspector(pendingBaseline, false, null, {
      controlledPairExecution: pairExecution(pendingBaseline, pendingCandidate, 'pending'),
    })
    expect(queued).toContain('>Delete pair<')
    expect(queued).not.toContain('>Start<')
  })

  it('honors permissions and aggregate mutation state for pair actions', () => {
    const pairedRun = pairMember('baseline', 'completed')
    const execution = pairExecution(pairedRun, pairMember('candidate', 'completed'), 'terminal')
    const readonly = renderInspector(pairedRun, false, null, {
      canRun: false,
      canDelete: false,
      controlledPairExecution: execution,
    })
    expect(readonly).toContain('>Open report<')
    expect(readonly).not.toContain('>Delete pair<')

    const pending = renderInspector(pairedRun, false, null, {
      mutationKey: `delete-pair:${pairID}`,
      controlledPairExecution: execution,
    })
    expect(pending).toContain('>Deleting pair…<')
    expect(pending).toContain('disabled=""')
  })

  it('withholds pair actions until the authoritative resource is available and owns its error', () => {
    const pairedRun = pairMember('baseline', 'completed')
    const loading = renderInspector(pairedRun, false, null, { controlledPairLoading: true })
    expect(loading).toContain('Loading pair controls…')
    expect(loading).not.toContain('>Cancel pair<')
    expect(loading).not.toContain('>Delete pair<')

    const failed = renderInspector(pairedRun, false, null, {
      controlledPairError: 'temporary pair read failure',
    })
    expect(failed).toContain('Controlled-pair controls are unavailable')
    expect(failed).toContain('temporary pair read failure')
    expect(failed).toContain('Retry pair controls')
    expect(failed).not.toContain('>Cancel pair<')
    expect(failed).not.toContain('>Delete pair<')
  })
})
