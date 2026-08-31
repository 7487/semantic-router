import catalogDocument from './metric_analysis_catalog.v1.json' with { type: 'json' }

export const METRIC_ANALYSIS_CATALOG_SCHEMA_VERSION = 'metric-analysis-catalog.v1'
export const METRIC_ANALYSIS_CONTRACT_VERSION = 'metric-analysis.v1'
export const METRIC_ANALYSIS_STATIC_COUNT = 132
export const METRIC_ANALYSIS_DYNAMIC_FAMILY_COUNT = 6
const METRIC_ANALYSIS_TEMPLATE_COUNT = 97
const METRIC_ANALYSIS_RETIRED_COUNT = 11

const TRACK_IDS = new Set([
  'agentic',
  'capacity',
  'joint',
  'model_pool',
  'multimodal',
  'preference',
  'routing',
  'safety',
])
const PROJECTION_SOURCES = new Set([
  'capacity_load_plan',
  'compound_budget_plan',
  'evaluation_case_plan',
  'frozen_model_pool_matrix',
  'method_ledger',
  'routing_recipe_plan',
])
const ANALYSIS_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9.-]{0,159}$/

export interface MetricAnalysisPlannedUnitFilter {
  readonly field: string
  readonly capture: string
}

export interface MetricAnalysisPlannedUnitProjection {
  readonly source: string
  readonly track_id: string
  readonly coordinates: readonly string[]
  readonly required_dimensions?: readonly string[]
  readonly filters?: readonly MetricAnalysisPlannedUnitFilter[]
}

export interface MetricAnalysisCatalogSpecification {
  readonly id: string
  readonly track_id: string
  readonly estimator_id: string
  readonly estimator_version: string
  readonly analysis_unit: string
  readonly cluster_unit: string
  readonly weighting: string
  readonly missingness: 'fail_closed'
  readonly exclusion_policy: 'exclude_unavailable_evidence'
  readonly planned_unit_projection: MetricAnalysisPlannedUnitProjection
}

export interface MetricAnalysisCatalogMatch {
  readonly metric_id: string
  readonly family_id?: string
  readonly captures: Readonly<Record<string, string>>
  readonly specification: MetricAnalysisCatalogSpecification
}

interface IdentifierEncodingVector {
  readonly raw: string
  readonly encoded: string
}

interface IdentifierEncoding {
  readonly scheme: string
  readonly raw_pattern: string
  readonly direct_pattern: string
  readonly reserved_prefix: string
  readonly encoded_pattern: string
  readonly vectors: readonly IdentifierEncodingVector[]
}

interface StaticMetric {
  readonly id: string
  readonly analysis_ref: string
}

interface DynamicCapture {
  readonly name: string
  readonly group: number
  readonly type: 'encoded_portable_id' | 'positive_int' | 'enum'
  readonly values?: readonly string[]
  readonly minimum?: number
  readonly maximum?: number
}

interface DynamicVariant {
  readonly value: string
  readonly analysis_ref: string
}

interface DynamicExample {
  readonly metric_id: string
  readonly captures: Readonly<Record<string, string>>
  readonly analysis_ref: string
}

interface DynamicFamily {
  readonly id: string
  readonly literal_prefix: string
  readonly pattern: string
  readonly captures: readonly DynamicCapture[]
  readonly selector_capture: string
  readonly variants: readonly DynamicVariant[]
  readonly examples: readonly DynamicExample[]
}

interface RetiredMetricID {
  readonly id: string
  readonly replacement: string | null
  readonly reason: string
}

interface MetricAnalysisCatalogDocument {
  readonly schema_version: string
  readonly provenance_contract_version: string
  readonly identifier_encoding: IdentifierEncoding
  readonly analysis_templates: readonly MetricAnalysisCatalogSpecification[]
  readonly static_metrics: readonly StaticMetric[]
  readonly dynamic_families: readonly DynamicFamily[]
  readonly retired_metric_ids: readonly RetiredMetricID[]
}

interface CompiledFamily extends DynamicFamily {
  readonly compiled: RegExp
}

