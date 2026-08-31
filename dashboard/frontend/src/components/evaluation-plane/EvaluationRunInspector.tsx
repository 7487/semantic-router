import type { EvaluationRun, EvaluationRunEvent } from '../../types/evaluationPlane'
import type { EvaluationControlledPairExecution } from '../../types/evaluationControlledPair'
import { formatDurationBetween } from '../../utils/dateTime'
import ProductLoadingState from '../ProductLoadingState'
import { EvaluationActionButton, RunStatusBadge, TrackChips } from './EvaluationPrimitives'
import EvaluationRunTimeline from './EvaluationRunTimeline'
import planeStyles from './EvaluationPlane.module.css'
import styles from './EvaluationRuns.module.css'

interface EvaluationRunInspectorProps {
  selectedRunID: string | null
  run: EvaluationRun | null
  loading: boolean
  error: string | null
  controlledPairExecution: EvaluationControlledPairExecution | null
  controlledPairLoading: boolean
  controlledPairRefreshing: boolean
  controlledPairError: string | null
  events: EvaluationRunEvent[]
  eventsConnected: boolean
  eventsError: string | null
  canRun: boolean
  canDelete: boolean
  mutationKey: string | null
  onRetry: () => void
  onRetryControlledPair: () => void
  onReconnectEvents: () => void
  onStart: (run: EvaluationRun) => void
  onCancel: (run: EvaluationRun) => void
  onDelete: (run: EvaluationRun) => void
  onOpenReport: (run: EvaluationRun) => void
}

