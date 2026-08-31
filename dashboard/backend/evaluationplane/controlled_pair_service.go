package evaluationplane

import (
	"context"
	"fmt"
	"time"
)

type CreateControlledPairRequest struct {
	ClientRequestID      string `json:"client_request_id"`
	BaselineSourceRunID  string `json:"baseline_source_run_id"`
	CandidateSourceRunID string `json:"candidate_source_run_id"`
	BaselineRunID        string `json:"baseline_run_id"`
	CandidateRunID       string `json:"candidate_run_id"`
}

type ControlledPairExecution struct {
	SchemaVersion        string                     `json:"schema_version"`
	ContractVersion      string                     `json:"contract_version"`
	ID                   string                     `json:"id"`
	Protocol             string                     `json:"protocol"`
	BaselineSourceRunID  string                     `json:"baseline_source_run_id"`
	CandidateSourceRunID string                     `json:"candidate_source_run_id"`
	BaselineRun          Run                        `json:"baseline_run"`
	CandidateRun         Run                        `json:"candidate_run"`
	State                string                     `json:"state"`
	Capabilities         ControlledPairCapabilities `json:"capabilities"`
}

type ControlledPairCapabilities struct {
	CanCancel bool `json:"can_cancel"`
	CanDelete bool `json:"can_delete"`
}

type controlledPairSource struct {
	run                    Run
	manifest               RunManifest
	report                 Report
	manifestArtifactDigest string
	anchorDigest           string
	attestationDigest      string
}

// CreateControlledPairExecution clones two completed server-owned live target
// snapshots into fresh workers and starts them behind one AB/BA coordinator.
// The request contains only durable run identities; endpoint origins and
// credentials always come from the sealed source manifests.
func (s *Service) CreateControlledPairExecution(
	ctx context.Context,
	request CreateControlledPairRequest,
) (ControlledPairExecution, error) {
	return s.CreateControlledPairExecutionAs(ctx, SystemActor(), request)
}