interface CatalogIndex {
  readonly document: MetricAnalysisCatalogDocument
  readonly templates: ReadonlyMap<string, MetricAnalysisCatalogSpecification>
  readonly staticMetrics: ReadonlyMap<string, StaticMetric>
  readonly families: readonly CompiledFamily[]
}

export class MetricAnalysisCatalogResolutionError extends Error {
  readonly kind: 'unknown' | 'ambiguous' | 'invalid'

  constructor(kind: 'unknown' | 'ambiguous' | 'invalid', metricID: string) {
    super(`${kind} evaluation metric id: ${metricID}`)
    this.name = 'MetricAnalysisCatalogResolutionError'
    this.kind = kind
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`metric analysis catalog: ${message}`)
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string,
) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  assertCondition(
    actual.length === wanted.length && actual.every((key, index) => key === wanted[index]),
    `${context} fields are invalid`,
  )
}

function isSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1] < value)
}

function sameStringRecord(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key])
}

function assertTrimmedText(value: unknown, context: string): asserts value is string {
  assertCondition(
    typeof value === 'string' && value.length > 0 && value.trim() === value,
    `${context} is invalid`,
  )
}

function assertStringArray(value: unknown, context: string): asserts value is string[] {
  assertCondition(Array.isArray(value), `${context} must be an array`)
  assertCondition(
    value.every((item) => typeof item === 'string' && item.length > 0),
    `${context} is invalid`,
  )
  assertCondition(new Set(value).size === value.length, `${context} must be unique`)
}

function validateProjection(value: unknown, captures?: ReadonlySet<string>) {
  assertCondition(isRecord(value), 'planned-unit projection must be an object')
  const allowed = ['coordinates', 'filters', 'required_dimensions', 'source', 'track_id']
  const required = ['coordinates', 'source', 'track_id']
  assertCondition(
    Object.keys(value).every((key) => allowed.includes(key)),
    'planned-unit projection fields are invalid',
  )
  assertCondition(
    required.every((key) => key in value),
    'planned-unit projection fields are incomplete',
  )
  assertCondition(
    PROJECTION_SOURCES.has(String(value.source)),
    'planned-unit projection source is invalid',
  )
  assertCondition(TRACK_IDS.has(String(value.track_id)), 'planned-unit projection track is invalid')
  assertStringArray(value.coordinates, 'planned-unit projection coordinates')
  assertCondition(value.coordinates.length > 0, 'planned-unit projection coordinates are empty')
  if (value.required_dimensions !== undefined) {
    assertStringArray(value.required_dimensions, 'planned-unit projection required dimensions')
  }
  if (value.filters === undefined) return
  assertCondition(Array.isArray(value.filters), 'planned-unit projection filters must be an array')
  const fields: string[] = []
  for (const filter of value.filters) {
    assertCondition(isRecord(filter), 'planned-unit projection filter must be an object')
    assertExactKeys(filter, ['capture', 'field'], 'planned-unit projection filter')
    assertTrimmedText(filter.field, 'planned-unit projection filter field')
    assertTrimmedText(filter.capture, 'planned-unit projection filter capture')
    assertCondition(
      captures === undefined || captures.has(filter.capture),
      'planned-unit projection filter capture is unknown',
    )
    fields.push(filter.field)
  }
  assertCondition(
    new Set(fields).size === fields.length,
    'planned-unit projection filter fields must be unique',
  )
}

function validateTemplate(
  value: unknown,
  captures?: ReadonlySet<string>,
): asserts value is MetricAnalysisCatalogSpecification {
  assertCondition(isRecord(value), 'analysis template must be an object')
  assertExactKeys(
    value,
    [
      'analysis_unit',
      'cluster_unit',
      'estimator_id',
      'estimator_version',
      'exclusion_policy',
      'id',
      'missingness',
      'planned_unit_projection',
      'track_id',
      'weighting',
    ],
    'analysis template',
  )
  assertCondition(
    typeof value.id === 'string' && ANALYSIS_IDENTIFIER_PATTERN.test(value.id),
    'analysis template id is invalid',
  )
  for (const field of [
    'estimator_id',
    'estimator_version',
    'analysis_unit',
    'cluster_unit',
    'weighting',
  ] as const) {
    assertTrimmedText(value[field], `analysis template ${field}`)
  }
  assertCondition(TRACK_IDS.has(String(value.track_id)), 'analysis template track is invalid')
  assertCondition(value.missingness === 'fail_closed', 'analysis template missingness is invalid')
  assertCondition(
    value.exclusion_policy === 'exclude_unavailable_evidence',
    'analysis template exclusion policy is invalid',
  )
  validateProjection(value.planned_unit_projection, captures)
}

