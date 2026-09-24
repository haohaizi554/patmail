import type { SemanticSource } from '../shared/types'

export interface SemanticCandidate {
  value: string | undefined
  source: SemanticSource
  confidence: number
}

/** 候选顺序即优先级；不翻译 id/name，也不含业务系统词典。 */
export function resolveSemantic(candidates: readonly SemanticCandidate[]): {
  semanticName?: string
  semanticConfidence?: number
  semanticSource?: SemanticSource
} {
  for (const candidate of candidates) {
    const name = candidate.value?.replace(/\s+/g, ' ').trim()
    if (name) return {
      semanticName: name,
      semanticConfidence: candidate.confidence,
      semanticSource: candidate.source
    }
  }
  return {}
}
