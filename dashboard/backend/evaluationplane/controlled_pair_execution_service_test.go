package evaluationplane

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestCreateControlledPairExecutionReservesCapacityBeforePublicationAndIsIdempotent(t *testing.T) {
	process := &controlledPairStoreTestProcess{controlledProcess: controlledProcess{started: make(chan ProcessSpec, 4)}}
	service, baselineTargetID, candidateTargetID := newControlledPairExecutionTestService(t, process, 2)
	t.Cleanup(func() { _ = service.Close() })
	baselineSource := createSealedControlledPairSource(t, service, baselineTargetID)
	candidateSource := createSealedControlledPairSource(t, service, candidateTargetID)
	request := CreateControlledPairRequest{
		ClientRequestID: newTestClientRequestID(), BaselineSourceRunID: baselineSource.ID,
		CandidateSourceRunID: candidateSource.ID, BaselineRunID: newTestClientRequestID(),
		CandidateRunID: newTestClientRequestID(),
	}

	first, err := service.CreateControlledPairExecution(context.Background(), request)
	if err != nil {
		t.Fatalf("CreateControlledPairExecution: %v", err)
	}
	second, err := service.CreateControlledPairExecution(context.Background(), request)
	if err != nil {
		t.Fatalf("idempotent CreateControlledPairExecution: %v", err)
	}
	if first.ID != second.ID || second.CandidateRun.BaselineRunID != second.BaselineRun.ID ||
		!second.BaselineRun.CreatedAt.Before(second.CandidateRun.CreatedAt) {
		t.Fatalf("idempotent controlled pair lost aggregate identity: first=%+v second=%+v", first, second)
	}
	if first.State != controlledPairStateRunning || !first.Capabilities.CanCancel || first.Capabilities.CanDelete ||
		!controlledPairRunMembershipMatches(first.BaselineRun, first.ID, controlledPairRoleBaseline) ||
		!controlledPairRunMembershipMatches(first.CandidateRun, first.ID, controlledPairRoleCandidate) {
		t.Fatalf("controlled pair public membership/capabilities are incomplete: %+v", first)
	}
	for range 2 {
		select {
		case <-process.started:
		case <-time.After(time.Second):
			t.Fatal("controlled pair worker did not start")
		}
	}
	select {
	case extra := <-process.started:
		t.Fatalf("idempotent request launched an extra worker: %+v", extra)
	case <-time.After(20 * time.Millisecond):
	}
}

func TestCreateControlledPairExecutionConcurrentIdempotencyHasOneLaunchOwner(t *testing.T) {
	for _, capacity := range []int{2, 4} {
		t.Run(fmt.Sprintf("capacity_%d", capacity), func(t *testing.T) {
			process := &controlledPairStoreTestProcess{
				controlledProcess: controlledProcess{started: make(chan ProcessSpec, 4)},
			}
			service, baselineTargetID, candidateTargetID := newControlledPairExecutionTestService(t, process, capacity)
			t.Cleanup(func() { _ = service.Close() })
			baselineSource := createSealedControlledPairSource(t, service, baselineTargetID)
			candidateSource := createSealedControlledPairSource(t, service, candidateTargetID)
			request := CreateControlledPairRequest{
				ClientRequestID: newTestClientRequestID(), BaselineSourceRunID: baselineSource.ID,
				CandidateSourceRunID: candidateSource.ID, BaselineRunID: newTestClientRequestID(),
				CandidateRunID: newTestClientRequestID(),
			}

			start := make(chan struct{})
			results := make(chan ControlledPairExecution, 2)
			errorsSeen := make(chan error, 2)
			for range 2 {
				go func() {
					<-start
					execution, err := service.CreateControlledPairExecution(context.Background(), request)
					results <- execution
					errorsSeen <- err
				}()
			}
			close(start)
			for range 2 {
				if err := <-errorsSeen; err != nil {
					t.Fatalf("concurrent controlled pair request: %v", err)
				}
			}
			first, second := <-results, <-results
			if first.ID != second.ID || first.BaselineRun.ID != second.BaselineRun.ID ||
				first.CandidateRun.ID != second.CandidateRun.ID {
				t.Fatalf("concurrent requests returned different aggregates: first=%+v second=%+v", first, second)
			}
			for range 2 {
				select {
				case <-process.started:
				case <-time.After(time.Second):
					t.Fatal("controlled pair launch owner did not start both workers")
				}
			}
			select {
			case extra := <-process.started:
				t.Fatalf("concurrent retry launched an extra worker: %+v", extra)
			case <-time.After(20 * time.Millisecond):
			}
			if calls := process.calls.Load(); calls != 2 {
				t.Fatalf("worker calls=%d, want exactly one two-member launch", calls)
			}
			service.mu.Lock()
			active := len(service.active)
			service.mu.Unlock()
			if active != 2 {
				t.Fatalf("active worker handles=%d, want exactly 2", active)
			}
		})
	}
}

