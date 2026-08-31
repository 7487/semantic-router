package evaluationplane

// recoverLifecycleEvidenceAndIndex is the single startup recovery barrier.
// It shares the mutation lock order used by create, evidence publication, and
// aggregate lifecycle changes, so a second Store on the same root cannot scan
// or repair a transaction while an active Store is publishing it.
func (s *Store) recoverLifecycleEvidenceAndIndex() error {
	s.lifecycle.mu.Lock()
	defer s.lifecycle.mu.Unlock()
	runEvidencePublicationMu.Lock()
	defer runEvidencePublicationMu.Unlock()
	s.runIndex.coordinator.Lock()
	defer s.runIndex.coordinator.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.recoverControlledPairTransactionsUnlocked(); err != nil {
		return err
	}
	if err := recoverStagedRunBundles(s.runsRoot); err != nil {
		return err
	}
	if err := s.recoverExecutionAttestationsUnlocked(); err != nil {
		return err
	}
	return s.refreshRunIndexUnlocked()
}