export default function EvaluationRunInspector({
  selectedRunID,
  run,
  loading,
  error,
  controlledPairExecution,
  controlledPairLoading,
  controlledPairRefreshing,
  controlledPairError,
  events,
  eventsConnected,
  eventsError,
  canRun,
  canDelete,
  mutationKey,
  onRetry,
  onRetryControlledPair,
  onReconnectEvents,
  onStart,
  onCancel,
  onDelete,
  onOpenReport,
}: EvaluationRunInspectorProps) {
  const mutationPending = mutationKey !== null
  const controlledPair = run?.controlled_pair
  const controlledPairState =
    controlledPair && controlledPairExecution?.id === controlledPair.pair_id
      ? controlledPairExecution
      : null
  const pairCapabilities = controlledPairError ? null : controlledPairState?.capabilities
  const selectedPending = (operation: string) =>
    Boolean(run && mutationKey === `${operation}:${run.id}`)
  const selectedPairPending = (operation: string) =>
    Boolean(controlledPair && mutationKey === `${operation}-pair:${controlledPair.pair_id}`)

  return (
    <aside
      className={styles.runInspector}
      aria-labelledby="run-inspector-title"
      aria-busy={loading || controlledPairLoading || controlledPairRefreshing}
    >
      {run ? (
        <>
          <header className={styles.inspectorHeader}>
            <div>
              <span className={planeStyles.eyebrow}>Run inspector</span>
              <h3 id="run-inspector-title">{run.name}</h3>
              <code>{run.id}</code>
            </div>
            <div className={styles.inspectorState}>
              {loading ? (
                <span className={styles.inspectorRefreshing} role="status">
                  Refreshing details…
                </span>
              ) : null}
              {controlledPairRefreshing ? (
                <span className={styles.inspectorRefreshing} role="status">
                  Refreshing pair controls…
                </span>
              ) : null}
              <RunStatusBadge status={run.status} />
            </div>
          </header>
          {error ? (
            <div className={styles.inspectorNotice} role="alert">
              <span>
                The latest detail refresh failed. Showing the last durable ledger snapshot. {error}
              </span>
              <EvaluationActionButton type="button" compact variant="quiet" onClick={onRetry}>
                Retry details
              </EvaluationActionButton>
            </div>
          ) : null}
          {controlledPair && controlledPairError ? (
            <div className={styles.inspectorNotice} role="alert">
              <span>Controlled-pair controls are unavailable. {controlledPairError}</span>
              <EvaluationActionButton
                type="button"
                compact
                variant="quiet"
                onClick={onRetryControlledPair}
              >
                Retry pair controls
              </EvaluationActionButton>
            </div>
          ) : null}
          <TrackChips trackIDs={run.track_ids} />
          <dl className={styles.definitionGrid}>
            <div>
              <dt>{run.mixture ? 'Mixture entrypoint' : 'Evidence target'}</dt>
              <dd>{run.mixture?.entrypoint_model || run.target_id}</dd>
            </div>
            <div>
              <dt>Evidence</dt>
              <dd>{run.evidence_level}</dd>
            </div>
            {run.mixture ? (
              <>
                <div>
                  <dt>Routing recipe</dt>
                  <dd>{run.mixture.recipe_name}</dd>
                </div>
                <div>
                  <dt>Model pool</dt>
                  <dd>
                    {run.mixture.model_arms.length} arms · {run.mixture.decisions.length} decisions
                  </dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>Workload</dt>
              <dd>
                {run.sample_limit} cases · c{run.concurrency}
              </dd>
            </div>
            <div>
              <dt>Seed</dt>
              <dd>{run.seed}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{formatDurationBetween(run.started_at, run.completed_at)}</dd>
            </div>
            <div>
              <dt>Baseline</dt>
              <dd>
                <code>{run.baseline_run_id || 'None'}</code>
              </dd>
            </div>
            <div className={styles.definitionWide}>
              <dt>Suites</dt>
              <dd>{run.suite_ids.join(', ') || 'None'}</dd>
            </div>
          </dl>
          {run.error ? (
            <div className={planeStyles.errorBanner} role="alert">
              {run.error}
            </div>
          ) : null}
          <div className={styles.inspectorActions} aria-label={`Actions for ${run.name}`}>
            {!controlledPair && run.status === 'pending' && canRun ? (
              <EvaluationActionButton
                type="button"
                variant="primary"
                compact
                disabled={mutationPending}
                aria-label={`Start ${run.name}`}
                onClick={() => onStart(run)}
              >
                {selectedPending('start') ? 'Starting…' : 'Start'}
              </EvaluationActionButton>
            ) : null}
            {!controlledPair && run.status === 'running' && canRun ? (
              <EvaluationActionButton
                type="button"
                compact
                disabled={mutationPending}
                aria-label={`Cancel ${run.name}`}
                onClick={() => onCancel(run)}
              >
                Cancel
              </EvaluationActionButton>
            ) : null}
            {run.status === 'completed' ? (
              <EvaluationActionButton
                type="button"
                variant="primary"
                compact
                aria-label={`Open report for ${run.name}`}
                onClick={() => onOpenReport(run)}
              >
                Open report
              </EvaluationActionButton>
            ) : null}
            {controlledPair && pairCapabilities?.can_cancel && canRun ? (
              <EvaluationActionButton
                type="button"
                compact
                disabled={mutationPending || controlledPairRefreshing}
                aria-label={`Cancel controlled pair ${controlledPair.pair_id}`}
                onClick={() => onCancel(run)}
              >
                {selectedPairPending('cancel') ? 'Cancelling pair…' : 'Cancel pair'}
              </EvaluationActionButton>
            ) : null}
            {controlledPair && pairCapabilities?.can_delete && canDelete ? (
              <EvaluationActionButton
                type="button"
                variant="danger"
                compact
                disabled={mutationPending || controlledPairRefreshing}
                aria-label={`Delete controlled pair ${controlledPair.pair_id}`}
                onClick={() => onDelete(run)}
              >
                {selectedPairPending('delete') ? 'Deleting pair…' : 'Delete pair'}
              </EvaluationActionButton>
            ) : null}
            {controlledPair && controlledPairLoading ? (
              <span className={styles.pairControlStatus} role="status">
                Loading pair controls…
              </span>
            ) : null}
            {!controlledPair &&
            run.status !== 'running' &&
            run.status !== 'sealing' &&
            canDelete ? (
              <EvaluationActionButton
                type="button"
                variant="danger"
                compact
                disabled={mutationPending}
                aria-label={`Delete ${run.name}`}
                onClick={() => onDelete(run)}
              >
                Delete
              </EvaluationActionButton>
            ) : null}
          </div>
          {run.status !== 'completed' && ['failed', 'cancelled'].includes(run.status) ? (
            <p className={planeStyles.scopeNotice}>
              A completed report was not published. Inspect the failure reason and durable lifecycle
              events instead.
            </p>
          ) : null}
          <EvaluationRunTimeline
            run={run}
            events={events}
            connected={eventsConnected}
            error={eventsError}
            onReconnect={onReconnectEvents}
          />
        </>
      ) : loading ? (
        <div className={styles.inspectorEmpty}>
          <ProductLoadingState label="Loading evaluation run" compact />
        </div>
      ) : error ? (
        <div className={styles.inspectorEmpty} role="alert">
          <strong>Run could not be loaded</strong>
          <p>{error}</p>
          <EvaluationActionButton type="button" onClick={onRetry}>
            Retry run
          </EvaluationActionButton>
        </div>
      ) : (
        <div className={styles.inspectorEmpty}>
          <strong>{selectedRunID ? 'Run is not loaded' : 'Select a run'}</strong>
          <p>
            {selectedRunID
              ? 'Retry the explicit run URL or load older pages to inspect it.'
              : 'Its immutable scope, valid actions, and execution timeline appear here.'}
          </p>
          {selectedRunID ? (
            <EvaluationActionButton type="button" onClick={onRetry}>
              Retry run
            </EvaluationActionButton>
          ) : null}
        </div>
      )}
    </aside>
  )
}
