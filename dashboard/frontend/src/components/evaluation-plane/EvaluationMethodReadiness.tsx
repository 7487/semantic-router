import { useMemo, useState } from 'react'

import type {
  EvaluationCatalog,
  EvaluationCatalogMethod,
  EvaluationMethodEvidenceSource,
  EvaluationMode,
  EvaluationTrackId,
} from '../../types/evaluationPlane'
import { EVALUATION_TRACK_IDS } from '../../types/evaluationPlane'
import { TRACK_PRESENTATION } from './evaluationTrackPresentation'
import EvaluationIssueDetails, { type EvaluationIssueDetail } from './EvaluationIssueDetails'
import { evaluationGateCapabilityLabel } from './evaluationPresentation'
import { EvaluationTag } from './EvaluationPrimitives'
import styles from './EvaluationMethodReadiness.module.css'
import planeStyles from './EvaluationPlane.module.css'
import tableStyles from './EvaluationReportTable.module.css'

const METHOD_STATUS_LABELS = {
  ready: 'Ready',
  setup_required: 'Setup required',
} as const

const EVIDENCE_SOURCE_LABELS = {
  diagnostic_fixture: 'Built-in diagnostic',
  live_runtime: 'Live system',
  normalized_import: 'Imported benchmark',
  server_brokered_live: 'Managed live run',
  live_production: 'Production experiment',
} as const

type MethodStatus = keyof typeof METHOD_STATUS_LABELS

const READY_GUIDANCE: Record<EvaluationMethodEvidenceSource, string> = {
  diagnostic_fixture: 'Ready to verify the evaluation setup and report path.',
  live_runtime: 'Ready to run against the selected Mixture.',
  normalized_import:
    'Ready for exploratory analysis. Use a managed run before making a release decision.',
  server_brokered_live: 'Ready for a managed workload-shift evaluation.',
  live_production: 'Ready for a guarded production experiment.',
}

const LIVE_SETUP_GUIDANCE: Record<EvaluationTrackId, string> = {
  routing: 'Connect complete routing-decision results for the selected Mixture, then refresh.',
  model_pool: 'Connect complete per-model results for the selected pool, then refresh.',
  joint: 'Connect complete routed-system outcomes for the selected Mixture, then refresh.',
  agentic: 'Connect complete repeated agent-task results for the selected Mixture, then refresh.',
  multimodal: 'Connect complete supported-input results for the selected Mixture, then refresh.',
  preference: 'Connect complete assigned preference outcomes, then refresh.',
  safety: 'Connect complete policy-test outcomes for the selected configuration, then refresh.',
  capacity: 'Connect repeated live-load results for the selected service objective, then refresh.',
}

function requiredMethodMode(method: EvaluationCatalogMethod): EvaluationMode {
  return ['diagnostic_fixture', 'normalized_import'].includes(method.evidence_source)
    ? 'replay'
    : 'live'
}

function methodHasExecutableTarget(
  catalog: EvaluationCatalog,
  suite: EvaluationCatalog['suites'][number],
  method: EvaluationCatalogMethod,
): boolean {
  const mode = requiredMethodMode(method)
  const executorID = suite.executors[mode]
  if (!executorID || !suite.modes.includes(mode)) return false
  return catalog.targets.some((target) => {
    const healthy = mode === 'live' ? target.healthy === true : target.healthy !== false
    const validKind = mode !== 'live' || target.kind === 'mixture-of-models'
    return (
      healthy &&
      validKind &&
      target.modes.includes(mode) &&
      target.track_ids.includes(method.track_id) &&
      target.accepted_executors[mode]?.includes(executorID) === true
    )
  })
}

function methodSetupGuidance(method: EvaluationCatalogMethod, readiness: MethodStatus): string {
  if (readiness === 'ready') return READY_GUIDANCE[method.evidence_source]
  if (method.status === 'configured') {
    return requiredMethodMode(method) === 'live'
      ? 'Connect a healthy Mixture that supports this method, then refresh.'
      : 'Connect an available replay target that supports this method, then refresh.'
  }
  if (method.evidence_source === 'live_production') {
    return 'Connect complete guarded-experiment assignments, outcomes, and safety controls, then refresh.'
  }
  if (method.evidence_source === 'normalized_import') {
    return 'Import a verified benchmark suite with complete results, then refresh.'
  }
  if (method.evidence_source === 'server_brokered_live') {
    return 'Connect the managed workload-shift source, then refresh.'
  }
  if (method.evidence_source === 'diagnostic_fixture') {
    return 'Restore the built-in diagnostic data, then refresh.'
  }
  return LIVE_SETUP_GUIDANCE[method.track_id]
}

