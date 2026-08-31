package evaluationplane

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestResearchBenchmarkInventoryMirrorMatchesCanonicalPythonPackageData(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve research benchmark inventory test location")
	}
	canonicalPath := filepath.Join(
		filepath.Dir(currentFile),
		"../../../src/vllm-sr/cli/evaluation/golden/research_benchmark_inventory.v1.json",
	)
	canonical, err := os.ReadFile(canonicalPath)
	if err != nil {
		t.Fatalf("read canonical Python package inventory: %v", err)
	}
	if !bytes.Equal(researchBenchmarkInventoryJSON, canonical) {
		t.Fatalf("Go embedded inventory differs from canonical Python package data %q", canonicalPath)
	}
}

func TestResearchBenchmarkInventoryIsExactlyTheAuditedThirteen(t *testing.T) {
	if err := ValidateResearchBenchmarkInventory(); err != nil {
		t.Fatalf("embedded research benchmark inventory is invalid: %v", err)
	}
	benchmarks := ResearchBenchmarkInventory()
	want := map[string]struct{}{
		"routerarena": {}, "routejudge-orbit": {}, "coderouterbench": {}, "llmrouterbench": {},
		"routereval": {}, "routerbench": {}, "xroutebench": {}, "twinrouterbench": {},
		"mmr-bench": {}, "acebench": {}, "continuity-bench": {}, "fusionfactory": {}, "r2-router": {},
	}
	if len(benchmarks) != len(want) {
		t.Fatalf("research benchmark inventory count=%d, want %d", len(benchmarks), len(want))
	}
	for _, benchmark := range benchmarks {
		if _, found := want[benchmark.AdapterID]; !found {
			t.Fatalf("unexpected research benchmark %q", benchmark.AdapterID)
		}
		delete(want, benchmark.AdapterID)
		plugin, found := InstalledMethodPlugin(benchmark.AdapterID)
		if !found || plugin.Status != benchmark.Status || plugin.NativeParity != benchmark.NativeParity ||
			plugin.EvidenceCeiling != benchmark.EvidenceCeiling || plugin.Status == "native-qualified" ||
			plugin.NativeParity == "native" || plugin.EvidenceCeiling != "E0" {
			t.Fatalf("benchmark %q readiness drifted: benchmark=%+v plugin=%+v", benchmark.AdapterID, benchmark, plugin)
		}
	}
	if len(want) != 0 {
		t.Fatalf("research benchmark inventory is missing %v", want)
	}
}

func TestBlockedResearchBenchmarksCannotBecomeNormalizedImports(t *testing.T) {
	for _, adapterID := range []string{"routejudge-orbit", "routereval"} {
		benchmark, found := researchBenchmarkByAdapter(adapterID)
		if !found || benchmark.Status != "blocked" || len(benchmark.ImportTracks) != 0 {
			t.Fatalf("blocked benchmark %q inventory=%+v", adapterID, benchmark)
		}
		contract := normalizedAdapterContracts[adapterID]
		if normalizedAdapterTracksMatch(contract, []TrackID{"model_pool"}) {
			t.Fatalf("blocked benchmark %q accepted a normalized import track", adapterID)
		}
	}
}
