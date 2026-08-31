package evaluationplane

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"time"
)

// startControlledPairAs commits the pending-to-running cut for both members as
// one aggregate state transition. While the intent is in progress readers see
// the pending snapshots and only the initial event from the pair manifest.
type controlledPairStartResult struct {
	Pair         controlledPairManifest
	Baseline     Run
	Candidate    Run
	Transitioned bool
	LaunchOwner  bool
}

func (s *Store) startControlledPairAs(
	actor Actor,
	pairID string,
) (controlledPairStartResult, error) {
	if err := validateActor(actor); err != nil {
		return controlledPairStartResult{}, err
	}
	runEvidencePublicationMu.Lock()
	defer runEvidencePublicationMu.Unlock()
	s.runIndex.coordinator.Lock()
	defer s.runIndex.coordinator.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()

	pair, err := s.readControlledPair(pairID)
	if err != nil {
		return controlledPairStartResult{}, err
	}
	if pair.OwnerPrincipalDigest != actor.principalDigest && !actor.administrator {
		if auditErr := s.appendLifecycleDenialsUnlocked(
			actor, "start", "not_owner", pair.OwnerPrincipalDigest,
			pair.BaselineRunID, pair.CandidateRunID,
		); auditErr != nil {
			return controlledPairStartResult{}, auditErr
		}
		return controlledPairStartResult{}, fmt.Errorf(
			"%w: controlled pair belongs to another evaluation principal", ErrForbidden,
		)
	}
	if pair.State == controlledPairStateStarting {
		if recoveryErr := s.recoverControlledPairStart(pair); recoveryErr != nil {
			return controlledPairStartResult{}, recoveryErr
		}
		pair, err = s.readControlledPair(pairID)
		if err != nil {
			return controlledPairStartResult{}, err
		}
	}
	if pair.State == controlledPairStateRunning {
		baseline, baselineErr := s.getRunPhysical(pair.BaselineRunID)
		candidate, candidateErr := s.getRunPhysical(pair.CandidateRunID)
		return controlledPairStartResult{Pair: pair, Baseline: baseline, Candidate: candidate}, errors.Join(baselineErr, candidateErr)
	}
	if pair.State != controlledPairStatePending {
		return controlledPairStartResult{}, fmt.Errorf(
			"%w: controlled pair cannot start from %s", ErrConflict, pair.State,
		)
	}
	if err := s.validatePublishedControlledPair(pair); err != nil {
		return controlledPairStartResult{}, err
	}
	for _, runID := range []string{pair.BaselineRunID, pair.CandidateRunID} {
		if _, err := s.appendLifecycleAuditUnlocked(
			actor, "start", "allowed", lifecycleAuthorizationReasonForPair(actor, pair),
			runID, pair.OwnerPrincipalDigest,
		); err != nil {
			return controlledPairStartResult{}, err
		}
	}
	return s.commitControlledPairStartUnlocked(pair)
}