func TestCreateControlledPairExecutionSameRequestResumesEveryPublicationAndStartFault(t *testing.T) {
	points := []string{
		"publication_intent", "baseline_published", "candidate_published", "publication_committed",
		"start_intent", "baseline_running", "candidate_running", "baseline_start_event",
		"candidate_start_event", "start_committed",
	}
	for _, point := range points {
		t.Run(point, func(t *testing.T) {
			process := &controlledPairStoreTestProcess{
				controlledProcess: controlledProcess{started: make(chan ProcessSpec, 4)},
			}
			service, baselineTargetID, candidateTargetID := newControlledPairExecutionTestService(t, process, 2)
			t.Cleanup(func() { _ = service.Close() })
			baselineSource := createSealedControlledPairSource(t, service, baselineTargetID)
			candidateSource := createSealedControlledPairSource(t, service, candidateTargetID)
			request := CreateControlledPairRequest{
				ClientRequestID: newTestClientRequestID(), BaselineSourceRunID: baselineSource.ID,
				CandidateSourceRunID: candidateSource.ID, BaselineRunID: newTestClientRequestID(),
				CandidateRunID: newTestClientRequestID(),
			}
			service.store.controlledPairFault = failControlledPairOnce(point)
			if _, err := service.CreateControlledPairExecution(context.Background(), request); err == nil {
				t.Fatalf("fault %s did not interrupt first request", point)
			}
			durable, err := service.store.readControlledPair(request.ClientRequestID)
			if err != nil {
				t.Fatalf("fault %s lost authoritative request identity: %v", point, err)
			}
			createdAt := durable.BaselineRun.CreatedAt
			execution, err := service.CreateControlledPairExecution(context.Background(), request)
			if err != nil {
				t.Fatalf("retry %s: %v", point, err)
			}
			if execution.BaselineRun.CreatedAt != createdAt || execution.BaselineRun.ID != durable.BaselineRunID ||
				execution.CandidateRun.ID != durable.CandidateRunID {
				t.Fatalf("retry %s regenerated pair identity: before=%+v after=%+v", point, durable, execution)
			}
			deadline := time.Now().Add(time.Second)
			for process.calls.Load() != 2 && time.Now().Before(deadline) {
				time.Sleep(time.Millisecond)
			}
			if calls := process.calls.Load(); calls != 2 {
				t.Fatalf("retry %s launched %d workers, want exactly 2", point, calls)
			}
		})
	}
}

func TestCreateControlledPairExecutionLaunchesAfterRunningManifestSyncAmbiguity(t *testing.T) {
	process := &controlledPairStoreTestProcess{
		controlledProcess: controlledProcess{started: make(chan ProcessSpec, 4)},
	}
	service, baselineTargetID, candidateTargetID := newControlledPairExecutionTestService(t, process, 2)
	t.Cleanup(func() { _ = service.Close() })
	baselineSource := createSealedControlledPairSource(t, service, baselineTargetID)
	candidateSource := createSealedControlledPairSource(t, service, candidateTargetID)
	request := CreateControlledPairRequest{
		ClientRequestID: newTestClientRequestID(), BaselineSourceRunID: baselineSource.ID,
		CandidateSourceRunID: candidateSource.ID, BaselineRunID: newTestClientRequestID(),
		CandidateRunID: newTestClientRequestID(),
	}
	service.store.pairPersistence = &recordingControlledPairPersistence{
		delegate: atomicControlledPairPersistence{}, failManifestDirectorySyncAt: 4,
	}
	if _, err := service.CreateControlledPairExecution(context.Background(), request); err == nil {
		t.Fatal("running manifest directory sync ambiguity was not propagated")
	}
	for range 2 {
		select {
		case <-process.started:
		case <-time.After(time.Second):
			t.Fatal("logical running commit did not retain launch ownership")
		}
	}
	if execution, err := service.CreateControlledPairExecution(context.Background(), request); err != nil ||
		execution.State != controlledPairStateRunning {
		t.Fatalf("same-service retry execution=%+v err=%v", execution, err)
	}
	if calls := process.calls.Load(); calls != 2 {
		t.Fatalf("same-service retry launched %d workers, want 2", calls)
	}

	secondProcess := &controlledPairStoreTestProcess{controlledProcess: controlledProcess{started: make(chan ProcessSpec, 2)}}
	second, err := NewService(Options{
		DataDir: service.store.Root(), PythonPath: "python3", ConfigPath: service.configPath,
		DeploymentsDir: service.deploymentsDir, CodeRevision: testSourceRevision,
		MaxConcurrent: 2, Process: secondProcess,
	})
	if err != nil {
		t.Fatalf("open second service after ambiguous running commit: %v", err)
	}
	t.Cleanup(func() { _ = second.Close() })
	if execution, err := second.CreateControlledPairExecution(context.Background(), request); err != nil ||
		execution.State != controlledPairStateRunning {
		t.Fatalf("second-service retry execution=%+v err=%v", execution, err)
	}
	if calls := secondProcess.calls.Load(); calls != 0 {
		t.Fatalf("second service relaunched %d workers", calls)
	}
}

