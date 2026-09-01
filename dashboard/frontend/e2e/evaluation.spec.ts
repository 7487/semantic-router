import { expect, type Locator, type Page, test } from '@playwright/test'

import type { EvaluationChangeProfileId } from '../src/types/evaluationPlane'
import { decodeEvaluationRun } from '../src/utils/evaluationRunContract'
import { mockAuthenticatedAppShell } from './support/auth'
import {
  defaultEvaluationRuns,
  EVALUATION_BASELINE_MOM_TARGET_ID,
  EVALUATION_MOM,
  EVALUATION_MOM_TARGET_ID,
  EVALUATION_RUN_IDS,
  evaluationCatalog,
  evaluationRun,
  evaluationRunID,
  mockEvaluationPlane,
} from './support/evaluation'

const evalUser = {
  id: 'user-eval-1',
  email: 'eval@example.com',
  name: 'Eval User',
  role: 'read',
  permissions: [
    'config.read',
    'evaluation.read',
    'evaluation.run',
    'evaluation.write',
    'logs.read',
    'topology.read',
  ],
}

function controlledPairSourceRuns(changeProfile: EvaluationChangeProfileId = 'recipe') {
  const trackIDs = ['routing', 'model_pool', 'joint'] as const
  const suiteIDs = ['live-mom-core']
  const shared = {
    mode: 'live' as const,
    suite_ids: suiteIDs,
    track_ids: [...trackIDs],
    evidence_level: 'E3' as const,
    track_evidence_levels: { routing: 'E3', model_pool: 'E4', joint: 'E5' } as const,
    sample_limit: 64,
    mixture: EVALUATION_MOM,
  }
  return {
    baseline: evaluationRun(
      EVALUATION_RUN_IDS.baselineLive,
      'Recipe live control',
      'completed',
      '2026-08-29T01:00:00Z',
      changeProfile,
      {
        ...shared,
        target_id: EVALUATION_BASELINE_MOM_TARGET_ID,
        completed_at: '2026-08-29T01:10:00Z',
      },
    ),
    candidate: evaluationRun(
      EVALUATION_RUN_IDS.candidateLive,
      'Recipe live treatment',
      'completed',
      '2026-08-29T02:00:00Z',
      changeProfile,
      {
        ...shared,
        target_id: EVALUATION_MOM_TARGET_ID,
        completed_at: '2026-08-29T02:10:00Z',
      },
    ),
  }
}

async function openReleaseDecisionInputs(page: Page) {
  const releaseDecisionSummary = page.locator('details > summary').filter({
    has: page.getByText('Prepare a release decision', { exact: true }),
  })
  const releaseDecision = releaseDecisionSummary.locator('..')
  if (!(await releaseDecision.evaluate((element) => element.hasAttribute('open')))) {
    await releaseDecisionSummary.click()
  }
  const inputSummary = releaseDecision.locator('details > summary').filter({
    has: page.getByText('Review evaluation inputs', { exact: true }),
  })
  const inputs = inputSummary.locator('..')
  if (!(await inputs.evaluate((element) => element.hasAttribute('open')))) {
    await inputSummary.click()
  }
  return inputs
}

async function launchCampaignControlledPair(page: Page) {
  await openReleaseDecisionInputs(page)
  await page
    .getByLabel('Controlled comparison baseline run', { exact: true })
    .selectOption(EVALUATION_RUN_IDS.baselineLive)
  await page
    .getByLabel('Controlled comparison candidate run', { exact: true })
    .selectOption(EVALUATION_RUN_IDS.candidateLive)
  await page.getByRole('button', { name: 'Launch comparison' }).click()
}

async function captureEvaluationSurface(page: Page, name: string) {
  const directory = process.env.EVALUATION_VISUAL_CAPTURE_DIR
  if (!directory) return
  await page.screenshot({ path: `${directory}/${name}.png` })
}

async function captureEvaluationFullPage(page: Page, name: string) {
  const directory = process.env.EVALUATION_VISUAL_CAPTURE_DIR
  if (!directory) return
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true })
}

async function captureEvaluationElement(element: Locator, name: string) {
  const directory = process.env.EVALUATION_VISUAL_CAPTURE_DIR
  if (!directory) return
  await element.screenshot({ path: `${directory}/${name}.png` })
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1)
}

async function expectPageBottomReachable(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.scrollingElement
        if (!root) return false
        return (
          root.scrollHeight + 1 >= document.body.scrollHeight &&
          root.scrollHeight + 1 >= (document.getElementById('root')?.scrollHeight || 0)
        )
      }),
    )
    .toBe(true)
  await page.evaluate(() => {
    const root = document.scrollingElement
    if (!root) throw new Error('Document has no scrolling element.')
    root.scrollTop = root.scrollHeight
  })
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.scrollingElement
        if (!root) return false
        return Math.ceil(root.scrollTop + root.clientHeight) >= root.scrollHeight - 1
      }),
    )
    .toBe(true)
}

async function expectEvaluationBottomGutter(page: Page) {
  const panel = page.getByRole('tabpanel')
  await expect(panel).toBeVisible()
  const geometry = await panel.evaluate((element) => {
    const panelRect = element.getBoundingClientRect()
    const lastChild = element.lastElementChild
    const lastRect = lastChild?.getBoundingClientRect()
    return {
      paddingBottom: Number.parseFloat(getComputedStyle(element).paddingBottom),
      contentGap: lastRect ? panelRect.bottom - lastRect.bottom : 0,
    }
  })
  expect(geometry.paddingBottom).toBeGreaterThanOrEqual(47)
  expect(geometry.contentGap).toBeGreaterThanOrEqual(geometry.paddingBottom - 1)
}

const INTERNAL_EVALUATION_UI_PATTERN =
  /\b(?:E[0-5]|G[0-9])\b|E0\s*[–-]\s*E5|(?:schema|contract)_version|evaluation-release-gates|Schema evaluation|Contract range|Evidence needed|\b(?:evaluation-smoke|live-mom-core|normalized-promotion-cohort)\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i

async function expectProductEvaluationLanguage(page: Page) {
  const visibleMainText = await page.locator('main').innerText()
  expect(visibleMainText).not.toMatch(INTERNAL_EVALUATION_UI_PATTERN)
}

async function expectOverviewActionParity(page: Page) {
  const readiness = page.locator('section[aria-labelledby="evaluation-readiness-title"]')
  const geometry = await Promise.all(
    ['New experiment', 'Inspect runs'].map(async (name) => {
      const box = await readiness.getByRole('button', { name, exact: true }).boundingBox()
      return box?.height || 0
    }),
  )
  expect(geometry[0]).toBeGreaterThan(0)
  expect(geometry[0]).toBe(geometry[1])
}

async function expectRunsWorkspaceLayout(page: Page) {
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  const inspector = page.getByRole('complementary', { name: 'Selected evaluation run' })
  const workspace = inspector.locator('..')
  const history = workspace.locator(':scope > div').first()
  const [historyBox, inspectorBox] = await Promise.all([
    history.boundingBox(),
    inspector.boundingBox(),
  ])
  expect(historyBox).not.toBeNull()
  expect(inspectorBox).not.toBeNull()
  if (!historyBox || !inspectorBox) return

  if (viewportWidth > 1160) {
    expect(inspectorBox.x - (historyBox.x + historyBox.width)).toBeGreaterThanOrEqual(24)
    expect(Math.abs(inspectorBox.y - historyBox.y)).toBeLessThanOrEqual(2)
  } else {
    expect(inspectorBox.y - (historyBox.y + historyBox.height)).toBeGreaterThanOrEqual(24)
    expect(Math.abs(inspectorBox.x - historyBox.x)).toBeLessThanOrEqual(2)
  }
}

async function expectDefaultCompareWorkspace(page: Page) {
  const panel = page.getByRole('tabpanel')
  const candidate = page.getByLabel('Comparison candidate', { exact: true })
  await expect(candidate).toBeVisible()
  await expect(candidate).toBeEnabled()
  await expect(panel.locator('select:visible:not(:disabled)')).toHaveCount(1)

  const releaseDecisionSummary = page.locator('details > summary').filter({
    has: page.getByText('Prepare a release decision', { exact: true }),
  })
  const releaseDecision = releaseDecisionSummary.locator('..')
  await expect(releaseDecision).not.toHaveAttribute('open', '')
  await expect(releaseDecision.locator('select:visible')).toHaveCount(0)
}

async function expectDialogBottomReachable(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible()
  await expect
    .poll(async () => {
      const [box, viewportHeight] = await Promise.all([
        dialog.boundingBox(),
        page.evaluate(() => window.innerHeight),
      ])
      return Boolean(box && box.y >= -1 && box.y + box.height <= viewportHeight + 1)
    })
    .toBe(true)
  const controls = await dialog.locator('button:visible').evaluateAll((elements) =>
    elements.map((element) => ({
      height: Math.round(element.getBoundingClientRect().height),
      borderRadius: getComputedStyle(element).borderRadius,
      whiteSpace: getComputedStyle(element).whiteSpace,
    })),
  )
  for (const control of controls) {
    expect(control.height).toBe(40)
    expect(control.borderRadius).toBe('6px')
    expect(control.whiteSpace).toBe('nowrap')
  }
  const confirmation = dialog.locator('input:visible')
  if ((await confirmation.count()) > 0) {
    await expect
      .poll(() =>
        confirmation.first().evaluate((element) => ({
          height: Math.round(element.getBoundingClientRect().height),
          borderRadius: getComputedStyle(element).borderRadius,
        })),
      )
      .toEqual({ height: 40, borderRadius: '6px' })
  }
  await dialog.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect
    .poll(() =>
      dialog.evaluate(
        (element) =>
          Math.ceil(element.scrollTop + element.clientHeight) >= element.scrollHeight - 1,
      ),
    )
    .toBe(true)
}

async function expectKeyboardScrollable(region: Locator, axis: 'vertical' | 'horizontal') {
  const scrollProperty = axis === 'vertical' ? 'scrollTop' : 'scrollLeft'
  const sizeProperty = axis === 'vertical' ? 'scrollHeight' : 'scrollWidth'
  const clientProperty = axis === 'vertical' ? 'clientHeight' : 'clientWidth'
  await expect
    .poll(() =>
      region.evaluate(
        (element, properties) =>
          element[properties.sizeProperty as 'scrollHeight'] >
          element[properties.clientProperty as 'clientHeight'],
        { sizeProperty, clientProperty },
      ),
    )
    .toBe(true)
  await region.evaluate((element, property) => {
    element[property as 'scrollTop'] = 0
  }, scrollProperty)
  await region.focus()
  await region.press(axis === 'vertical' ? 'ArrowDown' : 'ArrowRight')
  await expect
    .poll(() =>
      region.evaluate((element, property) => element[property as 'scrollTop'], scrollProperty),
    )
    .toBeGreaterThan(0)
  await region.evaluate(async (element, property) => {
    if (element instanceof HTMLElement) element.blur()
    await new Promise((resolve) => window.setTimeout(resolve, 250))
    element[property as 'scrollTop'] = 0
  }, scrollProperty)
  await expect
    .poll(() =>
      region.evaluate((element, property) => element[property as 'scrollTop'], scrollProperty),
    )
    .toBe(0)
}

async function expectScrollRegionsKeyboardReachable(page: Page) {
  const regions = page.locator('main [role="region"][tabindex="0"]:visible')
  for (let index = 0; index < (await regions.count()); index += 1) {
    const region = regions.nth(index)
    const overflow = await region.evaluate((element) => ({
      horizontal: element.scrollWidth > element.clientWidth,
      vertical: element.scrollHeight > element.clientHeight,
    }))
    if (overflow.horizontal) await expectKeyboardScrollable(region, 'horizontal')
    if (overflow.vertical) await expectKeyboardScrollable(region, 'vertical')
  }
}

async function expectEvaluationContrastContract(page: Page) {
  const ratios = await page.getByTestId('evaluation-scope').evaluate((element) => {
    const style = getComputedStyle(element)
    const parseHex = (value: string) => {
      const match = value.trim().match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
      if (!match) throw new Error(`Evaluation contrast token must be an opaque hex color: ${value}`)
      return match.slice(1).map((channel) => Number.parseInt(channel, 16) / 255)
    }
    const luminance = (value: string) =>
      parseHex(value)
        .map((channel) =>
          channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
        )
        .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0)
    const contrast = (foreground: string, background: string) => {
      const values = [luminance(foreground), luminance(background)].sort(
        (left, right) => right - left,
      )
      return (values[0] + 0.05) / (values[1] + 0.05)
    }
    const foregrounds = {
      muted: style.getPropertyValue('--text-muted'),
      secondary: style.getPropertyValue('--text-secondary'),
      accent: style.getPropertyValue('--evaluation-accent-text'),
    }
    const backgrounds = {
      canvas: style.getPropertyValue('--surface-canvas'),
      shell: style.getPropertyValue('--surface-shell'),
      panel: style.getPropertyValue('--surface-panel'),
      raised: style.getPropertyValue('--surface-raised'),
    }
    return Object.entries(foregrounds).flatMap(([foregroundName, foreground]) =>
      Object.entries(backgrounds).map(([backgroundName, background]) => ({
        pair: `${foregroundName}/${backgroundName}`,
        ratio: contrast(foreground, background),
      })),
    )
  })
  for (const result of ratios) {
    expect(result.ratio, `${result.pair} contrast`).toBeGreaterThanOrEqual(4.5)
  }

  const unavailableReasons = await page
    .locator('[data-evaluation-unavailable-reason="true"]:visible')
    .evaluateAll((elements) =>
      elements.map((element) => {
        let cumulativeOpacity = 1
        let current: Element | null = element
        while (current) {
          cumulativeOpacity *= Number.parseFloat(getComputedStyle(current).opacity)
          if (current.hasAttribute('data-testid')) break
          current = current.parentElement
        }
        return {
          cumulativeOpacity,
          color: getComputedStyle(element).color,
          expectedColor: getComputedStyle(element).getPropertyValue('--text-secondary').trim(),
        }
      }),
    )
  for (const reason of unavailableReasons) {
    expect(reason.cumulativeOpacity).toBe(1)
    expect(reason.color).toBe('rgb(178, 178, 184)')
    expect(reason.expectedColor).toBe('#b2b2b8')
  }
}