func (s *Service) CreateControlledPairExecutionAs(
	ctx context.Context,
	actor Actor,
	request CreateControlledPairRequest,
) (ControlledPairExecution, error) {
	if err := ctx.Err(); err != nil {
		return ControlledPairExecution{}, err
	}
	if err := validateActor(actor); err != nil {
		return ControlledPairExecution{}, err
	}
	if err := validateControlledPairRequest(request); err != nil {
		return ControlledPairExecution{}, err
	}
	prelaunchContext, finishPrelaunch, prelaunchErr := s.beginControlledPairPrelaunch(ctx)
	if prelaunchErr != nil {
		return ControlledPairExecution{}, prelaunchErr
	}
	defer finishPrelaunch()
	var launchDone chan struct{}
	for {
		launchOwner, done := s.acquireControlledPairLaunch(request.ClientRequestID)
		if launchOwner {
			launchDone = done
			break
		}
		select {
		case <-ctx.Done():
			return ControlledPairExecution{}, ctx.Err()
		case <-prelaunchContext.Done():
			return ControlledPairExecution{}, prelaunchContext.Err()
		case <-done:
		}
	}
	defer s.releaseControlledPairLaunch(request.ClientRequestID, launchDone)
	if err := controlledPairPrelaunchErr(ctx, prelaunchContext); err != nil {
		return ControlledPairExecution{}, err
	}
	release, acquireErr := s.acquireEvidenceRead()
	if acquireErr != nil {
		return ControlledPairExecution{}, acquireErr
	}
	defer release()
	if err := controlledPairPrelaunchErr(ctx, prelaunchContext); err != nil {
		return ControlledPairExecution{}, err
	}
	var (
		pair                                      controlledPairManifest
		pairExists                                bool
		baseline, candidate                       controlledPairSource
		baselineCredentials, candidateCredentials workerBrokerCredentials
		baselineRun, candidateRun                 Run
		baselineManifest, candidateManifest       RunManifest
		prepareErr                                error
		operationErr                              error
	)
	s.store.lifecycle.mu.Lock()
	pair, pairExists, prepareErr = s.store.prepareControlledPairRequestUnlocked(actor, request)
	s.store.lifecycle.mu.Unlock()
	if prepareErr != nil {
		return ControlledPairExecution{}, prepareErr
	}
	if err := controlledPairPrelaunchErr(ctx, prelaunchContext); err != nil {
		return ControlledPairExecution{}, err
	}
	if pairExists {
		switch pair.State {
		case controlledPairStateRunning, controlledPairStateTerminal:
			return s.GetControlledPairExecutionAs(actor, pair.PairID)
		case controlledPairStateDeleted, controlledPairStateDeleting:
			return ControlledPairExecution{}, fmt.Errorf("%w: controlled pair request identity is retired", ErrConflict)
		case controlledPairStatePending:
		default:
			return ControlledPairExecution{}, fmt.Errorf("%w: controlled pair recovery did not reach a launchable state", ErrConflict)
		}
	}
	baseline, operationErr = s.readControlledPairSource(request.BaselineSourceRunID)
	if operationErr != nil {
		return ControlledPairExecution{}, fmt.Errorf("baseline controlled-pair source: %w", operationErr)
	}
	candidate, operationErr = s.readControlledPairSource(request.CandidateSourceRunID)
	if operationErr != nil {
		return ControlledPairExecution{}, fmt.Errorf("candidate controlled-pair source: %w", operationErr)
	}
	if err := s.validateControlledPairSources(baseline, candidate); err != nil {
		return ControlledPairExecution{}, err
	}
	if err := controlledPairPrelaunchErr(ctx, prelaunchContext); err != nil {
		return ControlledPairExecution{}, err
	}
	freezer, ok := s.process.(controlledPairCredentialFreezer)
	if !ok {
		return ControlledPairExecution{}, fmt.Errorf(
			"%w: controlled pairing is unavailable because the process backend cannot freeze two target credentials",
			ErrConflict,
		)
	}
	baselineCredentials, operationErr = freezer.freezeControlledPairCredentials(prelaunchContext, baseline.manifest)
	if operationErr != nil {
		return ControlledPairExecution{}, fmt.Errorf("%w: baseline target capability is unavailable: %w", ErrConflict, operationErr)
	}
	candidateCredentials, operationErr = freezer.freezeControlledPairCredentials(prelaunchContext, candidate.manifest)
	if operationErr != nil {
		return ControlledPairExecution{}, fmt.Errorf("%w: candidate target capability is unavailable: %w", ErrConflict, operationErr)
	}
	if err := controlledPairPrelaunchErr(ctx, prelaunchContext); err != nil {
		return ControlledPairExecution{}, err
	}
	if ledgerErr := s.RequireCompleteRunLedger(); ledgerErr != nil {
		return ControlledPairExecution{}, ledgerErr
	}
	if err := controlledPairPrelaunchErr(ctx, prelaunchContext); err != nil {
		return ControlledPairExecution{}, err
	}

	if !pairExists {
		baselineCreatedAt := time.Now().UTC().Truncate(time.Microsecond)
		candidateCreatedAt := baselineCreatedAt.Add(time.Microsecond)
		baselineRun, baselineManifest, operationErr = cloneControlledPairRun(
			baseline, request.BaselineRunID, "", controlledPairRoleBaseline, baselineCreatedAt,
		)
		if operationErr != nil {
			return ControlledPairExecution{}, operationErr
		}
		candidateRun, candidateManifest, operationErr = cloneControlledPairRun(
			candidate, request.CandidateRunID, request.BaselineRunID, controlledPairRoleCandidate, candidateCreatedAt,
		)
		if operationErr != nil {
			return ControlledPairExecution{}, operationErr
		}
		pair, operationErr = newControlledPairManifest(
			actor, request, baseline, candidate, baselineRun, candidateRun, baselineManifest, candidateManifest,
		)
		if operationErr != nil {
			return ControlledPairExecution{}, operationErr
		}
	}
	if err := controlledPairPrelaunchErr(ctx, prelaunchContext); err != nil {
		return ControlledPairExecution{}, err
	}
	releaseSlots, reserveErr := s.reserveControlledPairWorkerSlots(ctx)
	if reserveErr != nil {
		return ControlledPairExecution{}, reserveErr
	}
	slotsTransferred := false
	defer func() {
		if !slotsTransferred {
			releaseSlots()
		}
	}()
	if !pairExists {
		if err := controlledPairPrelaunchErr(ctx, prelaunchContext); err != nil {
			return ControlledPairExecution{}, err
		}
		pair, operationErr = s.persistControlledPairRunsAs(actor, pair, baselineManifest, candidateManifest)
		if operationErr != nil {
			return ControlledPairExecution{}, operationErr
		}
	}
	if err := controlledPairPrelaunchErr(ctx, prelaunchContext); err != nil {
		return ControlledPairExecution{}, err
	}
	if pair.State == controlledPairStateRunning || pair.State == controlledPairStateTerminal {
		return s.GetControlledPairExecutionAs(actor, pair.PairID)
	}
	baselineManifest, _, operationErr = s.readDurableManifest(pair.BaselineRunID)
	if operationErr != nil {
		return ControlledPairExecution{}, operationErr
	}
	candidateManifest, _, operationErr = s.readDurableManifest(pair.CandidateRunID)
	if operationErr != nil {
		return ControlledPairExecution{}, operationErr
	}
	if err := controlledPairPrelaunchErr(ctx, prelaunchContext); err != nil {
		return ControlledPairExecution{}, err
	}

	coordinator := newControlledPairCoordinator(
		request.ClientRequestID, candidateManifest.Seed, baselineManifest, candidateManifest,
	)
	baselineContext := &controlledPairRunContext{
		role: controlledPairRoleBaseline, coordinator: coordinator, credentials: baselineCredentials,
	}
	candidateContext := &controlledPairRunContext{
		role: controlledPairRoleCandidate, coordinator: coordinator, credentials: candidateCredentials,
	}
	_, _, launched, operationErr := s.startControlledPairRunsAs(
		ctx, actor, pair.PairID, baselineContext, candidateContext,
	)
	if operationErr != nil {
		if launched {
			slotsTransferred = true
		} else {
			coordinator.abort(operationErr)
		}
		return ControlledPairExecution{}, operationErr
	}
	if launched {
		slotsTransferred = true
	}
	return s.GetControlledPairExecutionAs(actor, pair.PairID)
}
