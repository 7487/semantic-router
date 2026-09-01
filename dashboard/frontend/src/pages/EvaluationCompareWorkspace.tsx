import { useCreateEvaluationCampaign, useEvaluationCampaign } from '../hooks/useEvaluationCampaign'
import {
  EvaluationCampaignWorkspacePanel,
  EvaluationRunComparisonPanel,
} from './EvaluationCompareWorkspacePanels'
import type { EvaluationCompareWorkspaceProps } from './evaluationCompareWorkspaceTypes'
import styles from './EvaluationPage.module.css'
import {
  useEvaluationCompareWorkspaceRoute,
  useEvaluationCompareWorkspaceRuns,
} from './useEvaluationCompareWorkspace'

export default function EvaluationCompareWorkspace(workspace: EvaluationCompareWorkspaceProps) {
  const routeState = useEvaluationCompareWorkspaceRoute(workspace)
  const runsState = useEvaluationCompareWorkspaceRuns(
    workspace.runs,
    routeState.baselineRunID,
    routeState.candidateRunID,
    workspace.runLedgerComplete,
  )
  const campaignState = useEvaluationCampaign(workspace.route.campaignID)
  const campaignCreateState = useCreateEvaluationCampaign()

  return (
    <div className={styles.compareWorkspace}>
      <EvaluationRunComparisonPanel
        workspace={workspace}
        routeState={routeState}
        runsState={runsState}
      />
      <details
        className={styles.promotionDisclosure}
        open={routeState.releaseDecisionOpen}
        onToggle={(event) => routeState.setReleaseDecisionOpen(event.currentTarget.open)}
      >
        <summary>
          <span>
            <strong>Prepare a release decision</strong>
            <small>
              Use completed evaluations to make a verified production go/no-go decision.
            </small>
          </span>
        </summary>
        <div className={styles.promotionDisclosureBody}>
          <EvaluationCampaignWorkspacePanel
            workspace={workspace}
            routeState={routeState}
            campaignState={campaignState}
            campaignCreateState={campaignCreateState}
          />
        </div>
      </details>
    </div>
  )
}
