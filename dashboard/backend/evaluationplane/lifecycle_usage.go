package evaluationplane

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
)

type OwnerLifecycleUsage struct {
	PrincipalDigest string `json:"principal_digest"`
	RunCount        int    `json:"run_count"`
	HeldRuns        int    `json:"held_runs"`
	ProtectedRuns   int    `json:"protected_runs"`
	ActualBytes     int64  `json:"actual_bytes"`
	ReservedBytes   int64  `json:"reserved_bytes"`
	ChargeableBytes int64  `json:"chargeable_bytes"`
	MaxBytes        int64  `json:"max_bytes"`
	MaxRuns         int    `json:"max_runs"`
}

type LifecycleUsageReport struct {
	SchemaVersion        string                `json:"schema_version"`
	PolicyRevision       string                `json:"policy_revision"`
	ManagedPhysicalBytes int64                 `json:"managed_physical_bytes"`
	ReservedBytes        int64                 `json:"reserved_bytes"`
	ChargeableBytes      int64                 `json:"chargeable_bytes"`
	MaxStoreBytes        int64                 `json:"max_store_bytes"`
	AuditBytes           int64                 `json:"audit_bytes"`
	MaxAuditBytes        int64                 `json:"max_audit_bytes"`
	RunCount             int                   `json:"run_count"`
	Owners               []OwnerLifecycleUsage `json:"owners"`
}

type lifecycleUsageSnapshot struct {
	report LifecycleUsageReport
	owners map[string]OwnerLifecycleUsage
}

func (s *Store) Usage(actor Actor) (LifecycleUsageReport, error) {
	if err := validateActor(actor); err != nil {
		return LifecycleUsageReport{}, err
	}
	s.lifecycle.mu.Lock()
	defer s.lifecycle.mu.Unlock()
	runEvidencePublicationMu.Lock()
	defer runEvidencePublicationMu.Unlock()
	s.runIndex.coordinator.Lock()
	defer s.runIndex.coordinator.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	snapshot, err := s.lifecycleUsageUnlocked()
	if err != nil {
		return LifecycleUsageReport{}, err
	}
	if actor.administrator {
		return snapshot.report, nil
	}
	owner := snapshot.owners[actor.principalDigest]
	if owner.PrincipalDigest == "" {
		owner = OwnerLifecycleUsage{
			PrincipalDigest: actor.principalDigest,
			MaxBytes:        s.lifecyclePolicy.Limits.MaxOwnerBytes, MaxRuns: s.lifecyclePolicy.Limits.MaxOwnerRuns,
		}
	}
	report := snapshot.report
	report.Owners = []OwnerLifecycleUsage{owner}
	return report, nil
}

