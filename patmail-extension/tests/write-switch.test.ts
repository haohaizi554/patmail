import { afterEach, describe, expect, it } from 'vitest'
import { productionWriteAllowed } from '../src/automation/contract-capture'
import { liveWriteBlockers } from '../src/mail/easy/gate'
import { MessageType, isWorkspaceForwardRequest } from '../src/shared/message'
import { isWriteSwitchOpen, setWriteSwitchOpen } from '../src/settings/write-switch'
import { liveWorkflowBlockers } from '../src/workflow/gate'

describe('前端写开关', () => {
  afterEach(async () => {
    await setWriteSwitchOpen(true)
  })

  it('默认打开', () => {
    expect(isWriteSwitchOpen()).toBe(true)
    expect(productionWriteAllowed()).toBe(true)
    expect(liveWriteBlockers('merge_by_customer_description').some(item => item.includes('写开关'))).toBe(false)
    expect(liveWorkflowBlockers().some(item => item.includes('写开关'))).toBe(false)
  })

  it('关掉之后拦住邮件、流程写入和查询模板写回', async () => {
    await setWriteSwitchOpen(false)
    expect(isWriteSwitchOpen()).toBe(false)
    expect(productionWriteAllowed()).toBe(false)
    expect(liveWriteBlockers('merge_by_customer_description').join('')).toContain('写开关已关闭')
    expect(liveWorkflowBlockers().join('')).toContain('写开关已关闭')
    const saveTemplate = {
      type: MessageType.SaveHistoryQuery,
      payload: { title: '常用', queryId: '', queryXml: '<xmlRoot></xmlRoot>' }
    }
    expect(isWorkspaceForwardRequest(saveTemplate)).toBe(false)
    await setWriteSwitchOpen(true)
    expect(isWorkspaceForwardRequest(saveTemplate)).toBe(true)
  })
})
