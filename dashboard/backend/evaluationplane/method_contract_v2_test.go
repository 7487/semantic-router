package evaluationplane

import (
	"math"
	"strings"
	"testing"
)

func r2Outcome(caseID, actionID string, budget int, score float64) CompoundModelBudgetOutcome {
	return CompoundModelBudgetOutcome{
		CaseID: caseID, Action: ActionRef{SchemaVersion: EvaluationMethodContractVersion, ID: actionID}, Budget: budget, Score: score,
		SliceRefs: []SliceRef{{SchemaVersion: EvaluationMethodContractVersion, ID: "all"}},
	}
}

func TestR2CompoundModelBudgetPreservesActionIdentityAndSharedCurve(t *testing.T) {
	plugin := R2CompoundModelBudgetPlugin()
	if err := ValidateEvaluationMethodPlugin(plugin); err != nil {
		t.Fatalf("plugin should be admissible: %v", err)
	}
	report, err := ReduceCompoundModelBudget(plugin, []CompoundModelBudgetOutcome{
		r2Outcome("case-a", "small", 100, .4), r2Outcome("case-a", "small", 200, .6),
		r2Outcome("case-a", "large", 100, .6), r2Outcome("case-a", "large", 200, .8),
		r2Outcome("case-b", "small", 100, .2), r2Outcome("case-b", "small", 200, .4),
		r2Outcome("case-b", "large", 100, .4), r2Outcome("case-b", "large", 200, .6),
	})
	if err != nil {
		t.Fatalf("reduce compound model+budget: %v", err)
	}
	if got := []string{report.ActionRefs[0].ID, report.ActionRefs[1].ID}; strings.Join(got, ",") != "large,small" {
		t.Fatalf("action identities changed: %v", got)
	}
	if len(report.RawSharedDomainCurve) != 4 || report.RawSharedDomainCurve[0].Action.ID != "large" || report.RawSharedDomainCurve[0].Budget != 100 {
		t.Fatalf("raw shared curve is malformed: %#v", report.RawSharedDomainCurve)
	}
	for name, values := range map[string]struct{ got, want float64 }{
		"AUDC": {report.AUDC, 100}, "nAUC": {report.NAUC, .5}, "Peak": {report.Peak, .7}, "QNC": {report.QNC, .6},
	} {
		if math.Abs(values.got-values.want) > 1e-12 {
			t.Fatalf("%s=%v, want %v", name, values.got, values.want)
		}
	}
}

func TestR2ReducersFailClosedOnDuplicateAndRaggedDomains(t *testing.T) {
	plugin := R2CompoundModelBudgetPlugin()
	duplicate := r2Outcome("case-a", "small", 100, .5)
	if _, err := ReduceCaseArmObservations([]CaseArmObservation{
		{CaseID: "case-a", Action: ActionRef{SchemaVersion: EvaluationMethodContractVersion, ID: "small"}, Value: .5},
		{CaseID: "case-a", Action: ActionRef{SchemaVersion: EvaluationMethodContractVersion, ID: "small"}, Value: .6},
	}); err == nil || !strings.Contains(err.Error(), "duplicate case×action") {
		t.Fatalf("generic reducer accepted duplicate case×action: %v", err)
	}
	if _, err := ReduceCompoundModelBudget(plugin, []CompoundModelBudgetOutcome{duplicate, duplicate}); err == nil || !strings.Contains(err.Error(), "duplicate case×action×budget") {
		t.Fatalf("compound reducer accepted duplicate case×action×budget: %v", err)
	}
	if _, err := ReduceCompoundModelBudget(plugin, []CompoundModelBudgetOutcome{
		r2Outcome("case-a", "small", 100, .4), r2Outcome("case-a", "small", 200, .5),
		r2Outcome("case-a", "large", 100, .6),
	}); err == nil || !strings.Contains(err.Error(), "exact shared") {
		t.Fatalf("compound reducer accepted ragged shared domain: %v", err)
	}
}

func TestR2CatalogPlannerExposesOnlyRunnableGradeableMethods(t *testing.T) {
	if _, err := PlanRunnableGradeableLiveMethods(
		[]EvaluationMethodPlugin{R2CompoundModelBudgetPlugin()}, []TrackID{"model_pool"},
	); err == nil || !strings.Contains(err.Error(), "no runnable") {
		t.Fatalf("planner exposed an uncovered live track: %v", err)
	}
}

