import { describe, expect, it } from 'vitest'
import { emptyMailRules, readMailRules } from '../src/mail/repository'
import { defaultSignatureChoice, signatureChoices, signatureKey, storedSignature } from '../src/mail/signature-catalog'
import type { OperatorSignature } from '../src/mail/types'

const siteId = '561a358a-0fcf-4db9-ac17-ee3ef5e02a5b'
const otherSite = '22222222-2222-4222-8222-222222222222'
const operator = '11111111-1111-4111-8111-111111111111'

function diy(id: string, name: string, isDefault = false): OperatorSignature {
  return { id, operatorId: operator, name, content: `${name}正文`, enabled: true, isDefault, version: 1, updatedAt: '2026-09-29T00:00:00.000Z' }
}

describe('签名目录', () => {
  const site = [{ id: siteId, name: '吴晨晨', content: 'Best Regards.' }]

  it('原站在前，暂存在后', () => {
    const choices = signatureChoices(site, [diy('local-1', '出差')], operator)
    expect(choices.map(item => item.key)).toEqual([signatureKey('site', siteId), signatureKey('diy', 'local-1')])
    expect(choices.map(item => item.source)).toEqual(['site', 'diy'])
  })

  it('没有改过默认时用原站', () => {
    const choices = signatureChoices(site, [diy('local-1', '出差', true)], operator)
    expect(defaultSignatureChoice(choices, null, siteId)?.key).toBe(signatureKey('site', siteId))
  })

  it('可以把默认改成暂存', () => {
    const choices = signatureChoices(site, [diy('local-1', '出差')], operator)
    expect(defaultSignatureChoice(choices, signatureKey('diy', 'local-1'), siteId)?.name).toBe('出差')
  })

  it('原站有多条且没设默认时不挑第一条', () => {
    const choices = signatureChoices([
      { id: siteId, name: '吴晨晨', content: 'A' },
      { id: otherSite, name: '另一条', content: 'B' }
    ], [], operator)
    expect(defaultSignatureChoice(choices, null, null)).toBeNull()
  })

  it('偏好已经失效时退回原站', () => {
    const choices = signatureChoices(site, [], operator)
    expect(defaultSignatureChoice(choices, signatureKey('diy', 'missing'), siteId)?.id).toBe(siteId)
  })

  it('明确指定原站后，规则里的旧默认暂存不再写进正文', () => {
    const saved = storedSignature([diy('local-1', '出差', true)], operator, signatureKey('site', siteId))
    expect(saved).toBeNull()
    expect(storedSignature([diy('local-1', '出差', true)], operator, null)?.id).toBe('local-1')
    expect(storedSignature([diy('local-1', '出差')], operator, signatureKey('diy', 'local-1'))?.name).toBe('出差')
  })

  it('旧规则没有默认签名偏好时仍可读取', () => {
    const stored = emptyMailRules(operator)
    const legacy = { ...stored }
    delete (legacy as { defaultSignatureId?: unknown }).defaultSignatureId
    const read = readMailRules(legacy, operator)
    expect(read.writable).toBe(true)
    expect(read.bundle.defaultSignatureId).toBeNull()
  })

  it('保存的默认签名偏好会读回来', () => {
    const stored = { ...emptyMailRules(operator), defaultSignatureId: signatureKey('site', siteId) }
    const read = readMailRules(stored, operator)
    expect(read.bundle.defaultSignatureId).toBe(signatureKey('site', siteId))
  })
})
