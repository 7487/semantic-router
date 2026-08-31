import { useCallback, useEffect, useRef, useState } from 'react'

import type { EvaluationControlledPairExecution } from '../types/evaluationControlledPair'
import {
  createEvaluationControlledPair,
  EvaluationRequestError,
  getEvaluationControlledPair,
} from '../utils/evaluationPlaneApi'
import { buildCreateEvaluationControlledPairPayload } from '../utils/evaluationControlledPairContract'

type ControlledPairStatus =
  | 'idle'
  | 'creating'
  | 'recovering'
  | 'running'
  | 'assigning'
  | 'ready'
  | 'error'

interface ControlledPairState {
  status: ControlledPairStatus
  execution: EvaluationControlledPairExecution | null
  error: string | null
  sourceIDs: { baseline: string; candidate: string } | null
}

const INITIAL_STATE: ControlledPairState = {
  status: 'idle',
  execution: null,
  error: null,
  sourceIDs: null,
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export type EvaluationControlledPairReadyGuard = () => boolean
type EvaluationControlledPairReadyHandler = (
  execution: EvaluationControlledPairExecution,
  isCurrent: EvaluationControlledPairReadyGuard,
) => void | Promise<void>

interface EvaluationControlledPairWorkflow {
  activePairID: string | null
  onPairIdentity: (pairID: string | null) => void | Promise<void>
}

export async function handoffEvaluationControlledPair(
  execution: EvaluationControlledPairExecution,
  onReady: EvaluationControlledPairReadyHandler,
  isCurrent: EvaluationControlledPairReadyGuard = () => true,
): Promise<string | null> {
  if (!isCurrent()) return null
  try {
    await onReady(execution, isCurrent)
    return null
  } catch (error) {
    return message(
      error,
      'Controlled pair completed, but its fresh runs could not be assigned to the campaign.',
    )
  }
}

function terminalFailure(execution: EvaluationControlledPairExecution): string | null {
  if (execution.state !== 'terminal') return null
  for (const [label, run] of [
    ['Baseline', execution.baseline_run],
    ['Candidate', execution.candidate_run],
  ] as const) {
    if (run.status === 'failed')
      return `${label} controlled run failed: ${run.error || 'no server rationale was returned.'}`
    if (run.status === 'cancelled') return `${label} controlled run was cancelled.`
  }
  return null
}

function isReady(execution: EvaluationControlledPairExecution): boolean {
  return (
    execution.state === 'terminal' &&
    execution.baseline_run.status === 'completed' &&
    execution.candidate_run.status === 'completed'
  )
}

export function useEvaluationControlledPair(
  onReady: EvaluationControlledPairReadyHandler,
  workflow: EvaluationControlledPairWorkflow,
) {
  const [state, setState] = useState<ControlledPairState>(INITIAL_STATE)
  const requestVersion = useRef(0)
  const mounted = useRef(false)
  const onReadyRef = useRef(onReady)
  const onPairIdentityRef = useRef(workflow.onPairIdentity)
  const creatingPairID = useRef<string | null>(null)
  const reconciledRoutePairID = useRef<string | null>(null)
  const deliveredExecutionID = useRef<string | null>(null)
  onReadyRef.current = onReady
  onPairIdentityRef.current = workflow.onPairIdentity

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestVersion.current += 1
      reconciledRoutePairID.current = null
    }
  }, [])

  const deliverReady = useCallback(
    async (execution: EvaluationControlledPairExecution, generation: number) => {
      const isCurrent = () => mounted.current && generation === requestVersion.current
      if (!isCurrent() || deliveredExecutionID.current === execution.id) return
      setState((current) => ({ ...current, status: 'assigning', execution, error: null }))
      const handoffError = await handoffEvaluationControlledPair(
        execution,
        onReadyRef.current,
        isCurrent,
      )
      if (!isCurrent()) return
      if (handoffError) {
        setState((current) => ({
          ...current,
          status: 'error',
          execution,
          error: handoffError,
        }))
        return
      }
      deliveredExecutionID.current = execution.id
      setState((current) => ({ ...current, status: 'ready', execution, error: null }))
    },
    [],
  )

  const create = useCallback(
    async (baselineSourceRunID: string, candidateSourceRunID: string) => {
      const version = ++requestVersion.current
      deliveredExecutionID.current = null
      setState({
        status: 'creating',
        execution: null,
        error: null,
        sourceIDs: { baseline: baselineSourceRunID, candidate: candidateSourceRunID },
      })
      try {
        const request = buildCreateEvaluationControlledPairPayload(
          baselineSourceRunID,
          candidateSourceRunID,
        )
        creatingPairID.current = request.client_request_id
        await onPairIdentityRef.current(request.client_request_id)
        if (!mounted.current || version !== requestVersion.current) return null
        const execution = await createEvaluationControlledPair(request)
        if (!mounted.current || version !== requestVersion.current) return null
        creatingPairID.current = null
        const failure = terminalFailure(execution)
        if (failure) {
          setState({
            status: 'error',
            execution,
            error: failure,
            sourceIDs: { baseline: baselineSourceRunID, candidate: candidateSourceRunID },
          })
          return null
        }
        if (isReady(execution)) {
          setState({
            status: 'assigning',
            execution,
            error: null,
            sourceIDs: { baseline: baselineSourceRunID, candidate: candidateSourceRunID },
          })
          await deliverReady(execution, version)
          if (!mounted.current || version !== requestVersion.current) return null
        } else {
          setState({
            status: 'running',
            execution,
            error: null,
            sourceIDs: { baseline: baselineSourceRunID, candidate: candidateSourceRunID },
          })
        }
        return execution
      } catch (error) {
        if (!mounted.current || version !== requestVersion.current) return null
        creatingPairID.current = null
        if (error instanceof EvaluationRequestError && error.status >= 400 && error.status < 500) {
          await onPairIdentityRef.current(null)
          if (!mounted.current || version !== requestVersion.current) return null
        }
        setState({
          status: 'error',
          execution: null,
          error: message(error, 'Controlled AB/BA execution could not be created.'),
          sourceIDs: { baseline: baselineSourceRunID, candidate: candidateSourceRunID },
        })
        return null
      }
    },
    [deliverReady],
  )

  const reconcile = useCallback(
    async (pairID: string) => {
      const version = ++requestVersion.current
      deliveredExecutionID.current = null
      setState((current) => ({
        status: 'recovering',
        execution: current.execution?.id === pairID ? current.execution : null,
        error: null,
        sourceIDs: current.execution?.id === pairID ? current.sourceIDs : null,
      }))
      try {
        const execution = await getEvaluationControlledPair(pairID)
        if (!mounted.current || version !== requestVersion.current) return null
        const failure = terminalFailure(execution)
        if (failure) {
          setState((current) => ({ ...current, status: 'error', execution, error: failure }))
          return null
        }
        if (isReady(execution)) {
          await deliverReady(execution, version)
          if (!mounted.current || version !== requestVersion.current) return null
        } else {
          setState((current) => ({
            ...current,
            status: 'running',
            execution,
            error: null,
          }))
        }
        return execution
      } catch (error) {
        if (!mounted.current || version !== requestVersion.current) return null
        setState((current) => ({
          ...current,
          status: 'error',
          execution: null,
          error: message(
            error,
            'The saved controlled-pair workflow could not be reconciled with the server.',
          ),
        }))
        return null
      }
    },
    [deliverReady],
  )

  useEffect(() => {
    const activePairID = workflow.activePairID
    if (!activePairID) {
      reconciledRoutePairID.current = null
      return
    }
    if (state.status === 'creating' && creatingPairID.current === activePairID) return
    if (state.execution?.id === activePairID || reconciledRoutePairID.current === activePairID)
      return
    reconciledRoutePairID.current = activePairID
    void reconcile(activePairID)
  }, [reconcile, state.execution?.id, state.status, workflow.activePairID])

  const pairID = state.execution?.id

  useEffect(() => {
    if (state.status !== 'running' || !pairID) return
    const version = requestVersion.current
    let stopped = false
    let timer: number | undefined
    let controller: AbortController | null = null

    const poll = async () => {
      controller?.abort()
      controller = new AbortController()
      try {
        const next = await getEvaluationControlledPair(pairID, controller.signal)
        if (stopped || !mounted.current || version !== requestVersion.current) return
        const failure = terminalFailure(next)
        if (failure) {
          setState((current) => ({ ...current, status: 'error', execution: next, error: failure }))
          return
        }
        if (isReady(next)) {
          await deliverReady(next, version)
          return
        }
        setState((current) => ({ ...current, execution: next, error: null }))
        timer = window.setTimeout(() => void poll(), 2_000)
      } catch (error) {
        if (
          stopped ||
          controller.signal.aborted ||
          !mounted.current ||
          version !== requestVersion.current
        )
          return
        setState((current) => ({
          ...current,
          status: 'error',
          error: message(error, 'Controlled pair progress is temporarily unreachable.'),
        }))
      }
    }

    timer = window.setTimeout(() => void poll(), 500)
    return () => {
      stopped = true
      controller?.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [deliverReady, pairID, state.status])

  const retry = useCallback(() => {
    const terminal = state.execution ? terminalFailure(state.execution) : null
    if (state.execution && isReady(state.execution) && !terminal) {
      const generation = ++requestVersion.current
      void deliverReady(state.execution, generation)
      return
    }
    if (workflow.activePairID) {
      void reconcile(workflow.activePairID)
      return
    }
    if (!state.sourceIDs) return
    if (!state.execution || terminal) {
      void create(state.sourceIDs.baseline, state.sourceIDs.candidate)
      return
    }
    requestVersion.current += 1
    setState((current) => ({ ...current, status: 'running', error: null }))
  }, [create, deliverReady, reconcile, state.execution, state.sourceIDs, workflow.activePairID])

  const reset = useCallback(() => {
    requestVersion.current += 1
    deliveredExecutionID.current = null
    creatingPairID.current = null
    reconciledRoutePairID.current = null
    setState(INITIAL_STATE)
  }, [])

  return {
    ...state,
    create,
    retry,
    reset,
  }
}