function captureGroupCount(pattern: string): number {
  let count = 0
  let escaped = false
  let inCharacterClass = false
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '[') inCharacterClass = true
    if (character === ']') inCharacterClass = false
    if (!inCharacterClass && character === '(' && pattern[index + 1] !== '?') count += 1
  }
  return count
}

function validateEncoding(value: unknown): asserts value is IdentifierEncoding {
  assertCondition(isRecord(value), 'identifier encoding must be an object')
  assertExactKeys(
    value,
    ['direct_pattern', 'encoded_pattern', 'raw_pattern', 'reserved_prefix', 'scheme', 'vectors'],
    'identifier encoding',
  )
  assertCondition(
    value.scheme === 'portable-segment-base64url.v1' && value.reserved_prefix === 'u-',
    'identifier encoding version is invalid',
  )
  for (const field of ['raw_pattern', 'direct_pattern', 'encoded_pattern'] as const) {
    assertTrimmedText(value[field], `identifier encoding ${field}`)
    assertCondition(
      value[field].startsWith('^') && value[field].endsWith('$'),
      `identifier encoding ${field} is not anchored`,
    )
    new RegExp(value[field])
  }
  assertCondition(
    Array.isArray(value.vectors) && value.vectors.length > 0,
    'identifier encoding vectors are missing',
  )
  for (const vector of value.vectors) {
    assertCondition(isRecord(vector), 'identifier encoding vector must be an object')
    assertExactKeys(vector, ['encoded', 'raw'], 'identifier encoding vector')
    assertTrimmedText(vector.raw, 'identifier encoding vector raw id')
    assertTrimmedText(vector.encoded, 'identifier encoding vector encoded id')
  }
}

function encodeSubjectID(rawID: string, encoding: IdentifierEncoding): string {
  if (typeof rawID !== 'string' || !new RegExp(encoding.raw_pattern).test(rawID)) {
    throw new Error('metric subject id is not a portable raw identifier')
  }
  if (
    !rawID.startsWith(encoding.reserved_prefix) &&
    new RegExp(encoding.direct_pattern).test(rawID)
  ) {
    return rawID
  }
  const payload = btoa(rawID).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const encoded = `${encoding.reserved_prefix}${payload}`
  if (!new RegExp(encoding.encoded_pattern).test(encoded)) {
    throw new Error('metric subject id exceeds the encoded segment contract')
  }
  return encoded
}

function decodeSubjectID(encodedID: string, encoding: IdentifierEncoding): string {
  if (typeof encodedID !== 'string') {
    throw new Error('metric subject segment is not canonical')
  }
  if (!encodedID.startsWith(encoding.reserved_prefix)) {
    if (!new RegExp(encoding.direct_pattern).test(encodedID)) {
      throw new Error('metric subject segment is not canonical')
    }
    return encodedID
  }
  if (!new RegExp(encoding.encoded_pattern).test(encodedID)) {
    throw new Error('metric subject segment is not canonical base64url')
  }
  const payload = encodedID
    .slice(encoding.reserved_prefix.length)
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  let raw: string
  try {
    raw = atob(payload + '='.repeat((4 - (payload.length % 4)) % 4))
  } catch {
    throw new Error('metric subject segment is not canonical base64url')
  }
  if (encodeSubjectID(raw, encoding) !== encodedID) {
    throw new Error('metric subject segment has a non-canonical encoding')
  }
  return raw
}