func TestCreateControlledPairExecutionRetryAfterServiceRestartUsesDurableIdentity(t *testing.T) {
	for _, point := range []string{"baseline_published", "start_intent"} {
		t.Run(point, func(t *testing.T) {
			firstProcess := &controlledPairStoreTestProcess{}
			service, baselineTargetID, candidateTargetID := newControlledPairExecutionTestService(t, firstProcess, 2)
			baselineSource := createSealedControlledPairSource(t, service, baselineTargetID)
			candidateSource := createSealedControlledPairSource(t, service, candidateTargetID)
			request := CreateControlledPairRequest{
				ClientRequestID: newTestClientRequestID(), BaselineSourceRunID: baselineSource.ID,
				CandidateSourceRunID: candidateSource.ID, BaselineRunID: newTestClientRequestID(),
				CandidateRunID: newTestClientRequestID(),
			}
			root, configPath, deploymentsDir := service.store.Root(), service.configPath, service.deploymentsDir
			service.store.controlledPairFault = failControlledPairOnce(point)
			if _, err := service.CreateControlledPairExecution(context.Background(), request); err == nil {
				t.Fatalf("fault %s did not interrupt first service", point)
			}
			durable, err := service.store.readControlledPair(request.ClientRequestID)
			if err != nil {
				t.Fatalf("read durable retry identity: %v", err)
			}
			if closeErr := service.Close(); closeErr != nil {
				t.Fatalf("close first service: %v", closeErr)
			}
			secondProcess := &controlledPairStoreTestProcess{
				controlledProcess: controlledProcess{started: make(chan ProcessSpec, 2)},
			}
			restarted, err := NewService(Options{
				DataDir: root, PythonPath: "python3", ConfigPath: configPath, DeploymentsDir: deploymentsDir,
				CodeRevision: testSourceRevision, MaxConcurrent: 2, Process: secondProcess,
			})
			if err != nil {
				t.Fatalf("restart service after %s: %v", point, err)
			}
			t.Cleanup(func() { _ = restarted.Close() })
			execution, err := restarted.CreateControlledPairExecution(context.Background(), request)
			if err != nil {
				t.Fatalf("restart retry after %s: %v", point, err)
			}
			if execution.BaselineRun.CreatedAt != durable.BaselineRun.CreatedAt ||
				execution.CandidateRun.CreatedAt != durable.CandidateRun.CreatedAt {
				t.Fatalf("restart retry regenerated identity: durable=%+v execution=%+v", durable, execution)
			}
		})
	}
}

func TestCreateControlledPairExecutionCapacityFailureLeavesNoAggregate(t *testing.T) {
	process := &controlledPairStoreTestProcess{}
	service, baselineTargetID, candidateTargetID := newControlledPairExecutionTestService(t, process, 1)
	baselineSource := createSealedControlledPairSource(t, service, baselineTargetID)
	candidateSource := createSealedControlledPairSource(t, service, candidateTargetID)
	request := CreateControlledPairRequest{
		ClientRequestID: newTestClientRequestID(), BaselineSourceRunID: baselineSource.ID,
		CandidateSourceRunID: candidateSource.ID, BaselineRunID: newTestClientRequestID(),
		CandidateRunID: newTestClientRequestID(),
	}
	_, err := service.CreateControlledPairExecution(context.Background(), request)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("capacity error=%v, want ErrConflict", err)
	}
	if _, err := service.store.readControlledPair(request.ClientRequestID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("capacity rejection published pair aggregate: %v", err)
	}
	for _, runID := range []string{request.BaselineRunID, request.CandidateRunID} {
		if _, err := service.store.GetRun(runID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("capacity rejection published run %s: %v", runID, err)
		}
	}
}

func TestCreateControlledPairExecutionAuthorizesBothSourcesBeforeReadOrFreeze(t *testing.T) {
	process := &controlledPairStoreTestProcess{}
	service, baselineTargetID, candidateTargetID := newControlledPairExecutionTestService(t, process, 2)
	baselineSource := createSealedControlledPairSource(t, service, baselineTargetID)
	candidateSource := createSealedControlledPairSource(t, service, candidateTargetID)
	request := CreateControlledPairRequest{
		ClientRequestID: newTestClientRequestID(), BaselineSourceRunID: baselineSource.ID,
		CandidateSourceRunID: candidateSource.ID, BaselineRunID: newTestClientRequestID(),
		CandidateRunID: newTestClientRequestID(),
	}
	reads := 0
	service.controlledPairSourceRead = func(id string) (controlledPairSource, error) {
		reads++
		return service.loadControlledPairSource(id)
	}
	actor := testLifecycleActor(t, "unrelated-controlled-pair-owner", false)
	if _, err := service.CreateControlledPairExecutionAs(context.Background(), actor, request); !errors.Is(err, ErrForbidden) {
		t.Fatalf("cross-owner source admission error=%v, want ErrForbidden", err)
	}
	if reads != 0 || process.freezes != 0 {
		t.Fatalf("unauthorized source path touched loader/freezer: reads=%d freezes=%d", reads, process.freezes)
	}
}