func (s *Store) commitControlledPairStartUnlocked(
	pair controlledPairManifest,
) (controlledPairStartResult, error) {
	startedAt := time.Now().UTC().Truncate(time.Microsecond)
	pair.State = controlledPairStateStarting
	pair.StartedAt = &startedAt
	pair.StartReceiptDigest = controlledPairStartReceipt(pair)
	if err := s.writeControlledPairDurably(pair); err != nil {
		return controlledPairStartResult{}, err
	}
	if err := s.controlledPairFail("start_intent"); err != nil {
		return controlledPairStartResult{}, err
	}

	baselineRunning := controlledPairRunningSnapshot(pair.BaselineRun, startedAt)
	candidateRunning := controlledPairRunningSnapshot(pair.CandidateRun, startedAt)
	if err := s.statusPersistence.Write(
		filepath.Join(s.runsRoot, pair.BaselineRunID, runFileName), baselineRunning,
	); err != nil {
		return controlledPairStartResult{}, err
	}
	if err := s.controlledPairFail("baseline_running"); err != nil {
		return controlledPairStartResult{}, err
	}
	if err := s.statusPersistence.Write(
		filepath.Join(s.runsRoot, pair.CandidateRunID, runFileName), candidateRunning,
	); err != nil {
		return controlledPairStartResult{}, err
	}
	if err := s.controlledPairFail("candidate_running"); err != nil {
		return controlledPairStartResult{}, err
	}
	if err := appendControlledPairStartEvent(
		filepath.Join(s.runsRoot, pair.BaselineRunID, eventsFileName), baselineRunning, startedAt,
	); err != nil {
		return controlledPairStartResult{}, err
	}
	if err := s.controlledPairFail("baseline_start_event"); err != nil {
		return controlledPairStartResult{}, err
	}
	if err := appendControlledPairStartEvent(
		filepath.Join(s.runsRoot, pair.CandidateRunID, eventsFileName), candidateRunning, startedAt,
	); err != nil {
		return controlledPairStartResult{}, err
	}
	if err := s.controlledPairFail("candidate_start_event"); err != nil {
		return controlledPairStartResult{}, err
	}

	pair.State = controlledPairStateRunning
	pair.BaselineRun, pair.CandidateRun = baselineRunning, candidateRunning
	if err := s.writeControlledPairDurably(pair); err != nil {
		durable, readErr := s.readControlledPair(pair.PairID)
		if readErr != nil || !reflect.DeepEqual(durable, pair) {
			return controlledPairStartResult{}, err
		}
		s.projectControlledPairStart(pair, baselineRunning, candidateRunning)
		return controlledPairStartResult{
			Pair: pair, Baseline: baselineRunning, Candidate: candidateRunning,
			Transitioned: true, LaunchOwner: true,
		}, err
	}
	if err := s.controlledPairFail("start_committed"); err != nil {
		return controlledPairStartResult{
			Pair: pair, Baseline: baselineRunning, Candidate: candidateRunning,
			Transitioned: true, LaunchOwner: true,
		}, err
	}
	s.projectControlledPairStart(pair, baselineRunning, candidateRunning)
	return controlledPairStartResult{
		Pair: pair, Baseline: baselineRunning, Candidate: candidateRunning,
		Transitioned: true, LaunchOwner: true,
	}, nil
}

func (s *Store) projectControlledPairStart(pair controlledPairManifest, baseline, candidate Run) {
	s.runIndex.upsertBatch(
		[]Run{baseline, candidate},
		map[string]uint64{pair.BaselineRunID: 2, pair.CandidateRunID: 2},
	)
}

func controlledPairRunningSnapshot(run Run, startedAt time.Time) Run {
	run.Status = StatusRunning
	run.StartedAt = &startedAt
	run.Error = ""
	run.Progress.Message = "Controlled pair worker starting"
	return run
}

func appendControlledPairStartEvent(path string, run Run, startedAt time.Time) error {
	sequence, err := lastEventSequence(path, run.ID)
	if err != nil {
		return err
	}
	if sequence != 1 {
		return fmt.Errorf("%w: controlled pair start event history is not initial", ErrConflict)
	}
	event := Event{
		ID: "2", RunID: run.ID, Type: "progress", Timestamp: startedAt,
		Message: run.Progress.Message, Progress: &run.Progress,
	}
	if validationErr := validateStoredEvent(event); validationErr != nil {
		return validationErr
	}
	encoded, err := json.Marshal(event)
	if err != nil {
		return err
	}
	file, err := openBundleFile(path, os.O_WRONLY|os.O_APPEND)
	if err != nil {
		return err
	}
	if _, err = file.Write(append(encoded, '\n')); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func lifecycleAuthorizationReasonForPair(actor Actor, pair controlledPairManifest) string {
	if actor.administrator && actor.principalDigest != pair.OwnerPrincipalDigest {
		return "administrator"
	}
	return "owner"
}
