import { describe, expect, it } from 'vitest'
import { applyEasyRefs, documentedCallAllowed, documentedFields, documentedParams, explainEasyArgs, readEasySteps, summarizeEasyPayload } from '../src/api/documented-call'
import { executeAgentTool, type ToolContext } from '../src/agent/tools'
import { EMPTY_MEMORY } from '../src/agent/memory'
import { MessageType } from '../src/shared/message'

describe('documented call', () => {
  it('allows a read call and blocks writes, bad names, and cookie fields', () => {
    expect(documentedCallAllowed('CFInvoice.ashx', 'GetBiologyList').ok).toBe(true)
    expect(documentedCallAllowed('Mail.ashx', 'SaveMailInfo').ok).toBe(false)
    expect(documentedCallAllowed('CaseInfo.ashx', 'SearchQueryHisDelete').ok).toBe(false)
    expect(documentedCallAllowed('../Login.ashx', 'GetUserModel').ok).toBe(false)
    expect(documentedCallAllowed('CFInvoice.ashx', 'Get Biology').ok).toBe(false)
    expect(documentedCallAllowed('Common.ashx', 'PeekSomething').ok).toBe(false)
    expect(documentedCallAllowed('MailAction.ashx', 'LimitMailCustomer').ok).toBe(false)
    expect(documentedCallAllowed('MailAction.ashx', 'MailSubmit').ok).toBe(false)
    expect(documentedFields({ cookie: 'secret' })).toBeNull()
    expect(documentedFields({ pageSize: '10', pageIndex: 1 })).toEqual({ pageSize: '10', pageIndex: '1' })
    expect(documentedParams('GetBiologyList', { pageSize: '10' }).get('Call')).toBe('GetBiologyList')
    expect(documentedParams('GetBiologyList', {}).get('log_pagename')).toBe('CaseManage.aspx')
    expect(summarizeEasyPayload({ TableRows: null })).toContain('已用当前登录会话调用')
    expect(summarizeEasyPayload({ TableRows: null })).not.toContain('cookie')
  })

  it('forwards a read call and does not forward a write', async () => {
    const sent: unknown[] = []
    const ctx = {
      forward: async (message: unknown) => {
        sent.push(message)
        return { type: MessageType.CallEasyResult, payload: { text: '已用当前登录会话调用，没有改数据。\n{"TableRows":null}' } }
      }
    } as unknown as ToolContext
    const read = await executeAgentTool('call_easy', JSON.stringify({
      handler: 'CFInvoice.ashx',
      call: 'GetBiologyList',
      fields: { pageSize: '10', pageIndex: '1' }
    }), ctx, EMPTY_MEMORY)
    expect(read.text).toContain('TableRows')
    expect(sent).toHaveLength(1)
    const blocked = await executeAgentTool('call_easy', JSON.stringify({ handler: 'Mail.ashx', call: 'SaveMailInfo' }), ctx, EMPTY_MEMORY)
    expect(blocked.text).toContain('没有发出')
    expect(sent).toHaveLength(1)
  })

  it('runs a chain and fills the next call from the previous response', async () => {
    const sent: Array<{ call?: string; fields?: Record<string, string> }> = []
    const ctx = {
      forward: async (message: { payload?: { call?: string; fields?: Record<string, string> } }) => {
        sent.push({ call: message.payload?.call, fields: message.payload?.fields })
        const body = message.payload?.call === 'GetSearchFiles'
          ? '{"TableRows":[{"case_id":"CASE-1"}]}'
          : '{"TableRows":null}'
        return { type: MessageType.CallEasyResult, payload: { text: `已用当前登录会话调用，没有改数据。\n${body}` } }
      }
    } as unknown as ToolContext
    const chain = await executeAgentTool('call_easy', JSON.stringify({
      steps: [
        { handler: 'CaseInfo.ashx', call: 'GetSearchFiles', fields: { case_volume: 'PA1' } },
        { handler: 'CFInvoice.ashx', call: 'GetBiologyList', fields: { case_id: '@{1.TableRows.0.case_id}', pageSize: '10' } }
      ]
    }), ctx, EMPTY_MEMORY)
    expect(sent.map(item => item.call)).toEqual(['GetSearchFiles', 'GetBiologyList'])
    expect(sent[1]?.fields?.case_id).toBe('CASE-1')
    expect(chain.text.startsWith('已用当前登录会话调用')).toBe(true)
    expect(chain.text).toContain('第 2 步')
    expect(readEasySteps({ steps: [] })).toBeNull()
    const recipe = readEasySteps({ recipe: 'biology', case_id: 'CASE-1' })
    expect(recipe?.[0]?.call).toBe('GetBiologyList')
    expect(recipe?.[0]?.fields.case_id).toBe('CASE-1')
    expect(recipe?.[0]?.fields._PK).toBe('biomaterial_id')
    expect(explainEasyArgs({ recipe: 'nope' })).toContain('没有这个固定组合')
    expect(explainEasyArgs({ recipe: 'biology' })).toContain('案件编号')
    const demand = readEasySteps({ recipe: 'case-demand', case_id: '11111111-1111-1111-1111-111111111111' })
    expect(demand?.[0]?.handler).toBe('PatentAction.ashx')
    expect(demand?.[0]?.call).toBe('GetDemandBuCaseid')
    expect(explainEasyArgs({ recipe: 'case-demand', case_id: 'CASE-1' })).toContain('格式不对')
    expect(applyEasyRefs({ case_id: '@{1.missing}' }, [{}]).ok).toBe(false)
  })
})
