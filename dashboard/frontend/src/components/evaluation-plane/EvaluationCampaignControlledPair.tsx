import { useEffect, useMemo, useState } from 'react'

import {
  type EvaluationControlledPairReadyGuard,
  useEvaluationControlledPair,
} from '../../hooks/useEvaluationControlledPair'
import type { EvaluationControlledPairExecution } from '../../types/evaluationControlledPair'
import type {
  EvaluationCatalog,
  EvaluationCatalogCampaignSlot,
  EvaluationCatalogChangeProfile,
  EvaluationChangeProfileId,
  EvaluationRun,
} from '../../types/evaluationPlane'
import {
  controlledPairBaselineSourceOptions,
  controlledPairCandidateSourceOptions,
} from './evaluationCampaignSupport'
import EvaluationCampaignControlledPairView from './EvaluationCampaignControlledPairView'

interface EvaluationCampaignControlledPairProps {
  runs: EvaluationRun[]
  catalog: EvaluationCatalog
  profile: EvaluationCatalogChangeProfile
  slot: EvaluationCatalogCampaignSlot
  canCreate: boolean
  disabled: boolean
  activePairID: string | null
  resumablePair: { id: string; profileID: EvaluationChangeProfileId } | null
  onProfileLockChange: (locked: boolean) => void
  onPairIdentityChange: (pairID: string | null, profileID: EvaluationChangeProfileId | null) => void
  onReady: (
    execution: EvaluationControlledPairExecution,
    isCurrent: EvaluationControlledPairReadyGuard,
  ) => void | Promise<void>
}

function selectionGuidance(
  baselineOptions: EvaluationRun[],
  candidateOptions: EvaluationRun[],
  baselineSourceID: string,
): string {
  if (!baselineOptions.length) {
    return 'No completed live Mixture run is available for controlled value comparison. Run a compatible live evaluation first.'
  }
  if (!baselineSourceID) {
    return 'Choose the completed live baseline for the fresh paired comparison.'
  }
  if (!candidateOptions.length)
    return 'No completed live candidate matches this baseline evaluation setup.'
  return 'Choose the matching candidate, then launch a fresh order-balanced comparison.'
}

export default function EvaluationCampaignControlledPair(
  props: EvaluationCampaignControlledPairProps,
) {
  const { activePairID, onPairIdentityChange, onProfileLockChange, profile } = props
  const [baselineSourceID, setBaselineSourceID] = useState('')
  const [candidateSourceID, setCandidateSourceID] = useState('')
  const pair = useEvaluationControlledPair(props.onReady, {
    activePairID,
    onPairIdentity: (pairID) => onPairIdentityChange(pairID, pairID ? profile.id : null),
  })
  const baselineOptions = useMemo(
    () => controlledPairBaselineSourceOptions(props.runs, props.catalog, props.profile, props.slot),
    [props.catalog, props.profile, props.runs, props.slot],
  )
  const candidateOptions = useMemo(
    () =>
      controlledPairCandidateSourceOptions(
        props.runs,
        props.catalog,
        props.profile,
        props.slot,
        baselineSourceID,
      ),
    [baselineSourceID, props.catalog, props.profile, props.runs, props.slot],
  )
  const busy = ['creating', 'recovering', 'running', 'assigning'].includes(pair.status)
  const profileLocked =
    Boolean(activePairID) || busy || Boolean(pair.execution && pair.status !== 'ready')
  useEffect(() => {
    onProfileLockChange(profileLocked)
  }, [onProfileLockChange, profileLocked])
  useEffect(
    () => () => {
      onProfileLockChange(false)
    },
    [onProfileLockChange],
  )
  useEffect(() => {
    if (pair.status === 'ready' && activePairID) onPairIdentityChange(null, null)
  }, [activePairID, onPairIdentityChange, pair.status])
  return (
    <EvaluationCampaignControlledPairView
      slotGateID={props.slot.gate_id}
      baselineSourceID={baselineSourceID}
      candidateSourceID={candidateSourceID}
      baselineOptions={baselineOptions}
      candidateOptions={candidateOptions}
      canCreate={props.canCreate}
      disabled={props.disabled}
      busy={busy}
      activePairID={activePairID}
      resumablePair={props.resumablePair}
      sourceReady={Boolean(baselineSourceID && candidateSourceID)}
      selectionRationale={selectionGuidance(baselineOptions, candidateOptions, baselineSourceID)}
      pair={pair}
      onBaselineSourceChange={(runID) => {
        setBaselineSourceID(runID)
        setCandidateSourceID('')
        pair.reset()
      }}
      onCandidateSourceChange={(runID) => {
        setCandidateSourceID(runID)
        pair.reset()
      }}
      onClearSavedPair={() => {
        pair.reset()
        onPairIdentityChange(null, null)
      }}
      onResumePair={() => {
        if (props.resumablePair) {
          onPairIdentityChange(props.resumablePair.id, props.resumablePair.profileID)
        }
      }}
    />
  )
}
