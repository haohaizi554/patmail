import type { MailSignatureItem } from './easy/signature-read'
import type { OperatorSignature } from './types'

export type SignatureSource = 'site' | 'diy'

export interface SignatureChoice {
  id: string
  name: string
  content: string
  source: SignatureSource
  key: string
}

export function signatureKey(source: SignatureSource, id: string): string {
  return `${source}:${id}`
}

/** 原站在前，本机暂存在后。原站正文来自当次读取，不从规则里抄一份。 */
export function signatureChoices(site: readonly MailSignatureItem[], diy: readonly OperatorSignature[], operatorId: string): SignatureChoice[] {
  const siteChoices = site
    .filter(item => item.id && item.name.trim())
    .map(item => ({ id: item.id, name: item.name, content: item.content, source: 'site' as const, key: signatureKey('site', item.id) }))
  const diyChoices = diy
    .filter(item => item.enabled && item.operatorId === operatorId && item.id && item.name.trim() && item.content.trim())
    .map(item => ({ id: item.id, name: item.name, content: item.content, source: 'diy' as const, key: signatureKey('diy', item.id) }))
  return [...siteChoices, ...diyChoices]
}

/**
 * 已保存的偏好优先。没有偏好时用原站标明的那一条；原站只有一条时也用它。
 * 原站有多条且没设默认时不挑第一条。
 */
export function defaultSignatureChoice(choices: readonly SignatureChoice[], preferredKey: string | null, reservedId: string | null): SignatureChoice | null {
  if (preferredKey) {
    const picked = choices.find(item => item.key === preferredKey)
    if (picked) return picked
  }
  if (reservedId) {
    const reserved = choices.find(item => item.source === 'site' && item.id === reservedId)
    if (reserved) return reserved
  }
  const site = choices.filter(item => item.source === 'site')
  return site.length === 1 ? site[0] ?? null : null
}

/** 规则里能直接带上的正文。偏好指向原站时这里没有正文，要等任务页现读。没设偏好时仍用以前标成默认的暂存。 */
export function storedSignature(signatures: readonly OperatorSignature[], operatorId: string, preferredKey: string | null | undefined): OperatorSignature | null {
  if (preferredKey?.startsWith('site:')) return null
  if (preferredKey?.startsWith('diy:')) {
    const id = preferredKey.slice(4)
    return signatures.find(item => item.enabled && item.id === id && item.operatorId === operatorId) ?? null
  }
  return signatures.find(item => item.enabled && item.isDefault && item.operatorId === operatorId) ?? null
}