func (s *Store) lifecycleUsageUnlocked() (lifecycleUsageSnapshot, error) {
	runs, ledgerErr := s.loadCompleteRunReferenceLedgerUnlocked()
	if ledgerErr != nil {
		return lifecycleUsageSnapshot{}, fmt.Errorf("%w: lifecycle usage requires a complete run ledger: %w", ErrConflict, ledgerErr)
	}
	owners := make(map[string]OwnerLifecycleUsage)
	ownerCAS := make(map[string]map[string]bool)
	ownerReserved := make(map[string]int64)
	var totalReserved int64
	for _, run := range runs {
		lifecycle, lifecycleErr := s.readRunLifecycle(run)
		if lifecycleErr != nil {
			return lifecycleUsageSnapshot{}, fmt.Errorf("%w: lifecycle usage requires valid ownership metadata", ErrConflict)
		}
		bytes, sizeErr := privateDirectoryBytes(filepath.Join(s.runsRoot, run.ID), "")
		if sizeErr != nil {
			return lifecycleUsageSnapshot{}, sizeErr
		}
		attestationBytes, sizeErr := s.executionAttestationBytes(run.ID)
		if sizeErr != nil {
			return lifecycleUsageSnapshot{}, sizeErr
		}
		bytes, sizeErr = checkedLifecycleBytes(bytes, attestationBytes)
		if sizeErr != nil {
			return lifecycleUsageSnapshot{}, sizeErr
		}
		owner := owners[lifecycle.OwnerPrincipalDigest]
		owner.PrincipalDigest = lifecycle.OwnerPrincipalDigest
		owner.RunCount++
		owner.ActualBytes, sizeErr = checkedLifecycleBytes(owner.ActualBytes, bytes)
		if sizeErr != nil {
			return lifecycleUsageSnapshot{}, sizeErr
		}
		remainingReservation := s.lifecyclePolicy.ReservedRunBytes - bytes
		if remainingReservation < 0 {
			remainingReservation = 0
		}
		ownerReserved[lifecycle.OwnerPrincipalDigest], sizeErr = checkedLifecycleBytes(
			ownerReserved[lifecycle.OwnerPrincipalDigest], remainingReservation,
		)
		if sizeErr != nil {
			return lifecycleUsageSnapshot{}, sizeErr
		}
		totalReserved, sizeErr = checkedLifecycleBytes(totalReserved, remainingReservation)
		if sizeErr != nil {
			return lifecycleUsageSnapshot{}, sizeErr
		}
		if lifecycle.EvidenceHold {
			owner.HeldRuns++
		}
		if lifecycle.RetentionClass == RetentionProtected {
			owner.ProtectedRuns++
		}
		owners[lifecycle.OwnerPrincipalDigest] = owner
		references := make(map[string]bool)
		if err := s.markRunCASReferences(run.ID, references); err != nil {
			return lifecycleUsageSnapshot{}, fmt.Errorf("%w: lifecycle usage cannot verify run evidence: %w", ErrConflict, err)
		}
		if ownerCAS[lifecycle.OwnerPrincipalDigest] == nil {
			ownerCAS[lifecycle.OwnerPrincipalDigest] = make(map[string]bool)
		}
		for digest := range references {
			ownerCAS[lifecycle.OwnerPrincipalDigest][digest] = true
		}
	}
	pairEntries, err := os.ReadDir(s.controlledPairRoot)
	if err != nil {
		return lifecycleUsageSnapshot{}, fmt.Errorf("list controlled pair usage: %w", err)
	}
	for _, entry := range pairEntries {
		if !entry.IsDir() || !validClientRequestID(entry.Name()) {
			return lifecycleUsageSnapshot{}, fmt.Errorf("%w: controlled pair usage ledger is invalid", ErrConflict)
		}
		pair, pairErr := s.readControlledPair(entry.Name())
		if pairErr != nil {
			return lifecycleUsageSnapshot{}, pairErr
		}
		pairBytes, sizeErr := privateDirectoryBytes(filepath.Join(s.controlledPairRoot, entry.Name()), "")
		if sizeErr != nil {
			return lifecycleUsageSnapshot{}, sizeErr
		}
		owner := owners[pair.OwnerPrincipalDigest]
		owner.PrincipalDigest = pair.OwnerPrincipalDigest
		owner.ActualBytes, sizeErr = checkedLifecycleBytes(owner.ActualBytes, pairBytes)
		if sizeErr != nil {
			return lifecycleUsageSnapshot{}, sizeErr
		}
		if pair.State != controlledPairStateDeleted {
			envelopeBytes, envelopeErr := controlledPairIntentReservationBytes(pair)
			if envelopeErr != nil {
				return lifecycleUsageSnapshot{}, envelopeErr
			}
			remainingReservation := envelopeBytes - pairBytes
			if remainingReservation < 0 {
				remainingReservation = 0
			}
			ownerReserved[pair.OwnerPrincipalDigest], sizeErr = checkedLifecycleBytes(
				ownerReserved[pair.OwnerPrincipalDigest], remainingReservation,
			)
			if sizeErr != nil {
				return lifecycleUsageSnapshot{}, sizeErr
			}
			totalReserved, sizeErr = checkedLifecycleBytes(totalReserved, remainingReservation)
			if sizeErr != nil {
				return lifecycleUsageSnapshot{}, sizeErr
			}
		}
		owners[pair.OwnerPrincipalDigest] = owner
	}
	casRoot := filepath.Join(s.root, "objects", "sha256")
	for ownerDigest, references := range ownerCAS {
		owner := owners[ownerDigest]
		for digest := range references {
			info, statErr := os.Lstat(filepath.Join(casRoot, digest))
			if os.IsNotExist(statErr) {
				// Run-local artifacts (notably the immutable manifest) are
				// checksummed by the same reference scanner but intentionally
				// have no duplicate CAS object.
				continue
			}
			if statErr != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0o600 {
				return lifecycleUsageSnapshot{}, fmt.Errorf("%w: lifecycle usage cannot verify CAS evidence", ErrConflict)
			}
			var addErr error
			owner.ActualBytes, addErr = checkedLifecycleBytes(owner.ActualBytes, info.Size())
			if addErr != nil {
				return lifecycleUsageSnapshot{}, addErr
			}
		}
		owners[ownerDigest] = owner
	}
	ownerList := make([]OwnerLifecycleUsage, 0, len(owners))
	for digest, owner := range owners {
		owner.ReservedBytes = ownerReserved[digest]
		var addErr error
		owner.ChargeableBytes, addErr = checkedLifecycleBytes(owner.ActualBytes, owner.ReservedBytes)
		if addErr != nil {
			return lifecycleUsageSnapshot{}, addErr
		}
		owner.MaxBytes, owner.MaxRuns = s.lifecyclePolicy.Limits.MaxOwnerBytes, s.lifecyclePolicy.Limits.MaxOwnerRuns
		owners[digest] = owner
		ownerList = append(ownerList, owner)
	}
	sort.Slice(ownerList, func(i, j int) bool { return ownerList[i].PrincipalDigest < ownerList[j].PrincipalDigest })
	managed, err := privateDirectoryBytes(s.root, s.lifecycleAuditRoot)
	if err != nil {
		return lifecycleUsageSnapshot{}, err
	}
	chargeable, err := checkedLifecycleBytes(managed, totalReserved)
	if err != nil {
		return lifecycleUsageSnapshot{}, err
	}
	return lifecycleUsageSnapshot{
		report: LifecycleUsageReport{
			SchemaVersion: lifecyclePolicySchemaVersion, PolicyRevision: lifecyclePolicyRevision,
			ManagedPhysicalBytes: managed, ReservedBytes: totalReserved, ChargeableBytes: chargeable,
			MaxStoreBytes: s.lifecyclePolicy.Limits.MaxStoreBytes,
			AuditBytes:    s.lifecycle.bytes, MaxAuditBytes: s.lifecyclePolicy.Limits.MaxAuditBytes,
			RunCount: len(runs), Owners: ownerList,
		},
		owners: owners,
	}, nil
}

