import type { EvaluationCatalogTarget } from '../../types/evaluationPlane'

type TargetPresentationIdentity = Pick<EvaluationCatalogTarget, 'id' | 'name'>

export function targetPresentationLabel(target: TargetPresentationIdentity): string {
  return target.name
}

function shortestUniquePrefixWidth(targetIDs: string[]): number {
  const maximumWidth = Math.max(...targetIDs.map((targetID) => targetID.length))
  for (let width = 1; width <= maximumWidth; width += 1) {
    const prefixes = targetIDs.map((targetID) => targetID.slice(0, width))
    if (new Set(prefixes).size === targetIDs.length) return width
  }
  return maximumWidth
}

export function targetOptionLabels(
  targets: readonly TargetPresentationIdentity[],
): Map<string, string> {
  const distinctTargets = [...new Map(targets.map((target) => [target.id, target])).values()]
  const targetsByName = new Map<string, TargetPresentationIdentity[]>()
  for (const target of distinctTargets) {
    const label = targetPresentationLabel(target)
    targetsByName.set(label, [...(targetsByName.get(label) || []), target])
  }

  const labels = new Map<string, string>()
  for (const [label, sameNameTargets] of targetsByName) {
    if (sameNameTargets.length === 1) {
      labels.set(sameNameTargets[0].id, label)
      continue
    }
    const prefixWidth = shortestUniquePrefixWidth(sameNameTargets.map((target) => target.id))
    for (const target of sameNameTargets) {
      labels.set(target.id, `${label} · #${target.id.slice(0, prefixWidth)}`)
    }
  }
  return labels
}
