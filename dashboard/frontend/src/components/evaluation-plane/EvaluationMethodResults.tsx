import type { EvaluationMethodReport, EvaluationReport } from '../../types/evaluationReport'
import { EvaluationTag } from './EvaluationPrimitives'
import styles from './EvaluationMethodResults.module.css'
import layoutStyles from './EvaluationReportLayout.module.css'
import tableStyles from './EvaluationReportTable.module.css'

const READINESS_COPY = {
  'native-qualified': 'Runnable and gradeable live',
  'exploratory-import': 'Exploratory import only',
  'data-required': 'Required data is missing',
  blocked: 'Blocked by method contract',
} as const

function formatMetric(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(4)
}

function MethodResult({ result }: { result: EvaluationMethodReport }) {
  const { method } = result
  const ready = method.status === 'native-qualified'
  return (
    <article className={styles.method} aria-label={`${method.id} method result`}>
      <header className={styles.methodHeader}>
        <div>
          <strong>{method.id}</strong>
          <p>
            Analysis unit: {result.analysis_plan.analysis_unit} · cluster:{' '}
            {result.analysis_plan.cluster_unit}
            {' · '}missingness: {result.analysis_plan.missingness}
          </p>
        </div>
        <EvaluationTag tone={ready ? 'info' : 'warning'}>
          {READINESS_COPY[method.status]}
        </EvaluationTag>
      </header>
      <dl className={styles.facts}>
        <div>
          <dt>Evidence ceiling</dt>
          <dd>{method.evidence_ceiling}</dd>
        </div>
        <div>
          <dt>Native parity</dt>
          <dd>{method.native_parity}</dd>
        </div>
        <div>
          <dt>Applies to</dt>
          <dd>{method.applicable_tracks.join(' · ')}</dd>
        </div>
        <div>
          <dt>Required artifacts</dt>
          <dd>{method.required_artifact_ids.join(' · ')}</dd>
        </div>
        <div>
          <dt>Produced metrics</dt>
          <dd>{method.produced_metric_ids.join(' · ')}</dd>
        </div>
      </dl>
      <div className={styles.summary} aria-label="R2 reduced metrics">
        <span>
          <small>AUDC</small>
          <strong>{formatMetric(result.audc)}</strong>
        </span>
        <span>
          <small>nAUC</small>
          <strong>{formatMetric(result.nauc)}</strong>
        </span>
        <span>
          <small>Peak</small>
          <strong>{formatMetric(result.peak)}</strong>
        </span>
        <span>
          <small>QNC</small>
          <strong>{formatMetric(result.qnc)}</strong>
        </span>
      </div>
      <div
        className={tableStyles.tableScroll}
        role="region"
        tabIndex={0}
        aria-label={`${method.id} raw shared-domain curve`}
      >
        <table className={tableStyles.table}>
          <caption>Server-recomputed shared-domain curve for {method.id}</caption>
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Budget</th>
              <th scope="col">Mean score</th>
              <th scope="col">Cases</th>
            </tr>
          </thead>
          <tbody>
            {result.raw_shared_domain_curve.map((point) => (
              <tr key={`${point.action.id}:${point.budget}`}>
                <th scope="row">{point.action.id}</th>
                <td>{point.budget}</td>
                <td>{formatMetric(point.mean_score)}</td>
                <td>{point.case_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  )
}

export default function EvaluationMethodResults({ report }: { report: EvaluationReport }) {
  return (
    <section className={layoutStyles.section} aria-labelledby="method-results-title">
      <div className={layoutStyles.sectionHeader}>
        <div>
          <span className={layoutStyles.eyebrow}>Method results</span>
          <h3 id="method-results-title">Server-recomputed analysis</h3>
          <p>
            Only sealed, raw-coordinate reductions appear here. Readiness states describe the exact
            live-input and grader boundary.
          </p>
        </div>
        <span>{report.method_reports.length} method results</span>
      </div>
      {report.method_reports.length ? (
        report.method_reports.map((result) => (
          <MethodResult key={result.method.id} result={result} />
        ))
      ) : (
        <p className={layoutStyles.empty}>No method-level reduction was present in this run.</p>
      )}
    </section>
  )
}