function captureValues(
  family: CompiledFamily,
  match: RegExpExecArray,
  encoding: IdentifierEncoding,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const capture of family.captures) {
    const raw = match[capture.group]
    if (capture.type === 'encoded_portable_id') {
      decodeSubjectID(raw, encoding)
    } else if (capture.type === 'positive_int') {
      const number = Number(raw)
      if (
        !Number.isSafeInteger(number) ||
        String(number) !== raw ||
        number < (capture.minimum ?? 1) ||
        number > (capture.maximum ?? 0)
      ) {
        throw new MetricAnalysisCatalogResolutionError('invalid', family.id)
      }
    } else if (!capture.values?.includes(raw)) {
      throw new MetricAnalysisCatalogResolutionError('invalid', family.id)
    }
    result[capture.name] = raw
  }
  return result
}

function resolveFromIndex(metricID: string, index: CatalogIndex): MetricAnalysisCatalogMatch {
  if (typeof metricID !== 'string' || !metricID || metricID.trim() !== metricID) {
    throw new MetricAnalysisCatalogResolutionError('invalid', String(metricID))
  }
  const staticMetric = index.staticMetrics.get(metricID)
  if (staticMetric) {
    return {
      metric_id: metricID,
      captures: Object.freeze({}),
      specification: index.templates.get(staticMetric.analysis_ref)!,
    }
  }
  const matches: Array<{ family: CompiledFamily; captures: Record<string, string> }> = []
  for (const family of index.families) {
    const match = family.compiled.exec(metricID)
    if (!match) continue
    try {
      matches.push({
        family,
        captures: captureValues(family, match, index.document.identifier_encoding),
      })
    } catch {
      throw new MetricAnalysisCatalogResolutionError('invalid', metricID)
    }
  }
  if (matches.length === 0) throw new MetricAnalysisCatalogResolutionError('unknown', metricID)
  if (matches.length !== 1) throw new MetricAnalysisCatalogResolutionError('ambiguous', metricID)
  const { family, captures } = matches[0]
  const selector = captures[family.selector_capture]
  const variant =
    family.variants.find((item) => item.value === selector) ??
    family.variants.find((item) => item.value === '*')
  if (!variant) throw new MetricAnalysisCatalogResolutionError('invalid', metricID)
  return {
    metric_id: metricID,
    family_id: family.id,
    captures: Object.freeze(captures),
    specification: index.templates.get(variant.analysis_ref)!,
  }
}