func TestSealedR2ReportIsRecomputedFromRawCoordinates(t *testing.T) {
	methods := methodRecordAttestation{R2Outcomes: []CompoundModelBudgetOutcome{
		r2Outcome("case-a", "small", 100, .4), r2Outcome("case-a", "small", 200, .6),
		r2Outcome("case-b", "small", 100, .2), r2Outcome("case-b", "small", 200, .4),
	}}
	reports, err := ReduceSealedMethodReports(methods)
	if err != nil || len(reports) != 1 {
		t.Fatalf("server reduction failed: reports=%#v err=%v", reports, err)
	}
	if err := validateSealedMethodReports(reports, methods); err != nil {
		t.Fatalf("server-reduced report was rejected: %v", err)
	}
	forged := append([]CompoundModelBudgetReport(nil), reports...)
	forged[0].AUDC += 0.01
	if err := validateSealedMethodReports(forged, methods); err == nil || !strings.Contains(err.Error(), "do not match") {
		t.Fatalf("forged R2 aggregate was accepted: %v", err)
	}
}

func TestR2CoordinatesRequireTheCompleteIdentityAndRemainDistinctPerBudget(t *testing.T) {
	methodID, actionID := R2CompoundModelBudgetMethodID, "small"
	budget, quality := 100, .5
	record := executionRecordEvidence{
		MethodID: &methodID, ActionID: &actionID, BudgetTokens: &budget, Quality: &quality,
		SliceIDs: []string{"all"}, TrackID: "model_pool", Status: "succeeded",
	}
	if err := validateV2MethodCoordinates(record); err != nil {
		t.Fatalf("complete R2 coordinates rejected: %v", err)
	}
	secondBudget := 200
	second := record
	second.BudgetTokens = &secondBudget
	if record.semanticKey() == second.semanticKey() {
		t.Fatal("R2 semantic key collapsed distinct budget cells")
	}
	record.ActionID = nil
	if err := validateV2MethodCoordinates(record); err == nil || !strings.Contains(err.Error(), "require") {
		t.Fatalf("incomplete R2 coordinates accepted: %v", err)
	}
}

func TestEmptyMethodSlicesDoNotTurnOrdinaryRecordsIntoV2Coordinates(t *testing.T) {
	record := executionRecordEvidence{TrackID: "routing", Status: "succeeded", SliceIDs: []string{}}
	if err := validateV2MethodCoordinates(record); err != nil {
		t.Fatalf("ordinary record with no method slices rejected: %v", err)
	}
	record.SliceIDs = []string{"all"}
	if err := validateV2MethodCoordinates(record); err == nil || !strings.Contains(err.Error(), "require method_id") {
		t.Fatalf("unbound non-empty method slices accepted: %v", err)
	}
}

func TestInstalledMethodPluginsDeclareAllBenchmarkReadinessBoundaries(t *testing.T) {
	adapterIDs := []string{
		"routerarena", "routejudge-orbit", "coderouterbench", "llmrouterbench", "routereval", "routerbench",
		"xroutebench", "twinrouterbench", "mmr-bench", "acebench", "continuity-bench", "fusionfactory", "r2-router",
	}
	exploratory, blocked, dataRequired := 0, 0, 0
	for _, adapterID := range adapterIDs {
		plugin, ok := InstalledMethodPlugin(adapterID)
		if !ok || ValidateEvaluationMethodPlugin(plugin) != nil {
			t.Fatalf("adapter %q lacks a valid v2 plugin: %#v", adapterID, plugin)
		}
		if len(plugin.ApplicableTracks) == 0 || len(plugin.RequiredArtifactIDs) == 0 || len(plugin.ProducedMetricIDs) == 0 {
			t.Fatalf("adapter %q lacks explicit applicability, artifacts, or metrics", adapterID)
		}
		switch plugin.Status {
		case "exploratory-import":
			exploratory++
		case "blocked":
			blocked++
		case "data-required":
			dataRequired++
		}
	}
	if exploratory != 8 || blocked != 2 || dataRequired != 3 {
		t.Fatalf("v2 research inventory exploratory=%d blocked=%d data-required=%d", exploratory, blocked, dataRequired)
	}
}

func TestSupplementalInstalledAdaptersAreSeparateFromResearchInventory(t *testing.T) {
	for _, adapterID := range []string{"lcr", "swe-bench", "agentbench"} {
		plugin, ok := InstalledMethodPlugin(adapterID)
		if !ok || plugin.Status != "data-required" || plugin.NativeParity != "none" || len(plugin.LiveTracks) != 0 {
			t.Fatalf("supplemental adapter %q must remain non-live data-required: %#v", adapterID, plugin)
		}
		if _, research := researchBenchmarkByAdapter(adapterID); research {
			t.Fatalf("supplemental adapter %q leaked into the research inventory", adapterID)
		}
	}
	if _, ok := InstalledMethodPlugin("unregistered-import"); ok {
		t.Fatal("supplemental registry acted as an implicit adapter fallback")
	}
}
