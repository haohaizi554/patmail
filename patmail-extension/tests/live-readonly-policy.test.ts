import { describe, expect, it } from 'vitest'
import { EasyRuntime } from '../src/api/client'
import { EASY_ORIGIN } from '../src/api/config'
import { extractReadonlyEvidence } from '../src/automation/readonly-contracts'
import { mailWritesEnabled } from '../src/mail/easy/gate'
import { workflowWritesEnabled } from '../src/workflow/gate'
import { productionWriteAllowed } from '../src/automation/contract-capture'
import { LIVE_WRITE_CALLS, readOnlyAutoDecision, testWritePrecheck } from '../src/automation/live-readonly-policy'

describe('READ_ONLY_AUTO', () => {
  it('blocks readonly probes of write calls while the frontend switch stays open', async () => {
    const seen: string[] = []
    const runtime = new EasyRuntime(EASY_ORIGIN, {
      fetcher: async (input) => {
        seen.push(String(input))
        return new Response('{}', { status: 200 })
      }
    })
    for (const call of LIVE_WRITE_CALLS) {
      const result = await runtime.probeReadonly(call)
      expect(result.shape).toBe('write-blocked')
      expect(readOnlyAutoDecision(call)).toBe('write-blocked')
    }
    expect(await runtime.probeReadonly('NotARealCall')).toMatchObject({ httpStatus: 0 })
    expect(readOnlyAutoDecision('NotARealCall')).toBe('unknown-blocked')
    expect(seen).toEqual([])
    expect(mailWritesEnabled() && workflowWritesEnabled() && productionWriteAllowed()).toBe(true)
  })

  it('reads a case type only from the existing dictionary adapter', () => {
    const fields = extractReadonlyEvidence('IPGetBasicData', {
      ClientInfo: { Status: true, IsLogin: true },
      CaseType: [{ case_type_id: 'aaaaaaaa-1111-4111-8111-111111111111', case_type: '专利', case_type_code: 'P' }]
    })
    expect(fields.caseTypeId).toBe('aaaaaaaa-1111-4111-8111-111111111111')
    expect(fields.caseTypeLabel).toBe('专利')
    const missing = extractReadonlyEvidence('IPGetBasicData', { ClientInfo: { Status: true, IsLogin: true } })
    expect(missing.caseTypeId).toBeUndefined()
  })

  it('prepares a test write report without executing writes', () => {
    const report = testWritePrecheck({})
    expect(report.execute).toBe(false)
    expect(report.mode).toBe('TEST_WRITE_STEP')
    expect(report.plannedWrites).toEqual([...LIVE_WRITE_CALLS])
    expect(report.guids.description).toBe('descriptionSelectability=pending')
    expect(report.rollback).toContain('不发送写请求')
  })
})
