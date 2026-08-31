import type {
  EvaluationRoutingRecipeInputAvailabilityReport,
  EvaluationRoutingRecipeMetricAvailability,
  EvaluationRoutingRecipeReport as RoutingRecipeReport,
} from '../../types/evaluationReport'
import type { EvaluationRoutingRecipePlan } from '../../types/evaluationPlane'
import { EvaluationTag } from './EvaluationPrimitives'
import layoutStyles from './EvaluationReportLayout.module.css'
import styles from './EvaluationRoutingRecipeReport.module.css'

function reasonLabel(reason?: string): string {
  return (reason || 'not_available').replace(/_/g, ' ')
}

function MetricReading({
  metric,
  format = 'decimal',
}: {
  metric: EvaluationRoutingRecipeMetricAvailability
  format?: 'decimal' | 'fraction'
}) {
  if (!metric.available) {
    return (
      <span className={styles.unavailable} title={metric.reason}>
        Unavailable · {reasonLabel(metric.reason)}
      </span>
    )
  }
  const value = metric.value || 0
  return (
    <span>
      <strong>{format === 'fraction' ? `${(value * 100).toFixed(1)}%` : value.toFixed(3)}</strong>
      <small>{metric.sample_count} cases</small>
    </span>
  )
}

function InputTable({
  caption,
  inputs,
}: {
  caption: string
  inputs: EvaluationRoutingRecipeInputAvailabilityReport[]
}) {
  if (inputs.length === 0) {
    return (
      <p className={styles.emptyLine}>No {caption.toLowerCase()} are reachable in this plan.</p>
    )
  }
  return (
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={caption}>
      <table className={styles.table}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Input</th>
            <th scope="col">Present</th>
            <th scope="col">Missing</th>
            <th scope="col">Error</th>
            <th scope="col">Timeout</th>
            <th scope="col">Latency p50 / p95</th>
          </tr>
        </thead>
        <tbody>
          {inputs.map((input) => (
            <tr key={input.id}>
              <th scope="row">
                <code>{input.id}</code>
              </th>
              <td>
                <strong>{((input.present / input.expected) * 100).toFixed(1)}%</strong>
                <small>{input.present} cases</small>
              </td>
              <td>{input.missing}</td>
              <td>{input.error}</td>
              <td>{input.timeout}</td>
              <td>
                {input.latency.available ? (
                  <span>
                    <strong>
                      {(input.latency.p50_ms || 0).toFixed(1)} /{' '}
                      {(input.latency.p95_ms || 0).toFixed(1)} ms
                    </strong>
                    <small>{input.latency.sample_count} timed</small>
                  </span>
                ) : (
                  <span className={styles.unavailable} title={input.latency.reason}>
                    Unavailable · {reasonLabel(input.latency.reason)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function EvaluationRoutingRecipeReport({
  plan,
  report,
}: {
  plan: EvaluationRoutingRecipePlan
  report: RoutingRecipeReport
}) {
  const expected = report.e1.expected_decisions
  return (
    <section className={layoutStyles.section} aria-labelledby="routing-recipe-report-title">
      <div className={layoutStyles.sectionHeader}>
        <div>
          <span className={layoutStyles.eyebrow}>Server-owned decision evidence</span>
          <h3 id="routing-recipe-report-title">Routing Recipe</h3>
          <p>
            Decision-time signals, eligibility, ranking, and later pool outcomes are reduced against
            the frozen plan. These values are not worker metrics and are not inferred by the
            browser.
          </p>
        </div>
        <EvaluationTag mono tone="info">
          {report.contract_version}
        </EvaluationTag>
      </div>

      <dl className={styles.planIdentity} aria-label="Frozen routing recipe plan">
        <div>
          <dt>Plan</dt>
          <dd>
            <code title={plan.plan_digest}>{plan.plan_digest}</code>
          </dd>
        </div>
        <div>
          <dt>Target snapshot</dt>
          <dd>
            <code title={plan.target_snapshot_digest}>{plan.target_snapshot_digest}</code>
          </dd>
        </div>
        <div>
          <dt>Inputs</dt>
          <dd>
            {plan.signals.length} signals · {plan.projections.length} projections
          </dd>
        </div>
        <div>
          <dt>Frozen pool</dt>
          <dd>
            {plan.arm_ids.length} arms · top-k {plan.top_k.join(' / ')}
          </dd>
        </div>
      </dl>

      <div className={styles.stageHeader}>
        <div>
          <span>E1 · Decision-time observability</span>
          <strong>Can the recipe make a complete, feasible choice?</strong>
        </div>
        <span>
          {report.e1.observed_decisions} / {expected} decisions
        </span>
      </div>
      <dl className={styles.rateLine}>
        <div>
          <dt>Decision coverage</dt>
          <dd>{((report.e1.observed_decisions / expected) * 100).toFixed(1)}%</dd>
        </div>
        <div>
          <dt>Eligibility complete</dt>
          <dd>
            {((report.e1.eligibility_complete / expected) * 100).toFixed(1)}%
            <small>{report.e1.eligibility_complete} cases</small>
          </dd>
        </div>
        <div>
          <dt>Selected feasible</dt>
          <dd>
            {((report.e1.selected_feasible / expected) * 100).toFixed(1)}%
            <small>{report.e1.selected_feasible} cases</small>
          </dd>
        </div>
      </dl>
      <InputTable caption="Signal availability" inputs={report.e1.signals} />
      <InputTable caption="Projection availability" inputs={report.e1.projections} />

      <div className={styles.stageHeader}>
        <div>
          <span>E2 · Outcome calibration</span>
          <strong>Does the ranking preserve the feasible pool frontier?</strong>
        </div>
        <span>Post-decision, server-observed outcomes</span>
      </div>
      {report.e2.projection_outcomes.length ? (
        <div
          className={styles.tableScroll}
          tabIndex={0}
          role="region"
          aria-label="Projection outcome calibration"
        >
          <table className={styles.table}>
            <caption>Projection outcome calibration</caption>
            <thead>
              <tr>
                <th scope="col">Projection</th>
                <th scope="col">Spearman</th>
                <th scope="col">Brier</th>
                <th scope="col">ECE-10</th>
                <th scope="col">Reliability</th>
              </tr>
            </thead>
            <tbody>
              {report.e2.projection_outcomes.map((projection) => (
                <tr key={projection.projection_id}>
                  <th scope="row">
                    <code>{projection.projection_id}</code>
                  </th>
                  <td>
                    <MetricReading metric={projection.spearman} />
                  </td>
                  <td>
                    <MetricReading metric={projection.brier} />
                  </td>
                  <td>
                    <MetricReading metric={projection.ece_10} />
                  </td>
                  <td>
                    {projection.reliability_bins.length ? (
                      <span>
                        <strong>{projection.reliability_bins.length} bins</strong>
                        <small>
                          {projection.reliability_bins.reduce((sum, bin) => sum + bin.count, 0)}{' '}
                          paired cases
                        </small>
                      </span>
                    ) : (
                      <span
                        className={styles.unavailable}
                        title={projection.ece_10.reason || projection.brier.reason}
                      >
                        Unavailable ·{' '}
                        {reasonLabel(projection.ece_10.reason || projection.brier.reason)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.emptyLine}>No projection outcome binding is present in this plan.</p>
      )}

      <div className={styles.outcomeLine}>
        <div>
          <span>Feasible oracle recall</span>
          <dl>
            {report.e2.top_k.map((topK) => (
              <div key={topK.k}>
                <dt>Top {topK.k}</dt>
                <dd>
                  <MetricReading metric={topK.feasible_oracle_recall} format="fraction" />
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <span>Oracle regret</span>
          <MetricReading metric={report.e2.oracle_regret} />
        </div>
      </div>
    </section>
  )
}