async function expectEvaluationControlSystem(page: Page) {
  const panel = page.getByRole('tabpanel')
  const selects = panel.locator('select:visible')
  const selectGeometry = await selects.evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element)
      return {
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderRadius,
        height: Math.round(element.getBoundingClientRect().height),
      }
    }),
  )
  for (const geometry of selectGeometry) {
    expect(geometry.height).toBe(40)
  }
  if (selectGeometry.length > 1) {
    expect(new Set(selectGeometry.map((geometry) => geometry.backgroundColor)).size).toBe(1)
    expect(new Set(selectGeometry.map((geometry) => geometry.borderRadius)).size).toBe(1)
  }

  const fieldGeometry = await panel
    .locator(
      'input:visible:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="hidden"])',
    )
    .evaluateAll((elements) =>
      elements.map((element) => ({
        label:
          element.getAttribute('aria-label') ||
          element.getAttribute('name') ||
          element.getAttribute('placeholder') ||
          element.tagName.toLowerCase(),
        height: Math.round(element.getBoundingClientRect().height),
        borderRadius: getComputedStyle(element).borderRadius,
      })),
    )
  for (const geometry of fieldGeometry) {
    expect(geometry.height, `${geometry.label} field height`).toBe(40)
    expect(geometry.borderRadius, `${geometry.label} field radius`).toBe('6px')
  }

  const actions = panel.locator('[data-evaluation-action="true"]:visible')
  const actionGeometry = await actions.evaluateAll((elements) =>
    elements.map((element) => ({
      density: element.getAttribute('data-density'),
      height: Math.round(element.getBoundingClientRect().height),
      borderRadius: getComputedStyle(element).borderRadius,
      whiteSpace: getComputedStyle(element).whiteSpace,
    })),
  )
  for (const geometry of actionGeometry) {
    expect(geometry.height).toBe(geometry.density === 'compact' ? 34 : 40)
    expect(geometry.borderRadius).toBe('6px')
    expect(geometry.whiteSpace).toBe('nowrap')
  }

  const tagGeometry = await panel
    .locator('[data-evaluation-tag="true"]:visible')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        height: Math.round(element.getBoundingClientRect().height),
        borderRadius: getComputedStyle(element).borderRadius,
        whiteSpace: getComputedStyle(element).whiteSpace,
      })),
    )
  for (const geometry of tagGeometry) {
    expect(geometry.height).toBe(22)
    expect(geometry.borderRadius).toBe('999px')
    expect(geometry.whiteSpace).toBe('nowrap')
  }

  const navigationGeometry = await page
    .locator('[data-evaluation-navigation-tab="true"]:visible')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        height: Math.round(element.getBoundingClientRect().height),
        borderRadius: getComputedStyle(element).borderRadius,
      })),
    )
  expect(navigationGeometry.length).toBeGreaterThan(0)
  for (const geometry of navigationGeometry) {
    expect(geometry.height).toBeGreaterThanOrEqual(40)
    expect(geometry.height).toBeLessThanOrEqual(44)
    expect(geometry.borderRadius).toBe('0px')
  }
  expect(new Set(navigationGeometry.map((geometry) => geometry.height)).size).toBe(1)

  const ledgerGeometry = await panel
    .locator('[data-evaluation-ledger-row="true"]:visible')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        height: Math.round(element.getBoundingClientRect().height),
        borderRadius: getComputedStyle(element).borderRadius,
        parentRuleWidth: getComputedStyle(element.parentElement as HTMLElement).borderBottomWidth,
      })),
    )
  for (const geometry of ledgerGeometry) {
    expect(geometry.height).toBeGreaterThanOrEqual(82)
    expect(geometry.borderRadius).toBe('0px')
    expect(geometry.parentRuleWidth).toBe('1px')
  }
  if (ledgerGeometry.length > 1) {
    expect(new Set(ledgerGeometry.map((geometry) => geometry.height)).size).toBe(1)
  }

  const ledgerRows = panel.locator('[data-evaluation-ledger-row="true"]:visible')
  if ((await ledgerRows.count()) > 0) {
    const row = ledgerRows.first()
    const before = await row.boundingBox()
    await row.focus()
    const focused = await row.evaluate((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const scrollport = element.closest('ol')?.getBoundingClientRect()
      const width = Number.parseFloat(style.outlineWidth)
      const offset = Number.parseFloat(style.outlineOffset)
      const expansion = Math.max(0, width + offset)
      return {
        focusVisible: element.matches(':focus-visible'),
        outlineStyle: style.outlineStyle,
        outlineWidth: width,
        outlineOffset: style.outlineOffset,
        paintContained:
          !scrollport ||
          (rect.left - expansion >= scrollport.left - 1 &&
            rect.right + expansion <= scrollport.right + 1),
      }
    })
    const after = await row.boundingBox()
    expect(focused.focusVisible).toBe(true)
    expect(focused.outlineStyle).not.toBe('none')
    expect(focused.outlineWidth).toBeGreaterThanOrEqual(1)
    expect(focused.outlineOffset).toBe('-2px')
    expect(focused.paintContained).toBe(true)
    expect(after?.width).toBe(before?.width)
    expect(after?.height).toBe(before?.height)
  }

  const actionGroups = panel.getByTestId('evaluation-run-actions')
  for (let index = 0; index < (await actionGroups.count()); index += 1) {
    const buttons = actionGroups.nth(index).locator('button:visible')
    const geometry = await buttons.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          marginLeft: getComputedStyle(element).marginLeft,
        }
      }),
    )
    for (const button of geometry) expect(button.marginLeft).toBe('0px')
    for (let buttonIndex = 1; buttonIndex < geometry.length; buttonIndex += 1) {
      const previous = geometry[buttonIndex - 1]
      const current = geometry[buttonIndex]
      const sameRow = Math.abs(previous.top - current.top) <= 1
      const gap = sameRow ? current.left - previous.right : current.top - previous.bottom
      expect(gap, 'run inspector actions remain one visual group').toBeGreaterThanOrEqual(0)
      expect(gap, 'run inspector actions remain one visual group').toBeLessThanOrEqual(12)
    }
  }

  const disclosures = panel.locator(
    '[data-evaluation-report-disclosure="true"]:visible > summary:visible',
  )
  if ((await disclosures.count()) > 0) {
    const summary = disclosures.first()
    await summary.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(summary).toBeFocused()
    const focus = await summary.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        focusVisible: element.matches(':focus-visible'),
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        outlineOffset: style.outlineOffset,
      }
    })
    expect(focus.focusVisible).toBe(true)
    expect(focus.outlineStyle).not.toBe('none')
    expect(focus.outlineWidth).toBeGreaterThanOrEqual(1)
    expect(focus.outlineOffset).toBe('-3px')
  }

  await expectEvaluationContrastContract(page)
}

async function expectCompactVerticalFlow(container: Locator) {
  const geometry = await container.evaluate((element) => {
    const containerRect = element.getBoundingClientRect()
    const childRects = Array.from(element.children)
      .filter((child) => getComputedStyle(child).display !== 'none')
      .map((child) => child.getBoundingClientRect())
    const gaps = childRects.slice(1).map((rect, index) => rect.top - childRects[index].bottom)
    return {
      childCount: childRects.length,
      topInset: childRects.length ? childRects[0].top - containerRect.top : Infinity,
      bottomInset: childRects.length
        ? containerRect.bottom - childRects[childRects.length - 1].bottom
        : Infinity,
      maximumGap: gaps.length ? Math.max(...gaps) : 0,
    }
  })

  expect(geometry.childCount).toBeGreaterThan(1)
  expect(geometry.topInset).toBeLessThanOrEqual(32)
  expect(geometry.bottomInset).toBeLessThanOrEqual(32)
  expect(geometry.maximumGap).toBeLessThanOrEqual(40)
}

const responsiveEvaluationSurfaces = [
  { tab: 'Overview', route: '/evaluation', visibleText: 'Latest decision', capture: 'overview' },
  {
    tab: 'New experiment',
    route: '/evaluation?view=new',
    visibleText: 'New evaluation experiment',
    capture: 'new-experiment',
  },
  { tab: 'Runs', route: '/evaluation?view=runs', visibleText: 'Evaluation runs', capture: 'runs' },
  {
    tab: 'Reports',
    route: `/evaluation?view=reports&report=${EVALUATION_RUN_IDS.candidate}`,
    visibleText: 'Reports',
    capture: 'reports',
  },
  {
    tab: 'Compare',
    route: '/evaluation?view=compare',
    visibleText: 'Compare a candidate with its baseline',
    capture: 'compare',
  },
] as const

async function expectResponsiveEvaluationSurface(
  page: Page,
  surface: (typeof responsiveEvaluationSurfaces)[number],
  viewportName: string,
) {
  const mobileViewport = viewportName.startsWith('mobile')
  await page.goto(surface.route)
  await expect(page.getByText(surface.visibleText, { exact: true }).first()).toBeVisible()
  const brand = page.getByRole('link', { name: 'vLLM Semantic Router home' })
  await expect(brand).toBeVisible()
  await expect
    .poll(async () => (await brand.boundingBox())?.y ?? -Infinity)
    .toBeGreaterThanOrEqual(0)
  const hero = page
    .getByRole('heading', { name: 'Evaluation', exact: true })
    .locator('xpath=ancestor::header[1]')
  await expect(hero).toBeVisible()
  const pageShell = hero.locator('xpath=ancestor::section[1]/..')
  await expect
    .poll(async () => {
      const [heroBox, shellBox, paddingTop] = await Promise.all([
        hero.boundingBox(),
        pageShell.boundingBox(),
        pageShell.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingTop)),
      ])
      return heroBox && shellBox ? Math.abs(heroBox.y - shellBox.y - paddingTop) : Infinity
    })
    .toBeLessThanOrEqual(1)
  if (mobileViewport) {
    await expect.poll(async () => (await hero.boundingBox())?.height ?? Infinity).toBeLessThan(190)
  }
  await expect(page.getByRole('tablist', { name: 'Evaluation views' })).toBeVisible()
  await expect
    .poll(async () => {
      const [tab, tablist] = await Promise.all([
        page.getByRole('tab', { name: surface.tab, exact: true }).boundingBox(),
        page.getByRole('tablist', { name: 'Evaluation views' }).boundingBox(),
      ])
      return Boolean(
        tab &&
          tablist &&
          tab.x >= tablist.x - 1 &&
          tab.x + tab.width <= tablist.x + tablist.width + 1,
      )
    })
    .toBe(true)
  await expect(page.getByRole('button', { name: /product guide/i })).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop),
      ),
    )
    .toBeLessThanOrEqual(1)
  await expectNoHorizontalOverflow(page)
  await expectProductEvaluationLanguage(page)
  await expectEvaluationControlSystem(page)
  if (surface.capture === 'overview') await expectOverviewActionParity(page)
  if (surface.capture === 'runs') await expectRunsWorkspaceLayout(page)
  if (surface.capture === 'compare') await expectDefaultCompareWorkspace(page)
  await captureEvaluationSurface(page, `${surface.capture}-${viewportName}`)
  if (viewportName === 'desktop') {
    await captureEvaluationFullPage(page, `${surface.capture}-${viewportName}-full`)
  }
  await expectScrollRegionsKeyboardReachable(page)
  await expectPageBottomReachable(page)
  await expectEvaluationBottomGutter(page)
  await captureEvaluationSurface(page, `${surface.capture}-${viewportName}-bottom`)
}

