import type { EvidenceLevel, GateVerdict } from '../../types/evaluationPlane'
import type { EvaluationComparison } from '../../types/evaluationReport'
import EvaluationComparisonStatistics from './EvaluationComparisonStatistics'
import EvaluationGateList from './EvaluationGateList'
import EvaluationMetricTable from './EvaluationMetricTable'
import { GateVerdictBadge } from './EvaluationPrimitives'
import disclosureStyles from './EvaluationReportDisclosures.module.css'
import reportStyles from './EvaluationReportLayout.module.css'

const COMPARISON_HEADLINES: Record<GateVerdict, string> = {
  pass: 'The candidate meets the paired comparison checks.',
  fail: 'The candidate does not meet the paired comparison checks.',
  unavailable: 'More matched results are needed before drawing a conclusion.',
  waived: 'The comparison is recorded with an approved exception.',
  not_applicable: 'This change does not require a paired comparison.',
}

function comparisonNextSteps(verdict: GateVerdict): string[] {
  switch (verdict) {
    case 'pass':
      return ['Review both run reports before using this diagnostic result in a release decision.']
    case 'fail':
      return [
        'Review the measures that missed their limits, address the regression, and repeat the matched comparison.',
      ]
    case 'unavailable':
      return [
        'Repeat the same matched workload with enough independent cases to produce conclusive confidence ranges.',
      ]
    case 'waived':
      return ['Review the recorded exception and both run reports before proceeding.']
    case 'not_applicable':
      return ['No paired-comparison follow-up is required for this change.']
  }
}

export default function EvaluationComparisonResults({
  comparison,
  verdict,
  evidenceLevel,
}: {
  comparison: EvaluationComparison
  verdict: GateVerdict
  evidenceLevel?: EvidenceLevel
}) {
  const nextSteps = comparisonNextSteps(verdict)

  return (
    <>
      <section className={reportStyles.section}>
        <div className={reportStyles.sectionHeader}>
          <div>
            <span className={reportStyles.eyebrow}>
              Diagnostic comparison · not a release decision
            </span>
            <h3>{COMPARISON_HEADLINES[verdict]}</h3>
            <p>
              Improvement colors follow each metric direction; incompatible metrics stay unmatched.
            </p>
          </div>
          <GateVerdictBadge verdict={verdict} disposition="required" />
        </div>
        <EvaluationMetricTable
          metrics={comparison.metrics}
          caption="Paired comparison metrics"
          controls={comparison.metrics.length > 6}
          evidenceLevel={evidenceLevel}
        />
      </section>
      <section className={reportStyles.section}>
        <div className={reportStyles.sectionHeader}>
          <div>
            <span className={reportStyles.eyebrow}>Paired statistical evidence</span>
            <h3>Paired scientific statistics</h3>
            <p>
              Independent cases, matched confidence intervals, and frozen quality-protection margins
              determine whether the comparison is conclusive.
            </p>
          </div>
        </div>
        <EvaluationComparisonStatistics statistics={comparison.statistics} />
      </section>
      <section className={reportStyles.section} aria-labelledby="evaluation-comparison-gates-title">
        <div className={reportStyles.sectionHeader}>
          <div>
            <span className={reportStyles.eyebrow}>Run-level evidence</span>
            <h3 id="evaluation-comparison-gates-title">Comparison checks</h3>
          </div>
        </div>
        <EvaluationGateList gates={comparison.gates} />
      </section>
      <details className={disclosureStyles.disclosure} data-evaluation-report-disclosure="true">
        <summary>
          Next comparison steps <span>{nextSteps.length}</span>
        </summary>
        <div className={disclosureStyles.disclosureBody}>
          <ol className={disclosureStyles.recommendations}>
            {nextSteps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
          {comparison.summary || comparison.recommendations.length ? (
            <details
              className={disclosureStyles.technicalNotes}
              data-evaluation-technical-details="true"
            >
              <summary>Technical details</summary>
              <p>Recorded service narrative is retained verbatim for debugging and audit.</p>
              {comparison.summary ? <p>{comparison.summary}</p> : null}
              {comparison.recommendations.length ? (
                <ol className={disclosureStyles.recommendations}>
                  {comparison.recommendations.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ol>
              ) : null}
            </details>
          ) : null}
        </div>
      </details>
    </>
  )
}