function validateCatalogSource(source: string): CatalogIndex {
  const value: unknown = JSON.parse(source)
  assertCondition(isRecord(value), 'root must be an object')
  assertExactKeys(
    value,
    [
      'analysis_templates',
      'dynamic_families',
      'identifier_encoding',
      'provenance_contract_version',
      'retired_metric_ids',
      'schema_version',
      'static_metrics',
    ],
    'root',
  )
  assertCondition(
    value.schema_version === METRIC_ANALYSIS_CATALOG_SCHEMA_VERSION,
    'schema version is invalid',
  )
  assertCondition(
    value.provenance_contract_version === METRIC_ANALYSIS_CONTRACT_VERSION,
    'provenance version is invalid',
  )
  validateEncoding(value.identifier_encoding)
  assertCondition(
    Array.isArray(value.analysis_templates) &&
      value.analysis_templates.length === METRIC_ANALYSIS_TEMPLATE_COUNT,
    'analysis template inventory is invalid',
  )
  const templates = new Map<string, MetricAnalysisCatalogSpecification>()
  for (const template of value.analysis_templates) {
    validateTemplate(template)
    assertCondition(!templates.has(template.id), `analysis template ${template.id} is duplicated`)
    templates.set(template.id, template)
  }
  assertCondition(
    isSortedUnique([...templates.keys()]),
    'analysis templates are not sorted and unique',
  )

  assertCondition(
    Array.isArray(value.dynamic_families) &&
      value.dynamic_families.length === METRIC_ANALYSIS_DYNAMIC_FAMILY_COUNT,
    'dynamic family inventory is invalid',
  )
  const families: CompiledFamily[] = []
  for (const rawFamily of value.dynamic_families) {
    assertCondition(isRecord(rawFamily), 'dynamic family must be an object')
    assertExactKeys(
      rawFamily,
      ['captures', 'examples', 'id', 'literal_prefix', 'pattern', 'selector_capture', 'variants'],
      'dynamic family',
    )
    assertTrimmedText(rawFamily.id, 'dynamic family id')
    assertTrimmedText(rawFamily.literal_prefix, 'dynamic family literal prefix')
    assertTrimmedText(rawFamily.pattern, 'dynamic family pattern')
    assertTrimmedText(rawFamily.selector_capture, 'dynamic family selector')
    assertCondition(
      rawFamily.pattern.startsWith('^') && rawFamily.pattern.endsWith('$'),
      `dynamic family ${rawFamily.id} pattern is not anchored`,
    )
    const compiled = new RegExp(rawFamily.pattern)
    assertCondition(
      Array.isArray(rawFamily.captures) &&
        rawFamily.captures.length === captureGroupCount(rawFamily.pattern),
      `dynamic family ${rawFamily.id} capture cardinality is invalid`,
    )
    const captureNames = new Set<string>()
    for (const [index, rawCapture] of rawFamily.captures.entries()) {
      assertCondition(
        isRecord(rawCapture),
        `dynamic family ${rawFamily.id} capture must be an object`,
      )
      assertTrimmedText(rawCapture.name, `dynamic family ${rawFamily.id} capture name`)
      assertCondition(
        rawCapture.group === index + 1,
        `dynamic family ${rawFamily.id} capture group is invalid`,
      )
      assertCondition(
        ['encoded_portable_id', 'positive_int', 'enum'].includes(String(rawCapture.type)),
        `dynamic family ${rawFamily.id} capture type is invalid`,
      )
      if (rawCapture.type === 'enum') {
        assertExactKeys(rawCapture, ['group', 'name', 'type', 'values'], 'enum capture')
        assertStringArray(rawCapture.values, 'enum capture values')
        assertCondition(isSortedUnique(rawCapture.values), 'enum capture values are not sorted')
      } else if (rawCapture.type === 'positive_int') {
        assertExactKeys(
          rawCapture,
          ['group', 'maximum', 'minimum', 'name', 'type'],
          'integer capture',
        )
        assertCondition(
          Number.isSafeInteger(rawCapture.minimum) &&
            Number.isSafeInteger(rawCapture.maximum) &&
            Number(rawCapture.minimum) >= 1 &&
            Number(rawCapture.maximum) >= Number(rawCapture.minimum),
          'integer capture bounds are invalid',
        )
      } else {
        assertExactKeys(rawCapture, ['group', 'name', 'type'], 'encoded-id capture')
      }
      assertCondition(
        !captureNames.has(rawCapture.name),
        `dynamic family ${rawFamily.id} capture is duplicated`,
      )
      captureNames.add(rawCapture.name)
    }
    const selector = rawFamily.captures.find(
      (capture) => isRecord(capture) && capture.name === rawFamily.selector_capture,
    )
    assertCondition(
      isRecord(selector),
      `dynamic family ${rawFamily.id} selector capture is unknown`,
    )
    assertCondition(
      Array.isArray(rawFamily.variants) && rawFamily.variants.length > 0,
      `dynamic family ${rawFamily.id} variants are missing`,
    )
    const variants: DynamicVariant[] = []
    for (const rawVariant of rawFamily.variants) {
      assertCondition(
        isRecord(rawVariant),
        `dynamic family ${rawFamily.id} variant must be an object`,
      )
      assertExactKeys(rawVariant, ['analysis_ref', 'value'], 'dynamic variant')
      assertTrimmedText(rawVariant.value, 'dynamic variant value')
      assertTrimmedText(rawVariant.analysis_ref, 'dynamic variant analysis ref')
      const template = templates.get(rawVariant.analysis_ref)
      assertCondition(
        template !== undefined,
        `dynamic family ${rawFamily.id} references an unknown template`,
      )
      validateTemplate(template, captureNames)
      variants.push(rawVariant as unknown as DynamicVariant)
    }
    const variantValues = variants.map((variant) => variant.value)
    assertCondition(
      isSortedUnique(variantValues),
      `dynamic family ${rawFamily.id} variants are not sorted and unique`,
    )
    const expectedVariants = selector.type === 'enum' ? selector.values : ['*']
    assertCondition(
      Array.isArray(expectedVariants) &&
        variantValues.length === expectedVariants.length &&
        variantValues.every((item, index) => item === expectedVariants[index]),
      `dynamic family ${rawFamily.id} variants do not cover the selector`,
    )
    assertCondition(
      Array.isArray(rawFamily.examples) && rawFamily.examples.length > 0,
      `dynamic family ${rawFamily.id} examples are missing`,
    )
    for (const rawExample of rawFamily.examples) {
      assertCondition(
        isRecord(rawExample),
        `dynamic family ${rawFamily.id} example must be an object`,
      )
      assertExactKeys(rawExample, ['analysis_ref', 'captures', 'metric_id'], 'dynamic example')
      assertTrimmedText(rawExample.metric_id, 'dynamic example metric id')
      assertTrimmedText(rawExample.analysis_ref, 'dynamic example analysis ref')
      assertCondition(
        templates.has(rawExample.analysis_ref),
        `dynamic family ${rawFamily.id} example references an unknown template`,
      )
      assertCondition(
        isRecord(rawExample.captures),
        `dynamic family ${rawFamily.id} example captures must be an object`,
      )
      assertCondition(
        Object.keys(rawExample.captures).length === captureNames.size &&
          Object.entries(rawExample.captures).every(
            ([name, capture]) => captureNames.has(name) && typeof capture === 'string',
          ),
        `dynamic family ${rawFamily.id} example captures are invalid`,
      )
    }
    families.push({
      ...(rawFamily as unknown as DynamicFamily),
      captures: rawFamily.captures as unknown as DynamicCapture[],
      variants,
      compiled,
    })
  }
  assertCondition(
    isSortedUnique(families.map((family) => family.id)),
    'dynamic family ids are not sorted and unique',
  )
  for (let left = 0; left < families.length; left += 1) {
    for (let right = left + 1; right < families.length; right += 1) {
      assertCondition(
        !families[left].literal_prefix.startsWith(families[right].literal_prefix) &&
          !families[right].literal_prefix.startsWith(families[left].literal_prefix),
        'dynamic family literal prefixes overlap',
      )
    }
  }

  assertCondition(
    Array.isArray(value.static_metrics) &&
      value.static_metrics.length === METRIC_ANALYSIS_STATIC_COUNT,
    'static metric inventory is invalid',
  )
  const staticMetrics = new Map<string, StaticMetric>()
  for (const rawMetric of value.static_metrics) {
    assertCondition(isRecord(rawMetric), 'static metric must be an object')
    assertExactKeys(rawMetric, ['analysis_ref', 'id'], 'static metric')
    assertTrimmedText(rawMetric.id, 'static metric id')
    assertTrimmedText(rawMetric.analysis_ref, 'static metric analysis ref')
    const metricID = rawMetric.id
    const analysisRef = rawMetric.analysis_ref
    assertCondition(
      templates.has(analysisRef),
      `static metric ${metricID} references an unknown template`,
    )
    assertCondition(!staticMetrics.has(metricID), `static metric ${metricID} is duplicated`)
    assertCondition(
      !families.some((family) => family.compiled.test(metricID)),
      `static metric ${metricID} overlaps a dynamic family`,
    )
    const template = templates.get(analysisRef)!
    validateTemplate(template, new Set())
    staticMetrics.set(metricID, rawMetric as unknown as StaticMetric)
  }
  assertCondition(
    isSortedUnique([...staticMetrics.keys()]),
    'static metric ids are not sorted and unique',
  )

  assertCondition(
    Array.isArray(value.retired_metric_ids) &&
      value.retired_metric_ids.length === METRIC_ANALYSIS_RETIRED_COUNT,
    'retired metric inventory is invalid',
  )
  const retiredIDs: string[] = []
  for (const rawRetired of value.retired_metric_ids) {
    assertCondition(isRecord(rawRetired), 'retired metric must be an object')
    assertExactKeys(rawRetired, ['id', 'reason', 'replacement'], 'retired metric')
    assertTrimmedText(rawRetired.id, 'retired metric id')
    assertTrimmedText(rawRetired.reason, 'retired metric reason')
    assertCondition(
      rawRetired.replacement === null ||
        (typeof rawRetired.replacement === 'string' && staticMetrics.has(rawRetired.replacement)),
      `retired metric ${rawRetired.id} replacement is invalid`,
    )
    assertCondition(
      !staticMetrics.has(rawRetired.id),
      `retired metric ${rawRetired.id} is still active`,
    )
    retiredIDs.push(rawRetired.id)
  }
  assertCondition(isSortedUnique(retiredIDs), 'retired metric ids are not sorted and unique')

  const document = value as unknown as MetricAnalysisCatalogDocument
  const index: CatalogIndex = { document, templates, staticMetrics, families }
  for (const family of families) {
    for (const example of family.examples) {
      assertCondition(
        example.metric_id.startsWith(family.literal_prefix),
        `dynamic family ${family.id} example has the wrong prefix`,
      )
      const resolved = resolveFromIndex(example.metric_id, index)
      assertCondition(
        resolved.family_id === family.id && resolved.specification.id === example.analysis_ref,
        `dynamic family ${family.id} golden example drifted`,
      )
      assertCondition(
        sameStringRecord(resolved.captures, example.captures),
        `dynamic family ${family.id} golden captures drifted`,
      )
    }
  }
  for (const vector of document.identifier_encoding.vectors) {
    assertCondition(
      encodeSubjectID(vector.raw, document.identifier_encoding) === vector.encoded,
      `identifier encoding vector ${vector.raw} drifted`,
    )
    assertCondition(
      decodeSubjectID(vector.encoded, document.identifier_encoding) === vector.raw,
      `identifier decoding vector ${vector.raw} drifted`,
    )
  }
  return index
}

