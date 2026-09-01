package evaluationplane

func defaultCapacityLoadProtocol(concurrency int) *CapacityLoadProtocol {
	levels, err := capacityConcurrencyLevels(concurrency)
	if err != nil {
		return nil
	}
	return &CapacityLoadProtocol{
		SchemaVersion:                    SchemaVersion,
		Kind:                             capacityLoadKind,
		ConcurrencyLevels:                levels,
		WarmupRequestMultiplier:          minimumCapacityWarmupMultiplier,
		MeasurementRequestsPerRepetition: minimumCapacityMeasurementRequests,
		RepetitionsPerLevel:              minimumCapacityRepetitions,
		ConfidenceLevel:                  capacityLoadConfidence,
		MaxThroughputCV:                  maximumCapacityStabilityCV,
		MaxLatencyP95CV:                  maximumCapacityStabilityCV,
	}
}

func (s *Service) persistExecutionAttestation(
	runID string,
	transcript *brokerExecutionTranscript,
) (string, error) {
	var digest string
	err := s.store.withEvidencePublication(func() error {
		var persistErr error
		digest, persistErr = s.persistExecutionAttestationDuringPublication(runID, transcript)
		return persistErr
	})
	return digest, err
}

func workerReportFromReport(report Report) workerReport {
	return workerReport{
		SchemaVersion: report.SchemaVersion,
		Run:           report.Run, Summary: report.Summary, Tracks: report.Tracks,
		Metrics: report.Metrics, Gates: report.Gates, Costs: report.Costs,
		Recommendations: report.Recommendations, Provenance: report.Provenance,
		Artifacts: report.Artifacts,
	}
}

func (s *Service) ListRunLedger() (RunLedger, error) {
	return s.store.listRunLedger(RunListQuery{Limit: defaultRunPageLimit})
}

func (s *Store) activeRunListWarnings() []runListWarning {
	_, _, warnings, _ := s.runIndex.page(nil, 0)
	return warnings
}
