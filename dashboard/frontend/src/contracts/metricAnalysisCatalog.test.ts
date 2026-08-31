import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  decodeMetricAnalysisSubjectID,
  DYNAMIC_METRIC_ANALYSIS_FAMILY_IDS,
  encodeMetricAnalysisSubjectID,
  METRIC_ANALYSIS_CATALOG_SOURCE,
  resolveMetricAnalysisCatalog,
  RETIRED_METRIC_ANALYSIS_IDS,
  STATIC_METRIC_ANALYSIS_IDS,
  validateMetricAnalysisCatalogSource,
} from './metricAnalysisCatalog'

interface CatalogFixture {
  identifier_encoding: { vectors: Array<{ raw: string; encoded: string }> }
  dynamic_families: Array<{
    id: string
    literal_prefix: string
    pattern: string
    examples: Array<{
      metric_id: string
      captures: Record<string, string>
      analysis_ref: string
    }>
  }>
}

const catalog = JSON.parse(METRIC_ANALYSIS_CATALOG_SOURCE) as CatalogFixture

describe('canonical metric analysis catalog', () => {
  it('packages byte-identical Python, Go, and TypeScript resources', () => {
    const typescriptResource = readFileSync(
      new URL('./metric_analysis_catalog.v1.json', import.meta.url),
      'utf8',
    )
    const pythonResource = readFileSync(
      new URL(
        '../../../../src/vllm-sr/cli/evaluation/golden/metric_analysis_catalog.v1.json',
        import.meta.url,
      ),
      'utf8',
    )
    const goResource = readFileSync(
      new URL('../../../backend/evaluationplane/metric_analysis_catalog.v1.json', import.meta.url),
      'utf8',
    )

    expect(typescriptResource).toBe(pythonResource)
    expect(typescriptResource).toBe(goResource)
    expect(JSON.parse(METRIC_ANALYSIS_CATALOG_SOURCE)).toEqual(JSON.parse(typescriptResource))
  })

  it('resolves all 132 exact ids and all six typed dynamic families', () => {
    expect(STATIC_METRIC_ANALYSIS_IDS).toHaveLength(132)
    expect(DYNAMIC_METRIC_ANALYSIS_FAMILY_IDS).toHaveLength(6)
    expect(STATIC_METRIC_ANALYSIS_IDS).toEqual([...STATIC_METRIC_ANALYSIS_IDS].sort())
    expect(DYNAMIC_METRIC_ANALYSIS_FAMILY_IDS).toEqual(
      [...DYNAMIC_METRIC_ANALYSIS_FAMILY_IDS].sort(),
    )

    for (const metricID of STATIC_METRIC_ANALYSIS_IDS) {
      const match = resolveMetricAnalysisCatalog(metricID)
      expect(match.metric_id).toBe(metricID)
      expect(match.family_id).toBeUndefined()
    }
    for (const family of catalog.dynamic_families) {
      for (const example of family.examples) {
        const match = resolveMetricAnalysisCatalog(example.metric_id)
        expect(match.family_id).toBe(family.id)
        expect(match.captures).toEqual(example.captures)
        expect(match.specification.id).toBe(example.analysis_ref)
      }
    }
  })

  it('uses a canonical one-segment codec, including Router colon keys', () => {
    for (const vector of catalog.identifier_encoding.vectors) {
      expect(encodeMetricAnalysisSubjectID(vector.raw)).toBe(vector.encoded)
      expect(decodeMetricAnalysisSubjectID(vector.encoded)).toBe(vector.raw)
      expect(vector.encoded).not.toContain('.')
      expect(vector.encoded).not.toContain(':')
    }
    expect(encodeMetricAnalysisSubjectID('domain:reasoning')).toBe('u-ZG9tYWluOnJlYXNvbmluZw')
    expect(encodeMetricAnalysisSubjectID('classifier:risk:RISKY')).toBe(
      'u-Y2xhc3NpZmllcjpyaXNrOlJJU0tZ',
    )
  })

  it('fails closed for unknown, malformed, retired, and ambiguous metric ids', () => {
    for (const metricID of [
      'routing.made_up_accuracy',
      'model_pool.arm.u-abc.quality',
      'capacity.level.0.success_rate',
      'routing_recipe.e2.feasible_oracle_recall_at_65',
      ...RETIRED_METRIC_ANALYSIS_IDS,
    ]) {
      expect(() => resolveMetricAnalysisCatalog(metricID)).toThrow()
    }

    const ambiguous = JSON.parse(METRIC_ANALYSIS_CATALOG_SOURCE) as CatalogFixture
    ambiguous.dynamic_families[1].literal_prefix = ambiguous.dynamic_families[0].literal_prefix
    ambiguous.dynamic_families[1].pattern = ambiguous.dynamic_families[0].pattern
    expect(() => validateMetricAnalysisCatalogSource(JSON.stringify(ambiguous))).toThrow(
      /prefixes overlap/,
    )
  })

  it('returns the exact estimator contract instead of inferring from the metric name', () => {
    expect(resolveMetricAnalysisCatalog('routing.accuracy').specification).toMatchObject({
      estimator_id: 'deterministic-routing-case-observed-ratio',
      estimator_version: 'v1',
      analysis_unit: 'route_case',
      cluster_unit: 'case',
      weighting: 'uniform_case',
      missingness: 'fail_closed',
      exclusion_policy: 'exclude_unavailable_evidence',
    })
  })
})