function methodCapabilityLabel(method: EvaluationCatalogMethod): string {
  const releaseCapabilities = method.qualified_gate_ids.map(evaluationGateCapabilityLabel)
  return releaseCapabilities.length
    ? `${releaseCapabilities.join(' and ')} method`
    : `${TRACK_PRESENTATION[method.track_id].label} measurement`
}

function methodTechnicalDetails({
  method,
  suiteID,
  revision,
  executors,
}: {
  method: EvaluationCatalogMethod
  suiteID: string
  revision: string
  executors: EvaluationCatalog['suites'][number]['executors']
}): EvaluationIssueDetail[] {
  const executorIDs = Object.entries(executors).flatMap(([mode, executorID]) =>
    executorID ? [`${mode}: ${executorID}`] : [],
  )
  return [
    { label: 'Method ID', message: method.id },
    { label: 'Suite ID', message: suiteID },
    { label: 'Track ID', message: method.track_id },
    { label: 'Evidence source ID', message: method.evidence_source },
    { label: 'Suite revision', message: revision },
    { label: 'Executor IDs', message: executorIDs.join(' · ') || 'None recorded' },
    {
      label: 'Release check IDs',
      message: method.qualified_gate_ids.join(' · ') || 'None recorded',
    },
    ...(method.reason ? [{ label: 'Recorded setup response', message: method.reason }] : []),
  ]
}

interface MethodEntry {
  method: EvaluationCatalogMethod
  readiness: MethodStatus
  suiteID: string
  suiteName: string
  revision: string
  executors: EvaluationCatalog['suites'][number]['executors']
}

function useMethodReadinessModel(catalog: EvaluationCatalog) {
  const [query, setQuery] = useState('')
  const [track, setTrack] = useState<EvaluationTrackId | 'all'>('all')
  const [status, setStatus] = useState<MethodStatus | 'all'>('all')
  const methods = useMemo<MethodEntry[]>(
    () =>
      catalog.suites.flatMap((suite) =>
        suite.methods.map((method) => {
          const ready =
            method.status === 'configured' && methodHasExecutableTarget(catalog, suite, method)
          return {
            method,
            readiness: ready ? 'ready' : 'setup_required',
            suiteID: suite.id,
            suiteName: suite.name,
            revision: suite.revision,
            executors: suite.executors,
          }
        }),
      ),
    [catalog],
  )
  const visibleMethods = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return methods.filter(
      ({ method, readiness, suiteID, suiteName }) =>
        (track === 'all' || method.track_id === track) &&
        (status === 'all' || readiness === status) &&
        (!normalizedQuery ||
          [
            method.id,
            suiteID,
            suiteName,
            method.track_id,
            method.evidence_source,
            method.reason || '',
            ...method.qualified_gate_ids,
          ]
            .join(' ')
            .toLowerCase()
            .includes(normalizedQuery)),
    )
  }, [methods, query, status, track])
  const counts = useMemo(
    () =>
      methods.reduce(
        (result, { readiness }) => ({ ...result, [readiness]: result[readiness] + 1 }),
        { ready: 0, setup_required: 0 } satisfies Record<MethodStatus, number>,
      ),
    [methods],
  )
  return {
    query,
    track,
    status,
    methods,
    visibleMethods,
    counts,
    setQuery,
    setTrack,
    setStatus,
  }
}

function MethodReadinessHeader({ counts }: { counts: Record<MethodStatus, number> }) {
  return (
    <header className={planeStyles.surfaceHeader}>
      <div>
        <span className={planeStyles.eyebrow}>Evaluation methods</span>
        <h2 id="evaluation-methods-title">Available benchmark capabilities</h2>
        <p>
          See what each method measures, where its data comes from, and which release checks it can
          support. Imported results remain diagnostic until a managed run verifies the benchmark
          execution.
        </p>
      </div>
      <div className={styles.methodSummary} aria-label="Method readiness summary">
        <span>
          <strong>{counts.ready}</strong> ready
        </span>
        <span>
          <strong>{counts.setup_required}</strong> need setup
        </span>
      </div>
    </header>
  )
}

interface MethodFiltersProps {
  query: string
  track: EvaluationTrackId | 'all'
  status: MethodStatus | 'all'
  visibleCount: number
  methodCount: number
  onQueryChange: (value: string) => void
  onTrackChange: (value: EvaluationTrackId | 'all') => void
  onStatusChange: (value: MethodStatus | 'all') => void
}