// The imported JSON asset is the only browser/Node runtime source. The source
// tree parity test gates its bytes against the canonical Python package data
// and the Go embed; JSON import attributes work in Node, Vite, and Playwright.
export const METRIC_ANALYSIS_CATALOG_SOURCE = JSON.stringify(catalogDocument)
const CATALOG = validateCatalogSource(METRIC_ANALYSIS_CATALOG_SOURCE)

export const STATIC_METRIC_ANALYSIS_IDS = Object.freeze([...CATALOG.staticMetrics.keys()])
export const DYNAMIC_METRIC_ANALYSIS_FAMILY_IDS = Object.freeze(
  CATALOG.families.map((family) => family.id),
)
export const RETIRED_METRIC_ANALYSIS_IDS = Object.freeze(
  CATALOG.document.retired_metric_ids.map((item) => item.id),
)

export function encodeMetricAnalysisSubjectID(rawID: string): string {
  return encodeSubjectID(rawID, CATALOG.document.identifier_encoding)
}

export function decodeMetricAnalysisSubjectID(encodedID: string): string {
  return decodeSubjectID(encodedID, CATALOG.document.identifier_encoding)
}

export function resolveMetricAnalysisCatalog(metricID: string): MetricAnalysisCatalogMatch {
  return resolveFromIndex(metricID, CATALOG)
}

export function tryResolveMetricAnalysisCatalog(
  metricID: string,
): MetricAnalysisCatalogMatch | undefined {
  try {
    return resolveMetricAnalysisCatalog(metricID)
  } catch (error) {
    if (error instanceof MetricAnalysisCatalogResolutionError) return undefined
    throw error
  }
}

export function staticMetricAnalysisIDsForTrack(trackID: string): readonly string[] {
  if (!TRACK_IDS.has(trackID)) throw new Error(`unknown evaluation track: ${trackID}`)
  return STATIC_METRIC_ANALYSIS_IDS.filter((metricID) => {
    const staticMetric = CATALOG.staticMetrics.get(metricID)!
    return CATALOG.templates.get(staticMetric.analysis_ref)!.track_id === trackID
  })
}

/** Runtime validation hook used by parity and ambiguity contract tests. */
export function validateMetricAnalysisCatalogSource(source: string): void {
  validateCatalogSource(source)
}