func checkedLifecycleBytes(left, right int64) (int64, error) {
	const maxInt64 = int64(^uint64(0) >> 1)
	if left < 0 || right < 0 || left > maxInt64-right {
		return 0, fmt.Errorf("%w: evaluation lifecycle byte count overflows", ErrQuota)
	}
	return left + right, nil
}

func privateDirectoryBytes(root, excludedRoot string) (int64, error) {
	root = filepath.Clean(root)
	excludedRoot = filepath.Clean(excludedRoot)
	var total int64
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if excludedRoot != "." && path == excludedRoot {
			return filepath.SkipDir
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("evaluation lifecycle usage refuses symbolic links")
		}
		if info.IsDir() {
			if info.Mode().Perm() != 0o700 {
				return fmt.Errorf("evaluation lifecycle usage requires private directories")
			}
			return nil
		}
		if !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 {
			return fmt.Errorf("evaluation lifecycle usage requires private regular files")
		}
		if info.Size() < 0 || total > int64(^uint64(0)>>1)-info.Size() {
			return fmt.Errorf("evaluation lifecycle usage byte count overflow")
		}
		total += info.Size()
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("measure evaluation lifecycle usage: %w", err)
	}
	return total, nil
}

func (s *Store) requireCreateQuotaUnlocked(actor Actor, runCount int, aggregateBytes int64) (string, error) {
	if runCount < 1 || aggregateBytes < 0 {
		return "quota_owner_runs", fmt.Errorf("%w: create quota requires a positive run count", ErrInvalid)
	}
	snapshot, err := s.lifecycleUsageUnlocked()
	if err != nil {
		return "quota_store_bytes", err
	}
	owner := snapshot.owners[actor.principalDigest]
	if runCount > s.lifecyclePolicy.Limits.MaxOwnerRuns ||
		owner.RunCount > s.lifecyclePolicy.Limits.MaxOwnerRuns-runCount {
		return "quota_owner_runs", fmt.Errorf("%w: owner run count is at capacity", ErrQuota)
	}
	ownerGrowth, ok := checkedPositiveInt64Product(s.lifecyclePolicy.ReservedRunBytes, runCount)
	if !ok {
		return "quota_owner_bytes", fmt.Errorf("%w: owner byte reservation overflows", ErrQuota)
	}
	ownerGrowth, err = checkedLifecycleBytes(ownerGrowth, aggregateBytes)
	if err != nil {
		return "quota_owner_bytes", err
	}
	if ownerGrowth > s.lifecyclePolicy.Limits.MaxOwnerBytes ||
		owner.ChargeableBytes > s.lifecyclePolicy.Limits.MaxOwnerBytes-ownerGrowth {
		return "quota_owner_bytes", fmt.Errorf("%w: owner byte capacity is full", ErrQuota)
	}
	if ownerGrowth > s.lifecyclePolicy.Limits.MaxStoreBytes ||
		snapshot.report.ChargeableBytes > s.lifecyclePolicy.Limits.MaxStoreBytes-ownerGrowth {
		return "quota_store_bytes", fmt.Errorf("%w: evaluation store byte capacity is full", ErrQuota)
	}
	return "", nil
}