function MethodFilters({
  query,
  track,
  status,
  visibleCount,
  methodCount,
  onQueryChange,
  onTrackChange,
  onStatusChange,
}: MethodFiltersProps) {
  return (
    <div className={styles.methodFilters}>
      <label className={styles.methodSearch}>
        <span>Search benchmark methods</span>
        <input
          type="search"
          aria-label="Search evaluation methods"
          value={query}
          placeholder="Benchmark, evaluation area, or release check…"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <label>
        <span>Evaluation area</span>
        <select
          aria-label="Method evaluation area filter"
          value={track}
          onChange={(event) => onTrackChange(event.target.value as EvaluationTrackId | 'all')}
        >
          <option value="all">All areas</option>
          {EVALUATION_TRACK_IDS.map((trackID) => (
            <option key={trackID} value={trackID}>
              {TRACK_PRESENTATION[trackID].label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Readiness</span>
        <select
          aria-label="Method readiness filter"
          value={status}
          onChange={(event) => onStatusChange(event.target.value as MethodStatus | 'all')}
        >
          <option value="all">All states</option>
          {Object.entries(METHOD_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <span className={styles.resultCount} role="status">
        Showing {visibleCount} of {methodCount} methods
      </span>
    </div>
  )
}

function MethodReadinessRow({ entry }: { entry: MethodEntry }) {
  const { method, readiness, suiteID, suiteName, revision, executors } = entry
  return (
    <tr>
      <th scope="row">
        <strong>{suiteName}</strong>
        <span>{methodCapabilityLabel(method)}</span>
      </th>
      <td>{TRACK_PRESENTATION[method.track_id].label}</td>
      <td>{EVIDENCE_SOURCE_LABELS[method.evidence_source]}</td>
      <td>
        {method.qualified_gate_ids.length > 0
          ? method.qualified_gate_ids.map(evaluationGateCapabilityLabel).join(' · ')
          : 'Exploratory only'}
      </td>
      <td>
        <div className={styles.methodReadiness}>
          <EvaluationTag tone={readiness === 'ready' ? 'info' : 'warning'}>
            {METHOD_STATUS_LABELS[readiness]}
          </EvaluationTag>
          <small className={styles.methodGuidance}>{methodSetupGuidance(method, readiness)}</small>
          <EvaluationIssueDetails
            className={styles.methodTechnicalDetails}
            issues={methodTechnicalDetails({ method, suiteID, revision, executors })}
          />
        </div>
      </td>
    </tr>
  )
}

function MethodReadinessTable({ methods }: { methods: MethodEntry[] }) {
  return (
    <div
      className={`${tableStyles.tableScroll} ${styles.methodTableFrame}`}
      role="region"
      tabIndex={0}
      aria-label="Scrollable evaluation method readiness"
    >
      <table className={`${tableStyles.table} ${tableStyles.tableReadiness} ${styles.methodTable}`}>
        <caption>Available evaluation methods and setup readiness</caption>
        <thead>
          <tr>
            <th scope="col">Benchmark method</th>
            <th scope="col">Evaluation area</th>
            <th scope="col">Evidence source</th>
            <th scope="col">Release checks</th>
            <th scope="col">Readiness</th>
          </tr>
        </thead>
        <tbody>
          {methods.map((entry) => (
            <MethodReadinessRow key={`${entry.suiteID}:${entry.method.id}`} entry={entry} />
          ))}
          {methods.length === 0 ? (
            <tr>
              <td className={styles.methodEmpty} colSpan={5}>
                No methods match these filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

export default function EvaluationMethodReadiness({ catalog }: { catalog: EvaluationCatalog }) {
  const model = useMethodReadinessModel(catalog)

  return (
    <section className={planeStyles.surface} aria-labelledby="evaluation-methods-title">
      <MethodReadinessHeader counts={model.counts} />
      <details className={styles.methodDisclosure}>
        <summary>
          <span>
            <strong>Browse benchmark methods</strong>
            <small>
              Search all {model.methods.length} methods when you need implementation and setup
              details.
            </small>
          </span>
        </summary>
        <div className={styles.methodCatalog}>
          <MethodFilters
            query={model.query}
            track={model.track}
            status={model.status}
            visibleCount={model.visibleMethods.length}
            methodCount={model.methods.length}
            onQueryChange={model.setQuery}
            onTrackChange={model.setTrack}
            onStatusChange={model.setStatus}
          />
          <MethodReadinessTable methods={model.visibleMethods} />
        </div>
      </details>
    </section>
  )
}
