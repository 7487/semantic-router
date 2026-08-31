import { describe, expect, it } from 'vitest'

import type { EvaluationCatalogTarget } from '../../types/evaluationPlane'
import { targetOptionLabels, targetPresentationLabel } from './evaluationTargetPresentation'

type TargetIdentity = Pick<EvaluationCatalogTarget, 'id' | 'name'>

function target(id: string, name: string): TargetIdentity {
  return { id, name }
}

describe('evaluation target presentation', () => {
  it('keeps server-authored target names as the primary human identity', () => {
    const baseline = target('baseline--mom-shared', 'Baseline · vllm-sr/auto')
    const candidate = target('candidate--mom-shared', 'Candidate · vllm-sr/auto')
    const labels = targetOptionLabels([baseline, candidate])

    expect(targetPresentationLabel(baseline)).toBe('Baseline · vllm-sr/auto')
    expect(labels.get(baseline.id)).toBe('Baseline · vllm-sr/auto')
    expect(labels.get(candidate.id)).toBe('Candidate · vllm-sr/auto')
  })

  it('adds only the shortest stable target ID prefix when display names collide', () => {
    const blue = target('candidate-blue--mom-shared', 'Candidate · vllm-sr/auto')
    const green = target('candidate-green--mom-shared', 'Candidate · vllm-sr/auto')
    const forward = targetOptionLabels([blue, green])
    const reversed = targetOptionLabels([green, blue])

    expect(forward.get(blue.id)).toBe('Candidate · vllm-sr/auto · #candidate-b')
    expect(forward.get(green.id)).toBe('Candidate · vllm-sr/auto · #candidate-g')
    expect(reversed.get(blue.id)).toBe(forward.get(blue.id))
    expect(reversed.get(green.id)).toBe(forward.get(green.id))
  })

  it('does not decorate a unique replay target', () => {
    const fixture = target('fixture', 'Built-in replay fixture')
    expect(targetOptionLabels([fixture]).get(fixture.id)).toBe('Built-in replay fixture')
  })
})
