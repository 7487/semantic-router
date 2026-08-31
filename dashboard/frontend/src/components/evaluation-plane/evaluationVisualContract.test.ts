import { readFileSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function source(name: string) {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
}

function cssHex(stylesheet: string, property: string): string {
  const value = stylesheet.match(new RegExp(`${property}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
  if (!value) throw new Error(`Missing opaque color token ${property}`)
  return value
}

function relativeLuminance(hex: string): number {
  return [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0)
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (left, right) => right - left,
  )
  return (lighter + 0.05) / (darker + 0.05)
}

describe('evaluation visual-system contract', () => {
  it('anchors primary, compact, and tag geometry to the shared design tokens', () => {
    const tokens = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')
    const primitives = source('EvaluationPlane.module.css')

    expect(tokens).toContain('--control-height: 2.5rem')
    expect(tokens).toContain('--control-height-compact: 2.125rem')
    expect(tokens).toContain('--tag-height: 1.375rem')
    expect(primitives).toContain('height: var(--control-height)')
    expect(primitives).toContain('min-height: var(--control-height)')
    expect(primitives).toContain('height: var(--control-height-compact)')
    expect(primitives).toContain('min-height: var(--control-height-compact)')
    expect(primitives).toContain('height: var(--tag-height)')
    expect(primitives).toContain('min-height: var(--tag-height)')
    expect(primitives).toContain('border-radius: var(--control-radius)')
    expect(primitives).toContain('white-space: nowrap')
    expect(source('EvaluationPrimitives.tsx')).toContain('data-evaluation-action="true"')
    expect(source('EvaluationPrimitives.tsx')).toContain(
      "data-density={compact ? 'compact' : 'regular'}",
    )
  })

  it('keeps dense workflow controls flat, aligned, and on the shared geometry', () => {
    const page = readFileSync(
      new URL('../../pages/EvaluationPage.module.css', import.meta.url),
      'utf8',
    )
    const fields = source('EvaluationExperimentFields.module.css')
    const capacity = source('EvaluationCapacitySLO.module.css')
    const disclosures = source('EvaluationReportDisclosures.module.css')

    expect(page).toContain('.panelRegion select option')
    expect(page).toContain('border-radius: var(--control-radius)')
    expect(fields).toMatch(/\.choiceCard \{[\s\S]*height: var\(--control-height\)/)
    expect(source('EvaluationExperimentCapacitySLO.tsx')).toMatch(
      /<EvaluationActionButton[\s\S]*?compact[\s\S]*?title=\{preset\.description\}/,
    )
    expect(capacity).not.toContain('min-height: 56px')
    expect(capacity).not.toContain('.sloGrid label:first-child')
    expect(disclosures).toMatch(/\.artifactList a \{[\s\S]*height: var\(--control-height-compact\)/)
  })

  it('keeps responsive evidence grids on complete row boundaries', () => {
    expect(source('EvaluationCampaignPairedEvidence.module.css')).toMatch(
      /\.pairedMeta > div:nth-child\(n \+ 4\) \{[\s\S]*grid-column: span 3/,
    )
    expect(source('EvaluationCampaignFidelityEvidence.module.css')).toMatch(
      /\.identity \{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/,
    )
    expect(source('EvaluationCampaignFidelityEvidence.module.css')).toMatch(
      /\.measures > div:nth-child\(n \+ 5\) \{[\s\S]*grid-column: span 4/,
    )
    expect(source('EvaluationReportDisclosures.module.css')).toContain(
      '.provenance > div:nth-child(3n + 1)',
    )
    expect(source('EvaluationReportDiagnostics.module.css')).toContain(
      '.capacitySLOContract > div:nth-child(3)',
    )
  })

  it('uses the shared tag primitive across campaigns, reports, diagnostics, and Mixtures', () => {
    for (const component of [
      'EvaluationCampaign.tsx',
      'EvaluationCampaignBuilder.tsx',
      'EvaluationCampaignDecision.tsx',
      'EvaluationExperimentCapacitySLO.tsx',
      'EvaluationGateList.tsx',
      'EvaluationMethodReadiness.tsx',
      'EvaluationMixtureReport.tsx',
      'EvaluationReportDiagnostics.tsx',
      'EvaluationReportView.tsx',
    ]) {
      expect(source(component)).toContain('EvaluationTag')
    }
  })

  it('keeps each form surface on shared control geometry and documents non-action buttons', () => {
    const globalControls = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')
    const dialog = readFileSync(new URL('../ConfirmDialog.module.css', import.meta.url), 'utf8')

    for (const stylesheet of [
      'EvaluationCampaignBuilder.module.css',
      'EvaluationCampaignControlledPair.module.css',
      'EvaluationCompare.module.css',
      'EvaluationExperimentFields.module.css',
      'EvaluationExperimentGateScope.module.css',
      'EvaluationMethodReadiness.module.css',
      'EvaluationReports.module.css',
      'EvaluationRuns.module.css',
    ]) {
      expect(source(stylesheet)).toContain('min-height: var(--control-height)')
    }

    expect(source('EvaluationCampaignBuilder.module.css')).toContain('align-items: start')
    expect(globalControls).toContain('input:focus')
    expect(globalControls).toContain('select:focus')
    expect(globalControls).toContain('textarea:focus')
    expect(dialog).toContain('.cancelButton:disabled')
    expect(dialog).toContain('min-height: var(--control-height)')
    expect(dialog).toContain('border-radius: var(--control-radius)')

    expect(source('EvaluationCampaignDecision.tsx')).toContain(
      'className={evidenceStyles.copyDigestButton}',
    )
    expect(source('EvaluationRunLedger.tsx')).toContain('selectable ledger item')
    expect(source('EvaluationNavigation.tsx')).toContain('underlined navigation treatment')
  })

  it('routes every Evaluation page action through the shared button primitive', () => {
    const documentedRawButtons = new Map([
      ['EvaluationNavigation.tsx', 3],
      ['EvaluationPrimitives.tsx', 1],
      ['EvaluationRunLedger.tsx', 1],
    ])
    const components = readdirSync(new URL('.', import.meta.url)).filter(
      (name) => name.startsWith('Evaluation') && name.endsWith('.tsx'),
    )

    for (const component of components) {
      const rawButtons = source(component).match(/<button\b/g)?.length || 0
      expect(rawButtons, `${component} introduced an ungoverned raw button`).toBe(
        documentedRawButtons.get(component) || 0,
      )
    }
  })

  it('keeps dense Evaluation text AA and unavailable reasons at full emphasis', () => {
    const globalTokens = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')
    const page = readFileSync(
      new URL('../../pages/EvaluationPage.module.css', import.meta.url),
      'utf8',
    )
    const foregrounds = [cssHex(page, '--text-muted'), cssHex(page, '--evaluation-accent-text')]
    const backgrounds = [
      '--surface-canvas',
      '--surface-shell',
      '--surface-panel',
      '--surface-raised',
    ].map((property) => cssHex(globalTokens, property))
    for (const foreground of foregrounds) {
      for (const background of backgrounds) {
        expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5)
      }
    }

    const benchmark = source('EvaluationExperimentBenchmarkScope.module.css')
    expect(benchmark).not.toMatch(/\.disabled\s*\{[^}]*opacity:/)
    expect(benchmark).toMatch(
      /\.disabled em\s*\{[^}]*color: var\(--text-secondary\)[^}]*opacity: 1/,
    )
    expect(source('EvaluationExperimentBenchmarkScope.tsx')).toContain(
      'data-evaluation-unavailable-reason',
    )
  })

  it('keeps dense scroll and disclosure focus rings visible without separating actions', () => {
    const runs = source('EvaluationRuns.module.css')
    const timeline = source('EvaluationRunTimeline.tsx')
    const disclosures = source('EvaluationReportDisclosures.module.css')

    expect(runs).not.toContain('margin-left: auto')
    expect(runs).toMatch(/\.runSummary:focus-visible\s*\{[^}]*outline-offset: -2px/)
    expect(timeline).toContain('role="region"')
    expect(timeline).toContain('aria-labelledby={timelineTitleID}')
    expect(timeline).toContain('tabIndex={0}')
    expect(disclosures).toMatch(
      /\.disclosure > summary:focus-visible\s*\{[^}]*outline-offset: -3px/,
    )
  })
})