test.describe('Evaluation Plane', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedAppShell(page, {
      user: evalUser,
      settings: { readonlyMode: false, serverReadonly: false },
    })
  })

  test('shows complete evaluation coverage and benchmark readiness in product language', async ({
    page,
  }) => {
    await mockEvaluationPlane(page)
    await page.goto('/evaluation')

    await expect(page.getByRole('heading', { name: 'Evaluation', exact: true })).toBeVisible()
    for (const tab of ['Overview', 'New experiment', 'Runs', 'Reports', 'Compare']) {
      await expect(page.getByRole('tab', { name: tab, exact: true })).toBeVisible()
    }

    await expect(page.getByText('Decision quality', { exact: true })).toBeVisible()
    await expect(
      page.getByText(
        'This run is useful for exploration, but it is not ready to support a release decision. Run a qualified benchmark or live evaluation before changing production.',
        { exact: true },
      ),
    ).toBeVisible()
    await expectProductEvaluationLanguage(page)

    const readiness = page.getByRole('table', {
      name: 'Available measurements and latest results by evaluation area',
    })
    await expect(readiness.getByRole('row')).toHaveCount(evaluationCatalog.tracks.length + 1)
    for (const track of evaluationCatalog.tracks) {
      await expect(
        readiness.getByRole('row').filter({
          has: page.getByText(track.name, { exact: true }),
        }),
      ).toBeVisible()
    }
    await expect(
      readiness.getByRole('row').filter({ has: page.getByText('Routing', { exact: true }) }),
    ).toContainText('Diagnostic · Routing validation')
    await expectKeyboardScrollable(
      page.getByRole('region', { name: 'Scrollable evaluation area readiness' }),
      'vertical',
    )
    const declaredMethodCount = evaluationCatalog.suites.reduce(
      (count, suite) => count + suite.methods.length,
      0,
    )
    const methods = page.locator('section[aria-labelledby="evaluation-methods-title"]')
    const methodSummary = methods.locator('details > summary').filter({
      has: page.getByText('Browse benchmark methods', { exact: true }),
    })
    const methodDisclosure = methodSummary.locator('..')
    await expect(methodDisclosure).not.toHaveAttribute('open', '')
    await methodSummary.click()
    const methodTable = methods.getByRole('table', {
      name: 'Available evaluation methods and setup readiness',
    })
    await expect(methodTable.getByRole('row')).toHaveCount(declaredMethodCount + 1)
    await expectKeyboardScrollable(
      methods.getByRole('region', { name: 'Scrollable evaluation method readiness' }),
      'vertical',
    )
    const methodSearch = methods.getByLabel('Search evaluation methods')
    const hardPolicySuite = evaluationCatalog.suites.find((suite) =>
      suite.methods.some((method) => method.id === 'safety.hard-policy-enforcement.v1'),
    )!
    await methodSearch.fill('hard-policy')
    await expect(
      methodTable.getByRole('row').filter({
        has: page.getByText(hardPolicySuite.name, { exact: true }),
      }),
    ).toBeVisible()
    await expect(methods.getByRole('status')).toHaveText(
      `Showing 1 of ${declaredMethodCount} methods`,
    )
    await methodSearch.clear()
    await methods.getByLabel('Method evaluation area filter').selectOption('safety')
    await methods.getByLabel('Method readiness filter').selectOption('setup_required')
    await expect(
      methodTable.getByRole('row').filter({
        has: page.getByText(hardPolicySuite.name, { exact: true }),
      }),
    ).toContainText('Setup required')
    await expect(methods.getByRole('status')).toHaveText(
      `Showing 1 of ${declaredMethodCount} methods`,
    )
    await captureEvaluationSurface(page, 'overview-desktop')
  })

  test('contains long readiness evidence inside its own scroll region at 320px', async ({
    page,
  }) => {
    const longDescription =
      'Routes exact production request cohorts across a frozen Mixture-of-Models pool while preserving abstention, fallback, selector latency, and per-arm outcome provenance for release review.'
    const longCatalog = {
      ...evaluationCatalog,
      tracks: evaluationCatalog.tracks.map((track) =>
        track.id === 'routing'
          ? {
              ...track,
              description: longDescription,
            }
          : track,
      ),
    }
    await page.setViewportSize({ width: 320, height: 568 })
    await mockEvaluationPlane(page, defaultEvaluationRuns, { catalog: longCatalog })
    await page.goto('/evaluation')

    const readiness = page.getByRole('region', {
      name: 'Scrollable evaluation area readiness',
    })
    await expect(readiness).toBeVisible()
    await expect(readiness).toHaveAttribute('tabindex', '0')
    await expect(readiness.getByText(longDescription, { exact: true })).toBeVisible()
    await expect
      .poll(() => readiness.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeGreaterThan(0)
    await expectKeyboardScrollable(readiness, 'horizontal')
    await expectNoHorizontalOverflow(page)
  })

  test('keeps the initial loading boundary until catalog and durable ledger both settle', async ({
    page,
  }) => {
    await mockEvaluationPlane(page, defaultEvaluationRuns, { ledgerDelayMs: 750 })
    const catalogResponse = page.waitForResponse('**/api/evaluation/v1/catalog')
    await page.goto('/evaluation')
    await catalogResponse

    await expect(page.getByText('Loading evaluation', { exact: true })).toBeVisible()
    await expect(page.getByText('Latest decision', { exact: true })).toHaveCount(0)

    await expect(page.getByText('Loading evaluation', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Latest decision', { exact: true })).toBeVisible()
  })

  test('keeps evidence navigation available while suppressing run mutations in read-only mode', async ({
    page,
  }) => {
    await mockAuthenticatedAppShell(page, {
      user: evalUser,
      settings: { readonlyMode: true, serverReadonly: true },
    })
    await mockEvaluationPlane(page)
    await page.goto(`/evaluation?view=runs&run=${EVALUATION_RUN_IDS.candidate}`)

    await expect(page.getByText(/server is in read-only mode/i)).toBeVisible()
    await expect(
      page.getByRole('button', { name: `Open report for Candidate recipe` }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete Candidate recipe' })).toHaveCount(0)
    await page.getByRole('button', { name: `Open report for Candidate recipe` }).click()
    await expect(page.getByRole('heading', { name: 'Candidate recipe' })).toBeVisible()
  })

  test('keeps release decision inputs progressive and touch discoverable at 320px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await mockEvaluationPlane(page)
    await page.goto('/evaluation?view=compare')

    const summary = page.locator('details > summary').filter({
      has: page.getByText('Prepare a release decision', { exact: true }),
    })
    const disclosure = summary.locator('..')
    const primarySelects = page.locator('#evaluation-panel select:visible')
    await expect(primarySelects).toHaveCount(1)
    const primarySelectStyles = await primarySelects.evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element)
        return {
          backgroundColor: style.backgroundColor,
          borderRadius: style.borderRadius,
          height: element.getBoundingClientRect().height,
        }
      }),
    )
    expect(new Set(primarySelectStyles.map((style) => style.backgroundColor)).size).toBe(1)
    expect(new Set(primarySelectStyles.map((style) => style.borderRadius)).size).toBe(1)
    expect(new Set(primarySelectStyles.map((style) => style.height)).size).toBe(1)
    await expect(disclosure).not.toHaveAttribute('open', '')
    await expect(disclosure.locator('select:visible')).toHaveCount(0)
    await expect
      .poll(() => summary.evaluate((element) => getComputedStyle(element, '::after').content))
      .not.toBe('none')
    await summary.click()
    await expect(disclosure).toHaveAttribute('open', '')
    await expect(page.getByLabel('Release decision change type')).toBeVisible()
    const inputSummary = disclosure.locator('details > summary').filter({
      has: page.getByText('Review evaluation inputs', { exact: true }),
    })
    const inputs = inputSummary.locator('..')
    await expect(inputs).not.toHaveAttribute('open', '')
    await inputSummary.click()
    await expect(page.getByRole('region', { name: 'Release decision inputs' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await inputSummary.click()
    await expect(inputs).not.toHaveAttribute('open', '')
  })

  test('keeps native radio and checkbox inline width outside the shared field skin', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await mockEvaluationPlane(page)
    await page.goto('/evaluation?view=new')

    for (const control of [page.getByRole('radio').first(), page.getByRole('checkbox').first()]) {
      await expect(control).toBeVisible()
      await control.hover()
      await control.focus()
      const width = await control.evaluate((element) => element.getBoundingClientRect().width)
      expect(width).toBeLessThanOrEqual(24)
    }
    await expectNoHorizontalOverflow(page)
  })

  test('loads the run ledger incrementally without hiding the server total', async ({ page }) => {
    const runs = Array.from({ length: 12 }, (_, index) =>
      evaluationRun(
        evaluationRunID(100 + index),
        `Evaluation ${index + 1}`,
        'completed',
        `2026-08-${String(29 - index).padStart(2, '0')}T00:00:00Z`,
      ),
    )
    await mockEvaluationPlane(page, runs, { runPageSize: 5 })
    await page.goto('/evaluation?view=runs')

    await expect(page.getByText(/5 matching runs.*5 of 12 loaded/)).toBeVisible()
    await expect(
      page.getByText(
        'Search and filters cover only the 5 loaded runs. Load older records to search and filter the full history.',
        { exact: true },
      ),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Load more', exact: true }).click()
    await expect(page.getByText(/10 matching runs.*10 of 12 loaded/)).toBeVisible()
    await page.getByRole('button', { name: 'Load more', exact: true }).click()
    await expect(page.getByText(/12 matching runs.*12 of 12 loaded/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0)
    await expect(page.getByText(/Search and filters cover only/)).toHaveCount(0)
  })

  test('resolves paginated run, report, and comparison deep links by exact identity', async ({
    page,
  }) => {
    const recent = Array.from({ length: 50 }, (_, index) =>
      evaluationRun(
        evaluationRunID(200 + index),
        `Recent evaluation ${index + 1}`,
        'completed',
        `2026-08-${String(29 - (index % 20)).padStart(2, '0')}T00:00:00Z`,
      ),
    )
    const olderBaseline = evaluationRun(
      EVALUATION_RUN_IDS.olderBaseline,
      'Older production baseline',
      'completed',
      '2026-07-01T00:00:00Z',
    )
    const olderCandidate = evaluationRun(
      EVALUATION_RUN_IDS.olderCandidate,
      'Older routed candidate',
      'completed',
      '2026-07-02T00:00:00Z',
      'recipe',
      { baseline_run_id: olderBaseline.id },
    )
    const state = await mockEvaluationPlane(page, [...recent, olderCandidate, olderBaseline], {
      runPageSize: 50,
    })

    await page.goto(`/evaluation?view=runs&run=${EVALUATION_RUN_IDS.olderCandidate}`)
    await expect(page.getByRole('heading', { name: 'Older routed candidate' })).toBeVisible()
    expect(state.runRequests).toContain(EVALUATION_RUN_IDS.olderCandidate)

    await page.goto(`/evaluation?view=reports&report=${EVALUATION_RUN_IDS.olderCandidate}`)
    await expect(page.getByRole('heading', { name: 'Older routed candidate' })).toBeVisible()
    await expect(page.getByLabel('Run')).toHaveValue(EVALUATION_RUN_IDS.olderCandidate)

    await page.goto(
      `/evaluation?view=compare&baseline=${EVALUATION_RUN_IDS.olderBaseline}&candidate=${EVALUATION_RUN_IDS.olderCandidate}`,
    )
    await expect(page.getByLabel('Comparison candidate', { exact: true })).toHaveValue(
      EVALUATION_RUN_IDS.olderCandidate,
    )
    await expect(page.getByText('Older production baseline', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Compare results' }).click()
    await expect.poll(() => state.comparisonRequests.length).toBe(1)
    expect(state.comparisonRequests[0]).toEqual({
      baselineRunID: EVALUATION_RUN_IDS.olderBaseline,
      candidateRunID: EVALUATION_RUN_IDS.olderCandidate,
    })
  })

  test('refreshes an off-page selected run directly when its terminal event arrives', async ({
    page,
  }) => {
    const recent = Array.from({ length: 50 }, (_, index) =>
      evaluationRun(
        evaluationRunID(400 + index),
        `Recent terminal refresh ${index + 1}`,
        'completed',
        `2026-08-${String(29 - (index % 20)).padStart(2, '0')}T00:00:00Z`,
      ),
    )
    const offPageRun = evaluationRun(
      evaluationRunID(499),
      'Off-page live evaluation',
      'running',
      '2026-07-01T00:00:00Z',
    )
    const state = await mockEvaluationPlane(page, [...recent, offPageRun], {
      runPageSize: 50,
      completeRunOnEventStream: offPageRun.id,
    })

    await page.goto(`/evaluation?view=runs&run=${offPageRun.id}`)
    await expect(page.getByRole('heading', { name: offPageRun.name })).toBeVisible()
    await expect(
      page.getByRole('button', { name: `Open report for ${offPageRun.name}` }),
    ).toBeVisible()
    await expect
      .poll(() => state.runRequests.filter((runID) => runID === offPageRun.id).length)
      .toBeGreaterThanOrEqual(2)
    await expect(page.getByText(/50 matching runs.*50 of 51 loaded/)).toBeVisible()
  })

  test('resumes first-page polling after a load-more request fails', async ({ page }) => {
    const runs = Array.from({ length: 6 }, (_, index) =>
      evaluationRun(
        evaluationRunID(300 + index),
        `Polling evaluation ${index + 1}`,
        'completed',
        `2026-08-${String(29 - index).padStart(2, '0')}T00:00:00Z`,
      ),
    )
    const state = await mockEvaluationPlane(page, runs, {
      runPageSize: 5,
      failFirstLoadMore: true,
    })
    await page.goto('/evaluation?view=runs')

    await page.getByRole('button', { name: 'Load more', exact: true }).click()
    const refreshIssue = page.getByRole('status').filter({
      has: page.getByText('Run history could not refresh. Showing the last loaded run state.', {
        exact: true,
      }),
    })
    await expect(refreshIssue).toBeVisible()
    const backendFailure = refreshIssue.getByText('temporary ledger page failure', {
      exact: true,
    })
    await expect(backendFailure).not.toBeVisible()
    await refreshIssue
      .locator('details[data-evaluation-technical-details="true"] > summary')
      .click()
    await expect(backendFailure).toBeVisible()
    const requestCountAfterFailure = state.getLedgerRequestCount()
    await expect
      .poll(() => state.getLedgerRequestCount(), { timeout: 7_000 })
      .toBeGreaterThan(requestCountAfterFailure)
    await expect(page.getByText(/temporary ledger page failure/)).toHaveCount(0)
    await page.getByRole('button', { name: 'Load more', exact: true }).click()
    await expect(page.getByText(/6 matching runs.*6 of 6 loaded/)).toBeVisible()
  })

  test('keeps completed evidence identity honest while the newest report is loading', async ({
    page,
  }) => {
    await mockEvaluationPlane(page, defaultEvaluationRuns, { reportDelayMs: 2_000 })
    await page.goto('/evaluation')

    await expect(page.getByText('Loading report summary…', { exact: true })).toBeVisible()
    await expect(page.locator('#evaluation-readiness-title')).toHaveText('Candidate recipe')
    await expect(page.locator('#latest-evidence-title')).toHaveText('Candidate recipe')
    await expect(
      page.getByText(
        'Loading the newest completed report. No decision is shown until the result is ready.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(
      page.getByText('Establish the first evaluation baseline', { exact: true }),
    ).toHaveCount(0)
    await expect(page.getByText('No completed report yet', { exact: true })).toHaveCount(0)

    await expect(page.getByText('Loading report summary…', { exact: true })).toHaveCount(0)
    await expect(
      page.getByText(
        'Headline results are verified by the evaluation service. Open the full report for every measured outcome.',
        { exact: true },
      ),
    ).toBeVisible()
  })

  test('supports keyboard navigation across the evaluation tabs', async ({ page }) => {
    await mockEvaluationPlane(page)
    await page.goto('/evaluation')

    const overview = page.getByRole('tab', { name: 'Overview', exact: true })
    await overview.focus()
    await overview.press('End')
    await expect(page.getByRole('tab', { name: 'Compare', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('compare')

    const compare = page.getByRole('tab', { name: 'Compare', exact: true })
    await compare.focus()
    await compare.press('Home')
    await expect(overview).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBeNull()

    await overview.focus()
    await overview.press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'New experiment', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('keeps live Mixture deployment targets distinct while preserving their server IDs', async ({
    page,
  }) => {
    await mockEvaluationPlane(page)
    await page.goto('/evaluation?view=new')

    await page
      .getByRole('radio', {
        name: 'Live: evaluate a registered Mixture.',
        exact: true,
      })
      .check()
    const target = page.getByLabel('Mixture to evaluate')
    expect(await target.locator('option').allTextContents()).toEqual([
      'Select Mixture',
      'test-mom · Baseline',
      'test-mom · Candidate',
    ])
    await target.selectOption(EVALUATION_BASELINE_MOM_TARGET_ID)
    await expect(target).toHaveValue(EVALUATION_BASELINE_MOM_TARGET_ID)
    await target.selectOption(EVALUATION_MOM_TARGET_ID)
    await expect(target).toHaveValue(EVALUATION_MOM_TARGET_ID)
  })

  test('creates and starts a diagnostic run through separately authorized endpoints', async ({
    page,
  }) => {
    const state = await mockEvaluationPlane(page, defaultEvaluationRuns, { mutationDelayMs: 250 })
    await page.goto('/evaluation?view=new')

    await expect(page.getByText('Evaluation scope · Diagnostic', { exact: true })).toBeVisible()
    await page.getByRole('radio', { name: /Replay/ }).check()
    await page.getByLabel('Evaluation target').selectOption('fixture')
    await page.getByRole('checkbox', { name: /Evaluation harness smoke/ }).check()
    await page.getByLabel('Change type').selectOption({ label: 'Routing recipe' })
    await page.getByLabel('Experiment name').fill('Recipe v4 candidate')
    await page.getByLabel('Description').fill('Validate the full evaluation surface.')
    await page.getByLabel('Maximum cases').fill('64')
    await page.getByLabel('Parallel requests').fill('8')
    await page.getByLabel('Repeatability key').fill('7')
    await page.getByRole('heading', { name: 'New evaluation experiment' }).scrollIntoViewIfNeeded()
    await captureEvaluationSurface(page, 'new-experiment-desktop')
    await page.getByRole('button', { name: 'Create and start' }).click()

    const form = page.locator('form[aria-busy]')
    await expect(form).toHaveAttribute('aria-busy', 'true')
    await expect(
      page.locator('fieldset[aria-label="Evaluation experiment fields"]'),
    ).toHaveAttribute('disabled', '')
    await expect(page.getByRole('button', { name: 'Creating…' })).toBeDisabled()

    await expect.poll(() => state.createdRequests.length).toBe(1)
    expect(state.createdRequests[0]).toMatchObject({
      name: 'Recipe v4 candidate',
      description: 'Validate the full evaluation surface.',
      suite_ids: ['evaluation-smoke'],
      track_ids: [...evaluationCatalog.suites[0].track_ids],
      mode: 'replay',
      target_id: 'fixture',
      change_profile: 'recipe',
      sample_limit: 64,
      concurrency: 8,
      seed: 7,
    })
    expect(state.createdRequests[0].client_request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    await expect.poll(state.getStartCount).toBe(1)
    expect(state.getRuns()[0].evidence_level).toBe('E0')
    await expect(page.getByRole('tab', { name: 'Runs' })).toHaveAttribute('aria-selected', 'true')

    const originalRequest = state.createdRequests[0]
    const originalRunID = state
      .getRuns()
      .find((run) => run.client_request_id === originalRequest.client_request_id)?.id
    const retry = await page.evaluate(async (request) => {
      const send = (body: typeof request) =>
        fetch('/api/evaluation/v1/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      const repeated = await send(request)
      const repeatedRun = (await repeated.json()) as { id: string; client_request_id?: string }
      const conflicting = await send({ ...request, name: `${request.name} changed` })
      return {
        repeatedStatus: repeated.status,
        repeatedRun,
        conflictingStatus: conflicting.status,
      }
    }, originalRequest)
    expect(retry.repeatedStatus).toBe(201)
    expect(retry.repeatedRun).toMatchObject({
      id: originalRunID,
      client_request_id: originalRequest.client_request_id,
    })
    expect(retry.conflictingStatus).toBe(409)
    expect(state.createAttempts).toHaveLength(3)
    expect(
      state.getRuns().filter((run) => run.client_request_id === originalRequest.client_request_id),
    ).toHaveLength(1)
  })

  test('freezes the live Capacity SLO and repeated load protocol in the run', async ({ page }) => {
    const state = await mockEvaluationPlane(page)
    await page.goto('/evaluation?view=new')

    await page
      .getByRole('radio', {
        name: 'Live: evaluate a registered Mixture.',
        exact: true,
      })
      .check()
    await page.getByLabel('Mixture to evaluate').selectOption(EVALUATION_MOM_TARGET_ID)
    await expect(page.getByLabel('Mixture to evaluate')).toHaveValue(EVALUATION_MOM_TARGET_ID)
    await page.getByRole('checkbox', { name: /Live Mixture-of-Models core/ }).uncheck()
    await page.getByRole('checkbox', { name: /Live capacity/ }).check()

    const capacity = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Capacity service objective' }),
    })
    const requiredConcurrency = capacity.getByRole('spinbutton', {
      name: /^Required concurrency/,
    })
    await expect(requiredConcurrency).toHaveValue('')
    await capacity.getByRole('button', { name: /Balanced service/ }).click()
    await expect(requiredConcurrency).toHaveValue('4')
    await expect(capacity.getByRole('spinbutton', { name: /^Maximum p95 latency/ })).toHaveValue(
      '750',
    )
    await expect(capacity.getByRole('spinbutton', { name: /^Maximum error rate/ })).toHaveValue(
      '0.02',
    )
    await expect(capacity.getByRole('spinbutton', { name: /^Minimum throughput/ })).toHaveValue(
      '10',
    )
    await expect(
      capacity.getByRole('spinbutton', { name: /^Minimum scaling efficiency/ }),
    ).toHaveValue('0.7')
    await expect(capacity.getByLabel('Recorded capacity load plan')).toContainText(
      '1 → 2 → 4 concurrent requests',
    )
    await expect(capacity.getByLabel('Recorded capacity load plan')).toContainText(
      '100 requests × 3 repetitions',
    )

    await page.getByLabel('Experiment name').fill('Live capacity operating point')
    await requiredConcurrency.fill('5')
    await page.getByRole('button', { name: 'Create and start' }).click()
    await expect
      .poll(() => requiredConcurrency.evaluate((input: HTMLInputElement) => input.validity.valid))
      .toBe(false)
    expect(state.createdRequests).toHaveLength(0)

    await requiredConcurrency.fill('4')
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
    await page.getByRole('button', { name: 'Create and start' }).click()

    await expect.poll(() => state.createdRequests.length).toBe(1)
    expect(state.createdRequests[0]).toMatchObject({
      name: 'Live capacity operating point',
      mode: 'live',
      target_id: EVALUATION_MOM_TARGET_ID,
      suite_ids: ['live-capacity'],
      track_ids: ['capacity'],
      concurrency: 4,
      capacity_slo: {
        schema_version: 'evaluation.v1',
        required_concurrency: 4,
        max_latency_p95_ms: 750,
        max_error_rate: 0.02,
        min_throughput_rps: 10,
        min_throughput_scaling_efficiency: 0.7,
      },
      capacity_load_protocol: {
        schema_version: 'evaluation.v1',
        kind: 'closed-loop',
        concurrency_levels: [1, 2, 4],
        warmup_request_multiplier: 2,
        measurement_requests_per_repetition: 100,
        repetitions_per_level: 3,
        confidence_level: 0.95,
        max_throughput_cv: 0.2,
        max_latency_p95_cv: 0.2,
      },
    })
    await expect.poll(state.getStartCount).toBe(1)
  })

  test('copies and locks the exact cohort when creating a candidate from a baseline', async ({
    page,
  }) => {
    const state = await mockEvaluationPlane(page)
    await page.goto('/evaluation?view=new')

    await page.getByLabel('Baseline run').selectOption(EVALUATION_RUN_IDS.baseline)
    await expect(
      page.getByText(
        'The comparison setup is copied and locked: change type, run type, Mixture, benchmarks, evaluation areas, sample size, parallel requests, performance goals, and repeatability key.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(page.getByLabel('Change type')).toHaveValue('recipe')
    await expect(page.getByLabel('Change type')).toBeDisabled()
    await expect(page.getByLabel('Evaluation source')).toHaveValue('fixture')
    await expect(page.getByLabel('Evaluation source')).toBeDisabled()
    await expect(page.getByRole('spinbutton', { name: 'Maximum cases', exact: true })).toHaveValue(
      '4',
    )
    await expect(
      page.getByRole('spinbutton', { name: 'Maximum cases', exact: true }),
    ).toBeDisabled()
    await expect(
      page.getByRole('spinbutton', { name: 'Parallel requests', exact: true }),
    ).toHaveValue('4')
    await expect(
      page.getByRole('spinbutton', { name: 'Parallel requests', exact: true }),
    ).toBeDisabled()
    await expect(page.getByRole('spinbutton', { name: /^Repeatability key/ })).toHaveValue('42')
    await expect(page.getByRole('spinbutton', { name: /^Repeatability key/ })).toBeDisabled()

    await page.getByLabel('Experiment name').fill('Paired recipe candidate')
    await page.getByLabel('Description').fill('Exact-cohort candidate for paired comparison.')
    await page.getByRole('checkbox', { name: /Start immediately/ }).uncheck()
    await page.getByRole('button', { name: 'Create draft' }).click()

    await expect.poll(() => state.createdRequests.length).toBe(1)
    expect(state.createdRequests[0]).toMatchObject({
      baseline_run_id: EVALUATION_RUN_IDS.baseline,
      mode: 'replay',
      target_id: 'fixture',
      change_profile: 'recipe',
      suite_ids: ['evaluation-smoke'],
      track_ids: [...evaluationCatalog.suites[0].track_ids],
      sample_limit: 4,
      concurrency: 4,
      seed: 42,
    })
  })

  test('offers reports only for completed runs and returns 409 for terminal non-reports', async ({
    page,
  }) => {
    const state = await mockEvaluationPlane(page)
    await page.goto('/evaluation?view=reports')

    const selector = page.getByLabel('Run')
    await expect(selector).toBeVisible()
    await expect(selector.locator('option')).toHaveCount(4)
    const options = await selector.locator('option').allTextContents()
    expect(options).toEqual([
      'Select a completed run',
      'Candidate recipe · Routing recipe · Replay · Diagnostic · 4 cases',
      'Production baseline · Routing recipe · Replay · Diagnostic · 4 cases',
      'Unpaired diagnostic · Routing recipe · Replay · Diagnostic · 4 cases',
    ])
    expect(options.join(' ')).not.toContain('Live AMD validation')
    expect(options.join(' ')).not.toContain('Failed diagnostic')
    expect(options.join(' ')).not.toContain('Cancelled diagnostic')

    const statuses = await page.evaluate(
      async ([failedRunID, cancelledRunID]) => {
        const [failed, cancelled] = await Promise.all([
          fetch(`/api/evaluation/v1/runs/${failedRunID}/report`),
          fetch(`/api/evaluation/v1/runs/${cancelledRunID}/report`),
        ])
        return [failed.status, cancelled.status]
      },
      [EVALUATION_RUN_IDS.failed, EVALUATION_RUN_IDS.cancelled],
    )
    expect(statuses).toEqual([409, 409])
    expect(state.reportRequests).toEqual(
      expect.arrayContaining([
        EVALUATION_RUN_IDS.candidate,
        EVALUATION_RUN_IDS.failed,
        EVALUATION_RUN_IDS.cancelled,
      ]),
    )
  })

  test('keeps workspace-owned route state isolated', async ({ page }) => {
    await mockEvaluationPlane(page)
    await page.goto(`/evaluation?report=${EVALUATION_RUN_IDS.unpaired}`)

    await expect(page.locator('#latest-evidence-title')).toHaveText('Candidate recipe')
    await page.getByRole('button', { name: 'Open full report' }).click()

    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('reports')
    await expect
      .poll(() => new URL(page.url()).searchParams.get('report'))
      .toBe(EVALUATION_RUN_IDS.candidate)
    await expect(page.getByRole('heading', { name: 'Candidate recipe' })).toBeVisible()
    await expect(
      page
        .locator('section[aria-labelledby="report-diagnostics-title"]')
        .getByText('Total records')
        .locator('..'),
    ).toContainText('32')
  })

  test('keeps the selected report explicit during a service outage', async ({ page }) => {
    const state = await mockEvaluationPlane(page, defaultEvaluationRuns, {
      reportFailureIDs: [EVALUATION_RUN_IDS.candidate],
      reportFailureStatus: 503,
    })
    await page.goto('/evaluation')

    const latestReport = page.locator('section[aria-labelledby="latest-evidence-title"]')
    await expect(latestReport.getByText('Latest report could not be refreshed.')).toBeVisible()
    const technicalDetails = latestReport.locator(
      'details[data-evaluation-technical-details="true"]',
    )
    await expect(technicalDetails).not.toHaveAttribute('open', '')
    await expect(page.getByText('report storage is temporarily unavailable')).toBeHidden()
    await technicalDetails.getByText('Technical details', { exact: true }).click()
    await expect(page.getByText('report storage is temporarily unavailable')).toBeVisible()
    expect(state.reportRequests).toEqual([EVALUATION_RUN_IDS.candidate])
  })

  test('changes a comparison candidate and its matching baseline atomically', async ({ page }) => {
    const secondBaseline = evaluationRun(
      EVALUATION_RUN_IDS.secondBaseline,
      'Second baseline',
      'completed',
      '2026-08-26T00:00:00Z',
    )
    const secondCandidate = evaluationRun(
      EVALUATION_RUN_IDS.secondCandidate,
      'Second candidate',
      'completed',
      '2026-08-29T12:00:00Z',
      'recipe',
      { baseline_run_id: secondBaseline.id },
    )
    await mockEvaluationPlane(page, [secondCandidate, secondBaseline, ...defaultEvaluationRuns])
    await page.goto(
      `/evaluation?view=compare&baseline=${EVALUATION_RUN_IDS.baseline}&candidate=${EVALUATION_RUN_IDS.candidate}`,
    )

    await page.getByRole('button', { name: 'Compare results' }).click()
    await expect(page.getByRole('table', { name: 'Paired comparison metrics' })).toBeVisible()
    await page.getByLabel('Comparison candidate', { exact: true }).selectOption(secondCandidate.id)

    await expect(page.getByRole('table', { name: 'Paired comparison metrics' })).toHaveCount(0)
    await expect(
      page.getByText('Choose a candidate, then calculate its paired comparison.'),
    ).toBeVisible()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('candidate'))
      .toBe(secondCandidate.id)
    await expect
      .poll(() => new URL(page.url()).searchParams.get('baseline'))
      .toBe(secondBaseline.id)
    await expect(page.getByText(secondBaseline.name, { exact: true })).toBeVisible()
  })

  test('rejects controlled-pair cohort order drift and missing Mixture identity', async ({
    page,
  }) => {
    const orderedPairID = evaluationRunID(950)
    const orderedBaseline = evaluationRun(
      evaluationRunID(951),
      'Ordered baseline',
      'completed',
      '2026-08-29T13:00:00Z',
      'recipe',
      {
        mode: 'live',
        target_id: EVALUATION_BASELINE_MOM_TARGET_ID,
        mixture: EVALUATION_MOM,
        suite_ids: ['live-mom-core', 'normalized-promotion-cohort'],
        track_ids: ['routing', 'joint'],
        controlled_pair: { pair_id: orderedPairID, role: 'baseline' },
      },
    )
    const reorderedCandidate = evaluationRun(
      evaluationRunID(952),
      'Reordered candidate',
      'completed',
      '2026-08-29T13:01:00Z',
      'recipe',
      {
        ...orderedBaseline,
        id: evaluationRunID(952),
        client_request_id: evaluationRunID(952),
        name: 'Reordered candidate',
        target_id: EVALUATION_MOM_TARGET_ID,
        baseline_run_id: orderedBaseline.id,
        suite_ids: [...orderedBaseline.suite_ids].reverse(),
        track_ids: [...orderedBaseline.track_ids].reverse(),
        controlled_pair: { pair_id: orderedPairID, role: 'candidate' },
      },
    )
    const missingMixturePairID = evaluationRunID(953)
    const missingMixtureBaseline = evaluationRun(
      evaluationRunID(954),
      'Missing Mixture baseline',
      'completed',
      '2026-08-29T14:00:00Z',
      'recipe',
      {
        mode: 'live',
        target_id: EVALUATION_BASELINE_MOM_TARGET_ID,
        mixture: undefined,
        controlled_pair: { pair_id: missingMixturePairID, role: 'baseline' },
      },
    )
    const missingMixtureCandidate = evaluationRun(
      evaluationRunID(955),
      'Missing Mixture candidate',
      'completed',
      '2026-08-29T14:01:00Z',
      'recipe',
      {
        ...missingMixtureBaseline,
        id: evaluationRunID(955),
        client_request_id: evaluationRunID(955),
        name: 'Missing Mixture candidate',
        target_id: EVALUATION_MOM_TARGET_ID,
        baseline_run_id: missingMixtureBaseline.id,
        controlled_pair: { pair_id: missingMixturePairID, role: 'candidate' },
      },
    )
    await mockEvaluationPlane(page, [
      reorderedCandidate,
      orderedBaseline,
      missingMixtureCandidate,
      missingMixtureBaseline,
    ])
    await page.goto('/evaluation?view=compare')

    await expect(page.getByLabel('Comparison candidate', { exact: true })).toHaveCount(0)
    for (const [baselineRunID, candidateRunID] of [
      [orderedBaseline.id, reorderedCandidate.id],
      [missingMixtureBaseline.id, missingMixtureCandidate.id],
    ]) {
      const status = await page.evaluate(
        async ({ baselineID, candidateID }) =>
          (
            await fetch(
              `/api/evaluation/v1/compare?baseline_run_id=${baselineID}&candidate_run_id=${candidateID}`,
            )
          ).status,
        { baselineID: baselineRunID, candidateID: candidateRunID },
      )
      expect(status).toBe(400)
    }
  })

  test('keeps diagnostic results distinct from release decisions', async ({ page }) => {
    await mockEvaluationPlane(page)
    await page.goto(`/evaluation?view=reports&report=${EVALUATION_RUN_IDS.candidate}`)

    await expect(
      page.getByText('Diagnostic run — no release recommendation', { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Diagnostic result only' })).toBeVisible()
    const rawServiceNote = page.getByText(
      'Treat these E0 observations as diagnostics, not a promotion claim.',
      { exact: true },
    )
    await expect(rawServiceNote).not.toBeVisible()
    const findingsSummary = page
      .locator('details > summary')
      .filter({ hasText: 'Next evaluation steps' })
    const findings = findingsSummary.locator('..')
    await findingsSummary.click()
    await expect(
      findings.getByText(
        'Use this diagnostic result to verify the evaluation setup; collect controlled or live results before making a release decision.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(rawServiceNote).not.toBeVisible()
    const technicalFindingsSummary = findings
      .locator(':scope > div > details > summary')
      .filter({ hasText: 'Technical details' })
    await technicalFindingsSummary.click()
    await expect(rawServiceNote).toBeVisible()

    const metrics = page.getByRole('table', { name: 'Evaluation metrics' })
    await expect(metrics.locator('tr[data-metric-id="joint.realized_quality"]')).toContainText(
      'System quality',
    )
    await expect(metrics.locator('tr[data-metric-id="capacity.latency_p95_ms"]')).toContainText(
      'P95 latency',
    )

    const diagnostics = page.locator('section[aria-labelledby="report-diagnostics-title"]')
    await expect(diagnostics.getByRole('heading', { name: 'Execution diagnostics' })).toBeVisible()
    await expect(diagnostics.getByText('Total records').locator('..')).toContainText('32')
    await expect(
      diagnostics.getByText('Succeeded', { exact: true }).first().locator('..'),
    ).toContainText('32')
    await page.getByRole('heading', { name: 'Diagnostic result only' }).scrollIntoViewIfNeeded()
    await captureEvaluationSurface(page, 'report-decision-desktop')

    const allGatesSummary = page.locator('details > summary').filter({
      has: page.getByText('All release checks', { exact: false }),
    })
    const allGates = allGatesSummary.locator('..')
    await allGatesSummary.click()
    await expect(allGates.getByText('Passed', { exact: true })).toHaveCount(2)
    for (const capability of [
      'Policy enforcement',
      'Controlled value comparison',
      'Shift robustness',
      'Live fidelity',
      'Fault recovery',
      'Cost, latency, and capacity',
      'Canary safety',
      'Online preference',
    ]) {
      const gate = allGates.locator('article').filter({
        has: page.getByText(capability, { exact: true }),
      })
      await expect(gate).toHaveCount(1)
      await expect(gate.getByText('Passed', { exact: true })).toHaveCount(0)
    }
    await captureEvaluationSurface(page, 'report-gates-desktop')
  })

  test('renders the live server-owned Routing Recipe report across desktop and compact mobile', async ({
    page,
  }) => {
    const liveReportRun = evaluationRun(
      evaluationRunID(91),
      'Live routing recipe evidence',
      'completed',
      '2026-08-31T01:00:00Z',
      'recipe',
      {
        mode: 'live',
        target_id: EVALUATION_MOM_TARGET_ID,
        mixture: EVALUATION_MOM,
        suite_ids: ['live-mom-core'],
        track_ids: ['routing'],
        evidence_level: 'E3',
        track_evidence_levels: { routing: 'E3' },
        completed_at: '2026-08-31T01:10:00Z',
      },
    )
    await mockEvaluationPlane(page, [liveReportRun, ...defaultEvaluationRuns])
    for (const viewport of [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'mobile-compact', width: 320, height: 568 },
    ] as const) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`/evaluation?view=reports&report=${liveReportRun.id}`)

      const routingRecipe = page.locator('section[aria-labelledby="routing-recipe-report-title"]')
      await expect(routingRecipe.getByRole('heading', { name: 'Routing Recipe' })).toBeVisible()
      await expect(routingRecipe.getByText('Decision coverage', { exact: true })).toBeVisible()
      await expect(routingRecipe.getByText('Eligibility complete', { exact: true })).toBeVisible()
      await expect(routingRecipe.getByText('Selected feasible', { exact: true })).toBeVisible()
      await expect(routingRecipe.getByRole('table', { name: 'Signal availability' })).toBeVisible()
      await expect(
        routingRecipe.getByRole('table', { name: 'Projection outcome calibration' }),
      ).toBeVisible()
      await expect(
        routingRecipe.getByText('Quality gap to the best feasible model', { exact: true }),
      ).toBeVisible()
      const technicalDetails = routingRecipe.locator(
        'details[data-evaluation-technical-details="true"]',
      )
      await expect(technicalDetails).not.toHaveAttribute('open', '')
      await expect(
        routingRecipe.getByText('insufficient_latency_samples', { exact: true }).first(),
      ).toBeHidden()
      await technicalDetails.getByText('Technical details', { exact: true }).click()
      await expect(
        routingRecipe.getByText('insufficient_latency_samples', { exact: true }).first(),
      ).toBeVisible()
      await expect(
        routingRecipe.getByText('insufficient_outcome_pairs', { exact: true }),
      ).toBeVisible()
      await expect(routingRecipe.getByText('oracle_outcome_missing', { exact: true })).toHaveCount(
        2,
      )
      await technicalDetails.getByText('Technical details', { exact: true }).click()
      const decision = page.locator('section[aria-labelledby="report-decision-title"]')
      await expect(decision).toBeVisible()
      await expect
        .poll(async () => {
          const decisionBox = await decision.boundingBox()
          const routingBox = await routingRecipe.boundingBox()
          return Boolean(decisionBox && routingBox && decisionBox.y < routingBox.y)
        })
        .toBe(true)
      if (viewport.width === 320) {
        await expectKeyboardScrollable(
          routingRecipe.getByRole('region', { name: 'Signal availability' }),
          'horizontal',
        )
        await expectKeyboardScrollable(
          routingRecipe.getByRole('region', { name: 'Projection outcome calibration' }),
          'horizontal',
        )
      }
      await expectNoHorizontalOverflow(page)
      await expectEvaluationControlSystem(page)
      await expectScrollRegionsKeyboardReachable(page)
      await captureEvaluationElement(routingRecipe, `routing-recipe-deep-dive-${viewport.name}`)
      await expectPageBottomReachable(page)
      await expectEvaluationBottomGutter(page)
      await captureEvaluationSurface(page, `routing-recipe-report-${viewport.name}`)
      await captureEvaluationFullPage(page, `routing-recipe-report-${viewport.name}-full`)
    }
  })

  test('keeps a long execution timeline named, focusable, and keyboard scrollable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockEvaluationPlane(page, defaultEvaluationRuns, { eventStreamEventCount: 24 })
    await page.goto(`/evaluation?view=runs&run=${EVALUATION_RUN_IDS.live}`)

    const timeline = page.getByRole('region', { name: 'Execution timeline' })
    await expect(timeline).toBeVisible()
    await expect(timeline.locator('li')).toHaveCount(24)
    await expectKeyboardScrollable(timeline, 'vertical')
    await captureEvaluationElement(timeline, 'runs-long-timeline-keyboard-region')
  })

  test('pages dense metric reports and resets the page when filters change', async ({ page }) => {
    await mockEvaluationPlane(page, defaultEvaluationRuns, { reportMetricCount: 45 })
    await page.goto(`/evaluation?view=reports&report=${EVALUATION_RUN_IDS.candidate}`)

    const metrics = page.getByRole('table', { name: 'Evaluation metrics' })
    await expect(metrics.getByRole('row')).toHaveCount(21)
    await expect(page.getByText('1–20 of 45', { exact: true })).toBeVisible()
    await expect(page.getByText('Page 1 of 3', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.getByText('Page 2 of 3', { exact: true })).toBeVisible()
    await expect(page.getByText('21–40 of 45', { exact: true })).toBeVisible()

    await page.getByLabel('Find a metric').fill('metric 45')
    await expect(page.getByText('1–1 of 1 matching · 45 total', { exact: true })).toBeVisible()
    await expect(page.getByText('Page 2 of 3', { exact: true })).toHaveCount(0)
    await expect(metrics.getByRole('row')).toHaveCount(2)
  })

  test('isolates an invalid capacity diagnostic artifact without collapsing the report', async ({
    page,
  }) => {
    await mockEvaluationPlane(page, defaultEvaluationRuns, {
      diagnosticArtifactBodies: {
        capacityProfile:
          '{"schema_version":"evaluation.v1","kind":"bounded-concurrency-sweep","levels":null,"slo":null}',
      },
    })
    await page.goto(`/evaluation?view=reports&report=${EVALUATION_RUN_IDS.candidate}`)

    await expect(
      page.getByText('Diagnostic run — no release recommendation', { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('table', { name: 'Evaluation metrics' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Results by evaluation area' })).toBeVisible()

    const diagnostics = page.locator('section[aria-labelledby="report-diagnostics-title"]')
    const capacityIssue = diagnostics.getByRole('alert', {
      name: 'Capacity profile diagnostic error',
    })
    await expect(
      capacityIssue.getByText('Diagnostic could not be verified', { exact: true }),
    ).toBeVisible()
    await expect(
      capacityIssue.getByText(
        'This diagnostic is excluded because its saved evidence could not be verified. Other verified results remain available.',
        { exact: true },
      ),
    ).toBeVisible()
    const artifactPath = capacityIssue.getByText('capacity-profile.json', { exact: true })
    const serviceResponse = capacityIssue.getByText(
      'capacity-profile.json did not match the required evaluation.v1 diagnostic schema.',
      { exact: true },
    )
    await expect(artifactPath).not.toBeVisible()
    await expect(serviceResponse).not.toBeVisible()
    await capacityIssue
      .locator('details[data-evaluation-technical-details="true"] > summary')
      .click()
    await expect(artifactPath).toBeVisible()
    await expect(serviceResponse).toBeVisible()
    await expect(
      diagnostics.getByRole('table', { name: 'Outcome accounting by evaluation area' }),
    ).toBeVisible()
    await expect(
      diagnostics.getByRole('table', { name: 'Capacity observations by concurrency' }),
    ).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Report unavailable' })).toHaveCount(0)
  })

  test('preserves comparison lineage and colors deltas according to metric direction', async ({
    page,
  }) => {
    const state = await mockEvaluationPlane(page)
    await page.goto(
      `/evaluation?view=compare&baseline=${EVALUATION_RUN_IDS.baseline}&candidate=${EVALUATION_RUN_IDS.candidate}`,
    )

    await expect(
      page.getByRole('heading', { name: 'Compare a candidate with its baseline' }),
    ).toBeVisible()
    const candidates = page.getByLabel('Comparison candidate', { exact: true })
    expect(await candidates.locator('option').allTextContents()).toEqual([
      'Choose a compatible candidate',
      'Candidate recipe',
    ])
    await expect(page.getByText('Production baseline', { exact: true })).toBeVisible()
    await captureEvaluationSurface(page, 'comparison-setup-desktop')

    await page.getByRole('button', { name: 'Compare results' }).click()
    await expect.poll(() => state.comparisonRequests.length).toBe(1)
    expect(state.comparisonRequests[0]).toEqual({
      baselineRunID: EVALUATION_RUN_IDS.baseline,
      candidateRunID: EVALUATION_RUN_IDS.candidate,
    })

    const table = page.getByRole('table', { name: 'Paired comparison metrics' })
    const quality = table.locator('tr[data-metric-id="joint.realized_quality"]')
    await expect(quality).toContainText('Higher is better')
    await expect(quality.locator('strong[class*="delta_positive"]')).toHaveText('+3.0%')
    const latency = table.locator('tr[data-metric-id="capacity.latency_p95_ms"]')
    await expect(latency).toContainText('Lower is better')
    await expect(latency.locator('strong[class*="delta_positive"]')).toHaveText('−28 ms')
    const statistics = page.getByRole('table', { name: 'Paired outcome comparison' })
    const normalizedRegret = statistics.locator('tr[data-statistic-id="joint.normalized_regret"]')
    await expect(normalizedRegret).toContainText('Normalized quality gap')
    await expect(normalizedRegret).toContainText('Not estimable')
    await expect(normalizedRegret).toContainText(
      'Needs at least 20 independent case units; observed 4.',
    )
    const comparisonGates = page.locator(
      'section[aria-labelledby="evaluation-comparison-gates-title"]',
    )
    await expect(comparisonGates).toBeVisible()
    const valueComparison = comparisonGates.locator('article').filter({
      has: page.getByText('Controlled value comparison', { exact: true }),
    })
    await expect(
      valueComparison.getByText(/Release blocked · complete the required evaluation data/),
    ).toBeVisible()
    await expect(valueComparison.getByText('Passed', { exact: true })).toHaveCount(0)
    await table.scrollIntoViewIfNeeded()
    await captureEvaluationSurface(page, 'comparison-results-desktop')
  })

  test('builds and reloads a verified release decision above diagnostic comparison', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const { baseline: baselineLive, candidate: candidateLive } = controlledPairSourceRuns()
    const hardPolicy = evaluationRun(
      EVALUATION_RUN_IDS.campaignG2,
      'Hard-policy qualification',
      'completed',
      '2026-08-29T03:00:00Z',
      'recipe',
      {
        mode: 'live',
        suite_ids: ['live-hard-policy'],
        track_ids: ['safety'],
        sample_limit: 64,
        target_id: EVALUATION_MOM_TARGET_ID,
        mixture: EVALUATION_MOM,
        evidence_level: 'E4',
        completed_at: '2026-08-29T03:10:00Z',
      },
    )
    const declaredShift = evaluationRun(
      EVALUATION_RUN_IDS.campaignG4,
      'Declared-shift qualification',
      'completed',
      '2026-08-29T04:00:00Z',
      'recipe',
      {
        mode: 'live',
        suite_ids: ['normalized-promotion-cohort'],
        track_ids: ['routing'],
        sample_limit: 64,
        target_id: EVALUATION_MOM_TARGET_ID,
        mixture: EVALUATION_MOM,
        evidence_level: 'E4',
        completed_at: '2026-08-29T04:10:00Z',
      },
    )
    const fidelityReference = evaluationRun(
      EVALUATION_RUN_IDS.campaignG5Reference,
      'Live fidelity reference',
      'completed',
      '2026-08-29T05:00:00Z',
      'recipe',
      {
        mode: 'live',
        suite_ids: ['normalized-promotion-cohort'],
        track_ids: ['joint'],
        sample_limit: 64,
        target_id: EVALUATION_MOM_TARGET_ID,
        mixture: EVALUATION_MOM,
        evidence_level: 'E4',
        completed_at: '2026-08-29T05:10:00Z',
      },
    )
    const fidelityLive = evaluationRun(
      EVALUATION_RUN_IDS.campaignG5Live,
      'Fresh live fidelity confirmation',
      'completed',
      '2026-08-29T06:00:00Z',
      'recipe',
      {
        mode: 'live',
        suite_ids: ['normalized-promotion-cohort'],
        track_ids: ['joint'],
        sample_limit: 64,
        target_id: EVALUATION_MOM_TARGET_ID,
        mixture: EVALUATION_MOM,
        evidence_level: 'E5',
        completed_at: '2026-08-29T06:10:00Z',
      },
    )
    const capacity = evaluationRun(
      EVALUATION_RUN_IDS.campaignG7,
      'Capacity envelope qualification',
      'completed',
      '2026-08-29T07:00:00Z',
      'recipe',
      {
        mode: 'live',
        suite_ids: ['live-capacity'],
        track_ids: ['capacity'],
        sample_limit: 64,
        target_id: EVALUATION_MOM_TARGET_ID,
        mixture: EVALUATION_MOM,
        evidence_level: 'E5',
        completed_at: '2026-08-29T07:10:00Z',
      },
    )
    const capacityDuplicate = evaluationRun(
      evaluationRunID(20),
      'Capacity envelope qualification',
      'completed',
      '2026-08-29T07:20:00Z',
      'recipe',
      {
        ...capacity,
        id: evaluationRunID(20),
        client_request_id: evaluationRunID(20),
        created_at: '2026-08-29T07:20:00Z',
        completed_at: '2026-08-29T07:30:00Z',
      },
    )
    const state = await mockEvaluationPlane(
      page,
      [
        capacityDuplicate,
        capacity,
        fidelityLive,
        fidelityReference,
        declaredShift,
        hardPolicy,
        candidateLive,
        baselineLive,
        ...defaultEvaluationRuns,
      ],
      { campaignGetDelayMs: 250, failFirstControlledPair: true, ledgerDelayMs: 750 },
    )
    await page.goto('/evaluation?view=compare')

    await expect(
      page.getByRole('heading', { name: 'Compare a candidate with its baseline' }),
    ).toBeVisible()
    const releaseDecisionSummary = page.locator('details > summary').filter({
      has: page.getByText('Prepare a release decision', { exact: true }),
    })
    const releaseDecision = releaseDecisionSummary.locator('..')
    await expect(releaseDecision).not.toHaveAttribute('open', '')
    await expect(
      page.getByLabel('Controlled comparison baseline run', { exact: true }),
    ).not.toBeVisible()
    const evidenceDisclosure = await openReleaseDecisionInputs(page)
    await expect(
      page.getByLabel('Controlled comparison baseline run', { exact: true }),
    ).toBeVisible()
    await expectEvaluationControlSystem(page)
    await evidenceDisclosure.locator(':scope > summary').press('Enter')
    await expect(evidenceDisclosure).not.toHaveAttribute('open', '')
    await evidenceDisclosure.locator(':scope > summary').press('Enter')
    await expect(evidenceDisclosure).toHaveAttribute('open', '')
    await page
      .getByLabel('Controlled comparison baseline run', { exact: true })
      .selectOption(EVALUATION_RUN_IDS.baselineLive)
    await page
      .getByLabel('Controlled comparison candidate run', { exact: true })
      .selectOption(EVALUATION_RUN_IDS.candidateLive)
    await page.getByRole('button', { name: 'Launch comparison' }).click()
    await expect(page.getByRole('alert')).toContainText('two worker slots are required')
    await page.getByRole('button', { name: 'Retry comparison' }).click()
    await expect.poll(() => state.controlledPairRequests.length).toBe(2)
    const controlledPairRequest = state.controlledPairRequests[1]
    expect(Object.keys(controlledPairRequest).sort()).toEqual([
      'baseline_run_id',
      'baseline_source_run_id',
      'candidate_run_id',
      'candidate_source_run_id',
      'client_request_id',
    ])
    expect(controlledPairRequest).toMatchObject({
      baseline_source_run_id: EVALUATION_RUN_IDS.baselineLive,
      candidate_source_run_id: EVALUATION_RUN_IDS.candidateLive,
    })
    await expect
      .poll(() => new URL(page.url()).searchParams.get('controlled_pair'))
      .toBe(controlledPairRequest.client_request_id)
    await expect
      .poll(() => new URL(page.url()).searchParams.get('controlled_pair_profile'))
      .toBe('recipe')
    const profileSelect = page.getByLabel('Release decision change type')
    await expect(profileSelect).toBeDisabled()
    await expect(
      page.getByText(/change type is locked while this controlled comparison/i),
    ).toBeVisible()
    const aggregatePath = `/api/evaluation/v1/controlled-pairs/${controlledPairRequest.client_request_id}`
    await expect
      .poll(() => state.controlledPairGetRequests.filter((path) => path === aggregatePath).length)
      .toBeGreaterThanOrEqual(1)
    await expect(
      page.getByText(
        'Fresh baseline and candidate runs completed and are attached to the value comparison.',
      ),
    ).toHaveCount(0)
    expect(state.runRequests).not.toContain(controlledPairRequest.baseline_run_id)
    expect(state.runRequests).not.toContain(controlledPairRequest.candidate_run_id)
    await expect
      .poll(() =>
        state
          .getRuns()
          .filter((run) => run.controlled_pair?.pair_id === controlledPairRequest.client_request_id)
          .map((run) => run.status),
      )
      .toEqual(['completed', 'completed'])
    expect(() => state.getRuns().forEach((run) => decodeEvaluationRun(run))).not.toThrow()
    await expect(profileSelect).toBeDisabled()
    await expect(
      page.getByText(
        'Fresh baseline and candidate runs completed and are attached to the value comparison.',
      ),
    ).toBeVisible()
    await expect
      .poll(() => state.controlledPairGetRequests.filter((path) => path === aggregatePath).length)
      .toBeGreaterThanOrEqual(2)
    expect(state.runRequests).not.toContain(controlledPairRequest.baseline_run_id)
    expect(state.runRequests).not.toContain(controlledPairRequest.candidate_run_id)
    await expect.poll(() => new URL(page.url()).searchParams.get('controlled_pair')).toBeNull()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('controlled_pair_profile'))
      .toBeNull()
    const controlledComparison = page.getByLabel('Controlled comparison runs')
    await expect(controlledComparison).toContainText('Controlled baseline AB/BA')
    await expect(controlledComparison).toContainText('Controlled candidate AB/BA')
    const comparisonCandidate = page.getByLabel('Comparison candidate', { exact: true })
    await comparisonCandidate.selectOption(controlledPairRequest.candidate_run_id)
    const comparePanel = page
      .getByRole('heading', { name: 'Compare a candidate with its baseline' })
      .locator('xpath=ancestor::section[1]')
    await expect(comparePanel.getByText(/Controlled baseline AB\/BA/)).toBeVisible()
    await page.getByRole('button', { name: 'Compare results' }).click()
    await expect
      .poll(() => state.comparisonRequests.at(-1))
      .toEqual({
        baselineRunID: controlledPairRequest.baseline_run_id,
        candidateRunID: controlledPairRequest.candidate_run_id,
      })
    await expect(
      page.getByRole('heading', { name: 'Paired scientific statistics', exact: true }),
    ).toBeVisible()
    const controlledPairStatistics = page.getByRole('table', {
      name: 'Paired outcome comparison',
    })
    await expect(controlledPairStatistics).toBeVisible()
    await expect(
      controlledPairStatistics.locator('tr[data-statistic-id="joint.normalized_regret"]'),
    ).toContainText('Not estimable')
    await page.getByLabel('Hard policy run').selectOption(EVALUATION_RUN_IDS.campaignG2)
    await page
      .getByLabel('Declared-shift robustness run')
      .selectOption(EVALUATION_RUN_IDS.campaignG4)
    await page.getByLabel('Reference run').selectOption(EVALUATION_RUN_IDS.campaignG5Reference)
    await page
      .getByLabel('Candidate run', { exact: true })
      .selectOption(EVALUATION_RUN_IDS.campaignG5Live)
    const g7Evidence = page.getByLabel('Cost / latency / capacity run')
    const g7OptionLabels = await g7Evidence.locator('option').allTextContents()
    expect(new Set(g7OptionLabels).size).toBe(g7OptionLabels.length)
    expect(g7OptionLabels.join('\n')).toContain('Option 1')
    expect(g7OptionLabels.join('\n')).toContain('Option 2')
    await g7Evidence.selectOption(EVALUATION_RUN_IDS.campaignG7)
    await page.getByLabel('Decision name').fill('Recipe v4 production review')
    await page
      .locator('details > summary')
      .filter({ has: page.getByText('Decision notes', { exact: true }) })
      .click()
    await page
      .getByLabel('Decision notes')
      .fill('Review the exact treatment after paired target and confirmation evidence.')
    await expectEvaluationControlSystem(page)
    await captureEvaluationSurface(page, 'campaign-builder-desktop')
    await page.getByRole('button', { name: 'Create release decision' }).click()

    await expect.poll(() => state.campaignRequests.length).toBe(1)
    const request = state.campaignRequests[0]
    expect(request).toMatchObject({
      name: 'Recipe v4 production review',
      change_profile: 'recipe',
      gate_bindings: {
        g2_run_id: EVALUATION_RUN_IDS.campaignG2,
        g3_controlled_pair: {
          baseline_run_id: controlledPairRequest.baseline_run_id,
          candidate_run_id: controlledPairRequest.candidate_run_id,
        },
        g4_run_id: EVALUATION_RUN_IDS.campaignG4,
        g5_fidelity: {
          reference_run_id: EVALUATION_RUN_IDS.campaignG5Reference,
          live_run_id: EVALUATION_RUN_IDS.campaignG5Live,
        },
        g7_run_id: EVALUATION_RUN_IDS.campaignG7,
      },
    })
    await expect
      .poll(() => new URL(page.url()).searchParams.get('campaign'))
      .toBe(request.client_request_id)
    await expect(page.getByRole('heading', { name: 'Recipe v4 production review' })).toBeVisible()
    await expect(page.getByText('Verified release decision', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Release decision summary')).toBeVisible()
    await expectEvaluationControlSystem(page)
    await captureEvaluationSurface(page, 'campaign-decision-desktop')
    const technicalDetails = page
      .locator('details[data-evaluation-technical-details="true"]')
      .filter({
        has: page.getByText('Reproducibility, run identities, and verification receipts', {
          exact: true,
        }),
      })
    await expect(technicalDetails).not.toHaveAttribute('open', '')
    await expect(
      technicalDetails.getByText('1,000 samples · 95% confidence', { exact: true }),
    ).not.toBeVisible()
    const pairedLive = page.locator('section[aria-labelledby="campaign-paired-live-title"]')
    const pairedTableRegion = pairedLive.getByRole('region', {
      name: 'Paired live statistic matrix',
    })
    const pairedTable = pairedLive.getByRole('table', {
      name: 'Paired baseline and candidate statistics',
    })
    await expect(pairedTable.getByRole('row')).toHaveCount(11)
    await expect(
      pairedTable.getByRole('row', { name: /routing Candidate quality protection/i }),
    ).toContainText('+0.01')
    await expect(pairedTable.getByRole('row', { name: /routing Failure risk/i })).toContainText(
      'Passed',
    )
    await expect(
      pairedTable.getByRole('row', { name: /model pool All-model failure risk/i }),
    ).toContainText('Passed')
    const releaseMeasures = pairedLive.getByRole('table', { name: 'Release measures' })
    await expect(releaseMeasures.getByRole('row')).toHaveCount(6)
    await expect(releaseMeasures.getByRole('row', { name: /Pool availability/i })).toContainText(
      '≤ 20.0%',
    )
    const fidelity = page.locator('section[aria-labelledby="campaign-fidelity-title"]')
    await expect(fidelity.getByRole('heading', { name: 'Live consistency' })).toBeVisible()
    await expect(fidelity.getByText('59', { exact: true }).first()).toBeVisible()
    await expect(fidelity.getByText('Passed', { exact: true })).toBeVisible()
    await pairedTableRegion.focus()
    await expect(pairedTableRegion).toBeFocused()
    await expectCompactVerticalFlow(pairedLive)
    await expectNoHorizontalOverflow(page)
    await captureEvaluationElement(pairedLive, 'campaign-paired-live-desktop')
    await captureEvaluationFullPage(page, 'campaign-decision-desktop-full')
    await expectPageBottomReachable(page)
    await captureEvaluationSurface(page, 'campaign-decision-desktop-bottom')
    await page.evaluate(() => {
      const root = document.scrollingElement
      if (root) root.scrollTop = 0
    })
    const gates = page.locator('section[aria-labelledby="campaign-gates-title"]')
    await expect(gates.locator('article')).toHaveCount(10)
    await expect(
      gates
        .getByText('Verified evaluation result · End-to-end validation', { exact: true })
        .first(),
    ).toBeVisible()
    await expectProductEvaluationLanguage(page)
    await technicalDetails.locator(':scope > summary').click()
    await expect(
      technicalDetails.getByText('1,000 samples · 95% confidence', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Evaluation receipt', { exact: true })).toBeVisible()
    await expect(page.getByText('Decision receipt', { exact: true })).toBeVisible()
    const anchors = page.locator('section[aria-labelledby="campaign-evidence-title"]')
    await expect(anchors.locator('article')).toHaveCount(7)
    await expect(anchors.getByText('Server execution receipt', { exact: true })).toHaveCount(7)
    const copyExecution = anchors
      .getByRole('button', { name: 'Copy server execution receipt' })
      .first()
    await copyExecution.click()
    await expect(
      anchors.getByRole('button', { name: 'Copied server execution receipt' }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Compare a candidate with its baseline' }),
    ).toBeVisible()

    await expect
      .poll(
        () =>
          state.campaignGetRequests.filter((campaignID) => campaignID === request.client_request_id)
            .length,
      )
      .toBeGreaterThan(0)
    await page.waitForTimeout(300)
    state.rejectCampaignGets()
    await page.reload()
    await expect(page.getByRole('alert')).toBeVisible()
    const retryDecision = page.getByRole('button', { name: 'Retry decision' })
    state.allowCampaignGets()
    await retryDecision.click()
    await expect(page.getByRole('button', { name: 'Retrying decision…' })).toBeDisabled()
    await expect(page.getByRole('heading', { name: 'Recipe v4 production review' })).toBeVisible()
    expect(state.campaignGetRequests).toContain(request.client_request_id)

    await page.setViewportSize({ width: 1024, height: 768 })
    await page.evaluate(() => {
      const root = document.scrollingElement
      if (root) root.scrollTop = 0
    })
    await expectNoHorizontalOverflow(page)
    await expectCompactVerticalFlow(pairedLive)
    await captureEvaluationSurface(page, 'campaign-decision-tablet')
    await captureEvaluationElement(pairedLive, 'campaign-paired-live-tablet')
    await expectPageBottomReachable(page)
    await captureEvaluationSurface(page, 'campaign-decision-tablet-bottom')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => {
      const root = document.scrollingElement
      if (root) root.scrollTop = 0
    })
    await expect(page.getByRole('button', { name: 'Start another decision' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await expectCompactVerticalFlow(pairedLive)
    await captureEvaluationSurface(page, 'campaign-decision-mobile')
    await expectKeyboardScrollable(pairedTableRegion, 'horizontal')
    await captureEvaluationElement(pairedLive, 'campaign-paired-live-mobile')
    await expectPageBottomReachable(page)
    await captureEvaluationSurface(page, 'campaign-decision-mobile-bottom')
    await page.evaluate(() => {
      const root = document.scrollingElement
      if (root) root.scrollTop = 0
    })

    await page.getByRole('button', { name: 'Start another decision' }).click()
    await expect(page.getByText('Release readiness', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Decision name')).toHaveValue('')
    await expect.poll(() => new URL(page.url()).searchParams.get('campaign')).toBeNull()
    await expectNoHorizontalOverflow(page)
  })

  test('recovers a server-accepted controlled pair after the create response and page are lost', async ({
    page,
  }) => {
    const { baseline, candidate } = controlledPairSourceRuns()
    const state = await mockEvaluationPlane(page, [candidate, baseline, ...defaultEvaluationRuns], {
      abortControlledPairCreateResponseAfterAccept: true,
      ledgerDelayMs: 300,
    })
    await page.goto('/evaluation?view=compare')
    await launchCampaignControlledPair(page)

    await expect.poll(() => state.controlledPairRequests.length).toBe(1)
    const request = state.controlledPairRequests[0]
    await expect
      .poll(() => new URL(page.url()).searchParams.get('controlled_pair'))
      .toBe(request.client_request_id)
    await expect
      .poll(() => new URL(page.url()).searchParams.get('controlled_pair_profile'))
      .toBe('recipe')
    await page.reload()

    await openReleaseDecisionInputs(page)
    await expect(
      page.getByText(
        'Fresh baseline and candidate runs completed and are attached to the value comparison.',
      ),
    ).toBeVisible()
    const aggregatePath = `/api/evaluation/v1/controlled-pairs/${request.client_request_id}`
    await expect
      .poll(() => state.controlledPairGetRequests.filter((path) => path === aggregatePath).length)
      .toBeGreaterThanOrEqual(2)
    expect(state.runRequests).not.toContain(request.baseline_run_id)
    expect(state.runRequests).not.toContain(request.candidate_run_id)
    await expect.poll(() => new URL(page.url()).searchParams.get('controlled_pair')).toBeNull()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('controlled_pair_profile'))
      .toBeNull()
  })

  test('preserves an active controlled pair while navigating away from Compare and back', async ({
    page,
  }) => {
    const { baseline, candidate } = controlledPairSourceRuns()
    const state = await mockEvaluationPlane(page, [candidate, baseline, ...defaultEvaluationRuns])
    await page.goto('/evaluation?view=compare')
    await launchCampaignControlledPair(page)

    await expect.poll(() => state.controlledPairRequests.length).toBe(1)
    const request = state.controlledPairRequests[0]
    await expect
      .poll(() => new URL(page.url()).searchParams.get('controlled_pair'))
      .toBe(request.client_request_id)
    await page.getByRole('tab', { name: 'Runs', exact: true }).click()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('controlled_pair'))
      .toBe(request.client_request_id)
    await page.getByRole('tab', { name: 'Compare', exact: true }).click()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('controlled_pair'))
      .toBe(request.client_request_id)

    await openReleaseDecisionInputs(page)
    await expect(
      page.getByText(
        'Fresh baseline and candidate runs completed and are attached to the value comparison.',
      ),
    ).toBeVisible()
    expect(state.runRequests).not.toContain(request.baseline_run_id)
    expect(state.runRequests).not.toContain(request.candidate_run_id)
    await expect.poll(() => new URL(page.url()).searchParams.get('controlled_pair')).toBeNull()
  })

  test('restores a non-default controlled-pair profile across reload and workspace navigation', async ({
    page,
  }) => {
    const { baseline, candidate } = controlledPairSourceRuns('model_pool')
    const state = await mockEvaluationPlane(page, [candidate, baseline, ...defaultEvaluationRuns], {
      controlledPairGetDelayMs: 2_000,
      ledgerDelayMs: 250,
    })
    await page.goto('/evaluation?view=compare')
    await openReleaseDecisionInputs(page)
    await page.getByLabel('Release decision change type').selectOption('model_pool')
    await launchCampaignControlledPair(page)

    await expect.poll(() => state.controlledPairRequests.length).toBe(1)
    const request = state.controlledPairRequests[0]
    await expect
      .poll(() => new URL(page.url()).searchParams.get('controlled_pair'))
      .toBe(request.client_request_id)
    await expect
      .poll(() => new URL(page.url()).searchParams.get('controlled_pair_profile'))
      .toBe('model_pool')

    await page.reload()
    await openReleaseDecisionInputs(page)
    const profile = page.getByLabel('Release decision change type')
    await expect(profile).toHaveValue('model_pool')
    await expect(profile).toBeDisabled()
    await page.getByRole('tab', { name: 'Runs', exact: true }).click()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('controlled_pair_profile'))
      .toBe('model_pool')
    await page.getByRole('tab', { name: 'Compare', exact: true }).click()
    await openReleaseDecisionInputs(page)
    await expect(profile).toHaveValue('model_pool')
    await expect(profile).toBeDisabled()

    await expect(
      page.getByText(
        'Fresh baseline and candidate runs completed and are attached to the value comparison.',
      ),
    ).toBeVisible()
    await expect(page.getByLabel('Controlled comparison runs')).toContainText(
      /Controlled baseline AB\/BA.*Controlled candidate AB\/BA/,
    )
    await expect.poll(() => new URL(page.url()).searchParams.get('controlled_pair')).toBeNull()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('controlled_pair_profile'))
      .toBeNull()
  })

  test('restarts authoritative reconciliation after recovered pair polling fails', async ({
    page,
  }) => {
    const pairID = evaluationRunID(940)
    const baselineID = evaluationRunID(941)
    const candidateID = evaluationRunID(942)
    const createdAt = '2026-08-31T03:00:00Z'
    const baseline = evaluationRun(
      baselineID,
      'Recovered pair baseline',
      'running',
      createdAt,
      'model_pool',
      { controlled_pair: { pair_id: pairID, role: 'baseline' } },
    )
    const candidate = evaluationRun(
      candidateID,
      'Recovered pair candidate',
      'running',
      createdAt,
      'model_pool',
      {
        baseline_run_id: baselineID,
        controlled_pair: { pair_id: pairID, role: 'candidate' },
      },
    )
    const state = await mockEvaluationPlane(page, [candidate, baseline, ...defaultEvaluationRuns], {
      controlledPairGetDelayMs: 300,
      failControlledPairGetAt: 2,
    })
    await page.goto(
      `/evaluation?view=compare&controlled_pair=${pairID}&controlled_pair_profile=model_pool`,
    )

    await openReleaseDecisionInputs(page)
    const profile = page.getByLabel('Release decision change type')
    await expect(profile).toHaveValue('model_pool')
    await expect(profile).toBeDisabled()
    await expect(page.getByRole('alert')).toContainText('temporary controlled-pair state failure')
    await expect(profile).toBeDisabled()
    await expect.poll(() => state.controlledPairGetRequests.length).toBeGreaterThanOrEqual(2)

    await page.getByRole('button', { name: 'Retry comparison' }).click()
    await expect.poll(() => state.controlledPairGetRequests.length).toBeGreaterThanOrEqual(3)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Comparison running…' })).toBeDisabled()
    await expect(profile).toBeDisabled()
  })

  test('rejects stale assignment when the profile changes during asynchronous handoff', async ({
    page,
  }) => {
    const { baseline, candidate } = controlledPairSourceRuns()
    await mockEvaluationPlane(page, [candidate, baseline, ...defaultEvaluationRuns], {
      ledgerDelayMs: 1_000,
    })
    await page.goto('/evaluation?view=compare')
    await launchCampaignControlledPair(page)

    const profile = page.getByLabel('Release decision change type')
    await expect(
      page.getByText(
        'Both runs completed. Refreshing run history before attaching the comparison.',
      ),
    ).toBeVisible()
    await expect(profile).toBeDisabled()
    await profile.evaluate((element) => {
      const select = element as HTMLSelectElement
      select.removeAttribute('disabled')
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      setter?.call(select, 'model_pool')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await expect(profile).toHaveValue('recipe')
    await expect(page.getByLabel('Controlled comparison runs')).toContainText(
      /Controlled baseline AB\/BA.*Controlled candidate AB\/BA/,
    )
    await expect.poll(() => new URL(page.url()).searchParams.get('controlled_pair')).toBeNull()
  })

  test('fails closed for invalid or stale controlled-pair route identities', async ({ page }) => {
    const state = await mockEvaluationPlane(page)
    await page.goto(
      '/evaluation?view=compare&controlled_pair=not-a-canonical-id&controlled_pair_profile=recipe',
    )
    await expect(
      page.getByRole('heading', { name: 'Compare a candidate with its baseline' }),
    ).toBeVisible()
    expect(state.controlledPairGetRequests).toHaveLength(0)

    const stalePairID = evaluationRunID(990)
    await page.goto(
      `/evaluation?view=compare&controlled_pair=${stalePairID}&controlled_pair_profile=recipe`,
    )
    await openReleaseDecisionInputs(page)
    await expect(page.getByRole('alert')).toContainText('not found: controlled pair')
    await expect(page.getByLabel('Controlled comparison runs')).not.toContainText(stalePairID)
    await page.getByRole('button', { name: 'Clear saved comparison' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('controlled_pair')).toBeNull()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('controlled_pair_profile'))
      .toBeNull()
  })

  test('keeps quarantined run evidence visible and blocks partial-ledger decisions', async ({
    page,
  }) => {
    const state = await mockEvaluationPlane(page, defaultEvaluationRuns, {
      ledgerWarningCount: 3,
      ledgerWarnings: [
        {
          code: 'corrupt_run_bundle',
          evidence_id: 'bundle-entry-7f9d2a',
          evidence_file: 'status.json',
          message: 'Durable run status evidence is unreadable or invalid and has been quarantined.',
        },
      ],
    })
    await page.goto(
      `/evaluation?view=compare&baseline=${EVALUATION_RUN_IDS.baseline}&candidate=${EVALUATION_RUN_IDS.candidate}`,
    )

    await expect(page.getByText('Some saved runs could not be read', { exact: true })).toBeVisible()
    await expect(page.getByText(/3 saved runs are excluded/)).toBeVisible()
    await expect(
      page.getByText('Showing 1 of 3 warning details returned by run history.', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('bundle-entry-7f9d2a', { exact: true })).not.toBeVisible()
    const warningSummary = page.locator('details > summary').filter({
      has: page.getByText('Technical details · 1', { exact: true }),
    })
    await warningSummary.click()
    await expect(page.getByText('bundle-entry-7f9d2a', { exact: true })).toBeVisible()
    await expect(page.getByText(/status\.json: Durable run status evidence/)).toBeVisible()
    await expect(page.getByLabel('Comparison candidate', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Compare results' })).toHaveCount(0)
    await expect(page.getByText(/Baseline selection and comparison are paused/)).toBeVisible()
    expect(state.comparisonRequests).toHaveLength(0)

    await page.getByRole('tab', { name: 'New experiment', exact: true }).click()
    await expect(page.getByText('Some saved runs could not be read', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Baseline run')).toBeDisabled()
    await expect(
      page.getByText('Baseline selection is paused until unreadable saved runs are repaired.', {
        exact: true,
      }),
    ).toBeVisible()
  })

  test('keeps cancellation modal and controls pending until the server responds', async ({
    page,
  }) => {
    const state = await mockEvaluationPlane(page, defaultEvaluationRuns, {
      mutationDelayMs: 400,
      failFirstCancel: true,
    })
    await page.goto(`/evaluation?view=runs&run=${EVALUATION_RUN_IDS.live}`)

    const cancelTrigger = page.getByRole('button', { name: 'Cancel Live AMD validation' })
    await cancelTrigger.click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Execution stops and no completed report is created.')
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Cancel run' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(cancelTrigger).toBeFocused()

    await cancelTrigger.click()
    await expectDialogBottomReachable(page, dialog)
    await captureEvaluationSurface(page, 'cancel-dialog')
    await dialog.getByRole('button', { name: 'Cancel run' }).click()
    const dialogError = dialog.getByRole('alert')
    await expect(dialogError).toContainText('temporary cancellation failure')
    await expect(page.locator('[role="alert"]')).toHaveCount(1)
    await expect(dialog.getByRole('button', { name: 'Cancel run' })).toBeEnabled()

    await dialog.getByRole('button', { name: 'Cancel run' }).click()
    await expect(dialog).toHaveAttribute('aria-busy', 'true')
    await expect(dialog.getByRole('button', { name: 'Cancelling…' })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
    await expect(cancelTrigger).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()

    await expect.poll(state.getCancelCount).toBe(1)
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('tabpanel')).toBeFocused()
    const inspector = page.locator('aside').filter({
      has: page.getByRole('heading', { name: 'Live AMD validation' }),
    })
    await expect(inspector.getByText('Cancelled', { exact: true })).toBeVisible()
  })

  test('does not let a delayed detail read roll back a started run', async ({ page }) => {
    const pending = evaluationRun(
      evaluationRunID(920),
      'Delayed start fixture',
      'pending',
      '2026-08-31T02:00:00Z',
    )
    const state = await mockEvaluationPlane(page, [pending, ...defaultEvaluationRuns], {
      runDelayMs: 800,
      mutationDelayMs: 100,
    })
    await page.goto(`/evaluation?view=runs&run=${pending.id}`)

    await page.getByRole('button', { name: 'Refresh evaluation runs' }).click()
    await expect
      .poll(() => state.runRequests.filter((id) => id === pending.id).length)
      .toBeGreaterThanOrEqual(1)
    await page.getByRole('button', { name: `Start ${pending.name}` }).click()
    await expect.poll(state.getStartCount).toBe(1)
    const cancel = page.getByRole('button', { name: `Cancel ${pending.name}` })
    await expect(cancel).toBeVisible()

    await page.waitForTimeout(900)
    await expect(cancel).toBeVisible()
    await expect(page.getByRole('button', { name: `Start ${pending.name}` })).toHaveCount(0)
  })

  test('does not let a delayed detail read roll back a cancelled run', async ({ page }) => {
    const running = evaluationRun(
      evaluationRunID(921),
      'Delayed cancel fixture',
      'running',
      '2026-08-31T02:10:00Z',
    )
    const state = await mockEvaluationPlane(page, [running, ...defaultEvaluationRuns], {
      runDelayMs: 800,
      mutationDelayMs: 100,
    })
    await page.goto(`/evaluation?view=runs&run=${running.id}`)

    await page.getByRole('button', { name: 'Refresh evaluation runs' }).click()
    await expect
      .poll(() => state.runRequests.filter((id) => id === running.id).length)
      .toBeGreaterThanOrEqual(1)
    await page.getByRole('button', { name: `Cancel ${running.name}` }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel run' }).click()
    await expect.poll(state.getCancelCount).toBe(1)
    const deleteRun = page.getByRole('button', { name: `Delete ${running.name}` })
    await expect(deleteRun).toBeVisible()

    await page.waitForTimeout(900)
    await expect(deleteRun).toBeVisible()
    await expect(page.getByRole('button', { name: `Cancel ${running.name}` })).toHaveCount(0)
  })

  test('mutates controlled-pair members only through their aggregate lifecycle', async ({
    page,
  }) => {
    const pairID = evaluationRunID(900)
    const baselineID = evaluationRunID(901)
    const candidateID = evaluationRunID(902)
    const createdAt = '2026-08-31T01:00:00Z'
    const baseline = evaluationRun(
      baselineID,
      'Controlled pair control',
      'running',
      createdAt,
      'recipe',
      { controlled_pair: { pair_id: pairID, role: 'baseline' } },
    )
    const candidate = evaluationRun(
      candidateID,
      'Controlled pair treatment',
      'running',
      createdAt,
      'recipe',
      {
        baseline_run_id: baseline.id,
        controlled_pair: { pair_id: pairID, role: 'candidate' },
      },
    )
    const state = await mockEvaluationPlane(page, [candidate, baseline, ...defaultEvaluationRuns], {
      mutationDelayMs: 300,
      failFirstControlledPairCancel: true,
    })
    await page.goto(`/evaluation?view=runs&run=${candidate.id}`)

    const cancelPair = page.getByRole('button', { name: 'Cancel controlled comparison' })
    await expect(cancelPair).toHaveText('Cancel comparison')
    const defaultInspectorText = await page
      .getByRole('complementary', { name: 'Selected evaluation run' })
      .innerText()
    expect(defaultInspectorText).not.toContain(candidate.id)
    expect(defaultInspectorText).not.toContain(baseline.id)
    expect(defaultInspectorText).not.toContain(candidate.suite_ids[0])
    const technicalDetails = page
      .getByRole('complementary', { name: 'Selected evaluation run' })
      .locator('details')
      .filter({ has: page.getByText('Run ID', { exact: true }) })
    await technicalDetails.locator(':scope > summary').click()
    await expect(technicalDetails.getByText(candidate.id, { exact: true })).toBeVisible()
    await expect(technicalDetails.getByText(baseline.id, { exact: true })).toBeVisible()
    await expect(
      technicalDetails.getByText(candidate.suite_ids.join(', '), { exact: true }),
    ).toBeVisible()
    await technicalDetails.locator(':scope > summary').click()
    await expect(page.getByRole('button', { name: `Cancel ${candidate.name}` })).toHaveCount(0)
    await expect(page.getByRole('button', { name: `Delete ${candidate.name}` })).toHaveCount(0)

    await cancelPair.click()
    let dialog = page.getByRole('alertdialog')
    await expect(
      dialog.getByRole('heading', { name: 'Cancel controlled comparison?' }),
    ).toBeVisible()
    await expect(dialog).toContainText('Both runs stop together.')
    await expect(dialog).not.toContainText(pairID)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(state.controlledPairCancelRequests).toHaveLength(0)

    await cancelPair.click()
    dialog = page.getByRole('alertdialog')
    await dialog.getByRole('button', { name: 'Cancel comparison', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText(
      'temporary controlled-pair cancellation failure',
    )
    expect(state.controlledPairCancelRequests).toEqual([
      `/api/evaluation/v1/controlled-pairs/${pairID}/cancel`,
    ])

    await dialog.getByRole('button', { name: 'Cancel comparison', exact: true }).click()
    await expect(dialog).toHaveAttribute('aria-busy', 'true')
    await expect(dialog.getByRole('button', { name: 'Cancelling comparison…' })).toBeDisabled()
    await expect(dialog).toHaveCount(0)
    expect(state.getCancelCount()).toBe(0)
    await expect(
      page
        .getByRole('button', { name: `Open ${baseline.name} details` })
        .getByText('Cancelled', { exact: true }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('button', { name: `Open ${candidate.name} details` })
        .getByText('Cancelled', { exact: true }),
    ).toBeVisible()

    const deletePair = page.getByRole('button', { name: 'Delete controlled comparison' })
    await expect(deletePair).toHaveText('Delete comparison')
    await deletePair.click()
    dialog = page.getByRole('alertdialog')
    await expect(
      dialog.getByRole('heading', { name: 'Delete controlled comparison?' }),
    ).toBeVisible()
    await expect(dialog).toContainText(
      'This permanently removes both runs and their reports from Evaluation.',
    )
    await expect(dialog).not.toContainText(pairID)
    const confirmation = dialog.getByRole('textbox', {
      name: /Enter DELETE COMPARISON to confirm/,
    })
    await confirmation.fill('DELETE COMPARISON')
    const ledgerRequestsBeforeDelete = state.getLedgerRequestCount()
    await dialog.getByRole('button', { name: 'Delete comparison', exact: true }).click()
    await expect(dialog).toHaveAttribute('aria-busy', 'true')
    await expect(dialog.getByRole('button', { name: 'Deleting comparison…' })).toBeDisabled()
    await expect(dialog).toHaveCount(0)

    expect(state.controlledPairDeleteRequests).toEqual([
      `/api/evaluation/v1/controlled-pairs/${pairID}`,
    ])
    expect(state.getDeleteCount()).toBe(0)
    await expect(page.getByRole('button', { name: `Open ${baseline.name} details` })).toHaveCount(0)
    await expect(page.getByRole('button', { name: `Open ${candidate.name} details` })).toHaveCount(
      0,
    )
    await expect.poll(state.getLedgerRequestCount).toBeGreaterThan(ledgerRequestsBeforeDelete)
    await expect.poll(() => new URL(page.url()).searchParams.get('run')).toBeNull()
  })

  test('does not let a delayed member read roll back aggregate pair cancellation', async ({
    page,
  }) => {
    const pairID = evaluationRunID(922)
    const baselineID = evaluationRunID(923)
    const candidateID = evaluationRunID(924)
    const createdAt = '2026-08-31T02:20:00Z'
    const baseline = evaluationRun(
      baselineID,
      'Delayed pair baseline',
      'running',
      createdAt,
      'recipe',
      { controlled_pair: { pair_id: pairID, role: 'baseline' } },
    )
    const candidate = evaluationRun(
      candidateID,
      'Delayed pair candidate',
      'running',
      createdAt,
      'recipe',
      {
        baseline_run_id: baselineID,
        controlled_pair: { pair_id: pairID, role: 'candidate' },
      },
    )
    const state = await mockEvaluationPlane(page, [candidate, baseline, ...defaultEvaluationRuns], {
      runDelayMs: 800,
      mutationDelayMs: 100,
    })
    await page.goto(`/evaluation?view=runs&run=${candidate.id}`)
    const cancelPair = page.getByRole('button', { name: 'Cancel controlled comparison' })
    await expect(cancelPair).toBeVisible()

    await page.getByRole('button', { name: 'Refresh evaluation runs' }).click()
    await expect
      .poll(() => state.runRequests.filter((id) => id === candidate.id).length)
      .toBeGreaterThanOrEqual(1)
    await cancelPair.click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel comparison' }).click()
    await expect.poll(() => state.controlledPairCancelRequests.length).toBe(1)
    const deletePair = page.getByRole('button', { name: 'Delete controlled comparison' })
    await expect(deletePair).toBeVisible()

    await page.waitForTimeout(900)
    await expect(deletePair).toBeVisible()
    await expect(cancelPair).toHaveCount(0)
  })

  test('uses aggregate capabilities when the selected pair member is already terminal', async ({
    page,
  }) => {
    const pairID = evaluationRunID(910)
    const baselineID = evaluationRunID(911)
    const candidateID = evaluationRunID(912)
    const createdAt = '2026-08-31T01:20:00Z'
    const baseline = evaluationRun(
      baselineID,
      'Completed controlled baseline',
      'completed',
      createdAt,
      'recipe',
      {
        mode: 'live',
        controlled_pair: { pair_id: pairID, role: 'baseline' },
      },
    )
    const candidate = evaluationRun(
      candidateID,
      'Running controlled candidate',
      'running',
      createdAt,
      'recipe',
      {
        baseline_run_id: baseline.id,
        controlled_pair: { pair_id: pairID, role: 'candidate' },
      },
    )
    const state = await mockEvaluationPlane(page, [baseline, candidate, ...defaultEvaluationRuns], {
      controlledPairGetDelayMs: 2_000,
      failFirstControlledPairGet: true,
    })
    await page.goto(`/evaluation?view=runs&run=${baseline.id}`)

    await expect(
      page.getByRole('button', { name: `Open report for ${baseline.name}` }),
    ).toBeVisible()
    await expect(page.getByText('Loading comparison actions…')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel controlled comparison' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete controlled comparison' })).toHaveCount(0)

    const pairError = page.getByRole('alert').filter({
      has: page.getByText(
        'Comparison actions could not be loaded. Existing run evidence remains available.',
        { exact: true },
      ),
    })
    await expect(pairError).toBeVisible()
    const pairBackendFailure = pairError.getByText('temporary controlled-pair state failure', {
      exact: true,
    })
    await expect(pairBackendFailure).not.toBeVisible()
    await pairError.locator('details[data-evaluation-technical-details="true"] > summary').click()
    await expect(pairBackendFailure).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete controlled comparison' })).toHaveCount(0)
    await pairError.getByRole('button', { name: 'Retry comparison actions' }).click()

    const cancelPair = page.getByRole('button', { name: 'Cancel controlled comparison' })
    await expect(cancelPair).toHaveText('Cancel comparison')
    await expect(page.getByRole('button', { name: 'Delete controlled comparison' })).toHaveCount(0)
    await expect
      .poll(() => state.controlledPairGetRequests)
      .toEqual([
        `/api/evaluation/v1/controlled-pairs/${pairID}`,
        `/api/evaluation/v1/controlled-pairs/${pairID}`,
      ])

    await page.getByRole('button', { name: 'Refresh evaluation runs' }).click()
    await expect(page.getByText('Refreshing comparison actions…')).toBeVisible()
    await expect(cancelPair).toBeVisible()
    await expect(cancelPair).toBeDisabled()
    await expect(page.getByText('Loading evaluation run')).toHaveCount(0)
    await expect(cancelPair).toBeEnabled()
    await expect.poll(() => state.controlledPairGetRequests.length).toBeGreaterThanOrEqual(3)
  })

  test('requires typed delete confirmation and preserves pending dialog state', async ({
    page,
  }) => {
    const state = await mockEvaluationPlane(page, defaultEvaluationRuns, { mutationDelayMs: 400 })
    await page.goto(`/evaluation?view=runs&run=${EVALUATION_RUN_IDS.failed}`)

    await page.getByRole('button', { name: 'Delete Failed diagnostic' }).click()
    const dialog = page.getByRole('alertdialog')
    const confirmation = dialog.getByRole('textbox', {
      name: /Enter Failed diagnostic to confirm/,
    })
    const deleteButton = dialog.getByRole('button', { name: 'Delete run' })
    await expect(confirmation).toBeFocused()
    await captureEvaluationSurface(page, 'delete-dialog')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(dialog).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await expectDialogBottomReachable(page, dialog)
    await captureEvaluationSurface(page, 'delete-dialog-mobile')
    await expect(deleteButton).toBeDisabled()
    await confirmation.fill('Failed')
    await expect(deleteButton).toBeDisabled()
    await confirmation.fill('Failed diagnostic')
    await expect(deleteButton).toBeEnabled()
    await deleteButton.click()
    await expect(dialog).toHaveAttribute('aria-busy', 'true')
    await expect(dialog.getByRole('button', { name: 'Deleting…' })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Delete Failed diagnostic' })).toBeDisabled()

    await expect.poll(state.getDeleteCount).toBe(1)
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('tabpanel')).toBeFocused()
    await expect(page.getByRole('button', { name: 'Open Failed diagnostic details' })).toHaveCount(
      0,
    )
  })

  test('keeps one SSE subscription and one event across a run refresh', async ({ page }) => {
    const state = await mockEvaluationPlane(page, defaultEvaluationRuns, { runDelayMs: 750 })
    await page.goto(`/evaluation?view=runs&run=${EVALUATION_RUN_IDS.live}`)

    await expect.poll(state.getEventStreamCount).toBe(1)
    await expect(page.getByText('Executing routing track from SSE')).toHaveCount(1)
    await captureEvaluationSurface(page, 'runs-desktop')
    const detailRequestsBeforeRefresh = state.runRequests.filter(
      (id) => id === EVALUATION_RUN_IDS.live,
    ).length
    await page.getByRole('button', { name: 'Refresh evaluation runs' }).click()
    await expect
      .poll(() => state.runRequests.filter((id) => id === EVALUATION_RUN_IDS.live).length)
      .toBeGreaterThan(detailRequestsBeforeRefresh)
    await expect(page.getByRole('heading', { name: 'Live AMD validation' })).toBeVisible()
    await expect(page.getByText('Loading evaluation run', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Cancel Live AMD validation' })).toBeVisible()

    expect(state.getEventStreamCount()).toBe(1)
    await expect(page.getByText('Executing routing track from SSE')).toHaveCount(1)
    await expect(page.getByText('Refreshing details…', { exact: true })).toHaveCount(0)
  })

  test('requires an explicit retry after a server-closed event stream', async ({ page }) => {
    const state = await mockEvaluationPlane(page, defaultEvaluationRuns, {
      eventStreamCloseOnce: true,
    })
    await page.goto(`/evaluation?view=runs&run=${EVALUATION_RUN_IDS.live}`)

    await expect.poll(state.getEventStreamCount).toBe(1)
    await expect(page.getByText('Updates unavailable', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await expect.poll(state.getEventStreamCount).toBe(2)
    await expect(page.getByText('Executing routing track from SSE')).toHaveCount(1)
    await expect(
      page.getByText('Evaluation event stream was closed by the server.', { exact: true }),
    ).toHaveCount(0)
  })

  test('offers one clear next step when no comparable candidate exists', async ({ page }) => {
    const standaloneBaseline = evaluationRun(
      evaluationRunID(998),
      'Standalone production baseline',
      'completed',
      '2026-08-20T00:00:00Z',
    )
    await mockEvaluationPlane(page, [standaloneBaseline])
    await page.goto('/evaluation?view=compare')

    await expect(page.getByLabel('Comparison candidate', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Compare results' })).toHaveCount(0)
    const panel = page.getByRole('tabpanel')
    await expect(panel.locator('[data-evaluation-action="true"]:visible')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Create candidate run' })).toBeVisible()
    const releaseDecisionSummary = page.locator('details > summary').filter({
      has: page.getByText('Prepare a release decision', { exact: true }),
    })
    const releaseDecision = releaseDecisionSummary.locator('..')
    await expect(releaseDecision).not.toHaveAttribute('open', '')
    await expectProductEvaluationLanguage(page)
  })

  const responsiveViewports = [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'tablet-compact', width: 768, height: 1024 },
    { name: 'tablet', width: 1024, height: 768 },
    { name: 'desktop', width: 1440, height: 900 },
  ] as const

  for (const viewport of responsiveViewports) {
    for (const surface of responsiveEvaluationSurfaces) {
      test(`keeps ${surface.capture} coherent at ${viewport.name} width`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await mockEvaluationPlane(page)
        await expectResponsiveEvaluationSurface(page, surface, viewport.name)
      })
    }
  }
})