func checkedPositiveInt64Product(value int64, count int) (int64, bool) {
	if value < 0 || count < 1 {
		return 0, false
	}
	const maxInt64 = int64(^uint64(0) >> 1)
	if value != 0 && int64(count) > maxInt64/value {
		return 0, false
	}
	return value * int64(count), true
}

func (s *Store) requireEvidenceQuotaUnlocked(runID string, runBytes, logicalCASBytes, physicalCASBytes int64) error {
	run, err := s.getRunUnlocked(runID)
	if err != nil {
		return err
	}
	lifecycle, err := s.readRunLifecycle(run)
	if err != nil {
		return err
	}
	snapshot, err := s.lifecycleUsageUnlocked()
	if err != nil {
		return err
	}
	owner := snapshot.owners[lifecycle.OwnerPrincipalDigest]
	currentRunBytes, err := privateDirectoryBytes(filepath.Join(s.runsRoot, runID), "")
	if err != nil {
		return err
	}
	attestationBytes, err := s.executionAttestationBytes(runID)
	if err != nil {
		return err
	}
	currentRunBytes += attestationBytes
	remainingReservation := s.lifecyclePolicy.ReservedRunBytes - currentRunBytes
	if remainingReservation < 0 {
		remainingReservation = 0
	}
	runGrowth := runBytes - remainingReservation
	if runGrowth < 0 {
		runGrowth = 0
	}
	ownerGrowth := runGrowth + logicalCASBytes
	if owner.ChargeableBytes > s.lifecyclePolicy.Limits.MaxOwnerBytes-ownerGrowth {
		return fmt.Errorf("%w: owner evidence byte capacity is full", ErrQuota)
	}
	storeGrowth := runGrowth + physicalCASBytes
	if snapshot.report.ChargeableBytes > s.lifecyclePolicy.Limits.MaxStoreBytes-storeGrowth {
		return fmt.Errorf("%w: evaluation store evidence byte capacity is full", ErrQuota)
	}
	return nil
}

func (s *Store) executionAttestationBytes(runID string) (int64, error) {
	path := filepath.Join(s.attestationRoot, runID+".json")
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0o600 ||
		info.Size() > maxExecutionAttestationBytes+1 {
		return 0, fmt.Errorf("%w: lifecycle usage cannot verify execution attestation", ErrConflict)
	}
	if _, err := s.readExecutionAttestationForDurableManifest(runID); err != nil {
		return 0, fmt.Errorf("%w: lifecycle usage cannot validate execution attestation", ErrConflict)
	}
	return info.Size(), nil
}
