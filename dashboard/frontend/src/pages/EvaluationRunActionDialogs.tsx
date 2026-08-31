import ConfirmDialog from '../components/ConfirmDialog'
import type { EvaluationRun } from '../types/evaluationPlane'

interface EvaluationRunActionDialogsProps {
  cancelTarget: EvaluationRun | null
  deleteTarget: EvaluationRun | null
  mutationKey: string | null
  error: string | null
  onCloseCancel: () => void
  onCloseDelete: () => void
  onConfirmCancel: () => void | Promise<void>
  onConfirmDelete: () => void | Promise<void>
}

export default function EvaluationRunActionDialogs({
  cancelTarget,
  deleteTarget,
  mutationKey,
  error,
  onCloseCancel,
  onCloseDelete,
  onConfirmCancel,
  onConfirmDelete,
}: EvaluationRunActionDialogsProps) {
  const cancelPairID = cancelTarget?.controlled_pair?.pair_id
  const deletePairID = deleteTarget?.controlled_pair?.pair_id
  return (
    <>
      <ConfirmDialog
        isOpen={cancelTarget !== null}
        title={
          cancelPairID ? 'Cancel controlled pair?' : `Cancel ${cancelTarget?.name || 'this run'}?`
        }
        description={
          cancelPairID
            ? 'Both derived runs stop as one controlled-pair transition. Their durable lifecycle events and cancelled terminal status remain available.'
            : 'Execution stops and no completed report is published. Durable lifecycle events and terminal status remain available; worker staging is not presented as partial scientific evidence.'
        }
        eyebrow={cancelPairID ? 'Controlled pair execution' : 'Evaluation execution'}
        confirmLabel={cancelPairID ? 'Cancel pair' : 'Cancel run'}
        pendingLabel={cancelPairID ? 'Cancelling pair…' : 'Cancelling…'}
        tone="warning"
        pending={
          mutationKey ===
          (cancelPairID ? `cancel-pair:${cancelPairID}` : `cancel:${cancelTarget?.id || ''}`)
        }
        error={error}
        details={cancelTarget ? <code>{cancelPairID || cancelTarget.id}</code> : null}
        onCancel={onCloseCancel}
        onConfirm={onConfirmCancel}
      />
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={
          deletePairID ? 'Delete controlled pair?' : `Delete ${deleteTarget?.name || 'this run'}?`
        }
        description={
          deletePairID
            ? 'This permanently removes both derived run bundles and their Dashboard history. Download required artifacts from either member before continuing.'
            : 'This permanently removes the run bundle and Dashboard history. Download required artifacts before continuing.'
        }
        eyebrow={deletePairID ? 'Controlled pair evidence' : 'Evaluation evidence'}
        confirmLabel={deletePairID ? 'Delete pair' : 'Delete run'}
        pendingLabel={deletePairID ? 'Deleting pair…' : 'Deleting…'}
        pending={
          mutationKey ===
          (deletePairID ? `delete-pair:${deletePairID}` : `delete:${deleteTarget?.id || ''}`)
        }
        error={error}
        confirmationText={deletePairID || deleteTarget?.name}
        details={deleteTarget ? <code>{deletePairID || deleteTarget.id}</code> : null}
        onCancel={onCloseDelete}
        onConfirm={onConfirmDelete}
      />
    </>
  )
}
