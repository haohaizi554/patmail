import { describe, expect, it } from 'vitest'
import type { EasyTransport } from '../src/api/transport'
import {
  buildMailSubmit, limitMailItems, pickMailSubmitNodes, readLimitMailCustomer, readMailSubmit, submitLimitMailBatch,
  type LimitMailSubmitItem
} from '../src/customer/limit-mail-submit'
import type { WorkflowNode } from '../src/workflow/types'

const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const other = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'
const proc = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const proc2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae'
const mailType = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const mail = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'
const flow = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'
const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'
const next = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7'
const list1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8'
const list2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'
const urgency = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
const dept = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad'

function client(extra: Record<string, unknown> = {}) {
  return { IsLogin: true, Status: true, Result: false, Message: null, ...extra }
}

function flowInfo(mailId = mail) {
  return {
    ClientInfo: client({ Result: true }),
    Result: {
      obj_id: mailId, flow_id: flow, flow_type: 'CO', flow_sub_type: '', dept_id: dept, dept_full_name: '部门',
      status: -1, cur_node_id: '', cur_user_id: '', node_code: '', cn_name: '', is_skip: false, is_enabled: true,
      urgency_id: '', update_time: '2026-07-07', update_time_dd: '2026-07-07', update_time_mm: '2026-07-07 08:17',
      update_time_ss: '2026-07-07 08:17:41'
    }
  }
}

function nodes(reviewerIds: string[]) {
  return {
    ClientInfo: client(),
    flow_type_name: '发文',
    Result: [
      { seq: 1, next: '2', node_code: 'FIRST', node_id: first, list_id: list1, node_name_zh_cn: '启动', allow_edit: true, allow_skip: '', is_parallel: 0, need_all_audit: 0, user_list_id: '', user_list_name: '', user_list: '' },
      { seq: 2, next: '3', node_code: '', node_id: next, list_id: list2, node_name_zh_cn: '审核', allow_edit: true, allow_skip: '', is_parallel: 0, need_all_audit: 0, user_type: '用户', user_list_id: reviewerIds.join(';'), user_list_name: reviewerIds.map((_, index) => `审核人${index + 1}`).join(';'), user_list: '' },
      { seq: 3, next: '0', node_code: 'END', node_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf', list_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0', node_name_zh_cn: '结束', allow_edit: false, allow_skip: '', is_parallel: 0, need_all_audit: 0, user_list_id: '', user_list_name: '' }
    ]
  }
}

const customer = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11'
const mailset = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22'

function draft(extra: Partial<LimitMailSubmitItem> = {}): LimitMailSubmitItem {
  return {
    procId: proc,
    mailTypeId: mailType,
    mailStyle: '1' as const,
    mode: 'ipr' as const,
    customerName: '客户甲',
    contactName: '',
    iprName: '雷工',
    leadName: '',
    ...extra
  }
}

function mailInfo() {
  return {
    ClientInfo: client(),
    MailInfo: [{
      mail_id: mail,
      customer_id: customer,
      mail_type_id: mailType,
      mailset_id: mailset,
      mail_to: '',
      mail_cc: '',
      mail_bcc: '',
      mail_subject: '主题',
      mail_body: '正文',
      is_zip: false,
      zip_pwd: '',
      rename_zip: '',
      reply_date: '',
      proc_ids: '',
      express_id: '',
      message_id: '',
      subject_desc: '',
      mail_tags: '',
      finish_ctrl_proc: ''
    }]
  }
}

function contacts(sales = [{ cn_name: '商务甲', email: 'sales@example.com' }], pics = [{ cn_name: '雷工', email: 'ipr@example.com' }]) {
  const empty = (key: string) => ({ ClientInfo: client(), [key]: [] })
  return {
    getMailInfo: () => mailInfo(),
    getRecentContact: () => empty('RecentContact'),
    getCustomerContact: () => empty('CustomerContact'),
    getCaseContact: () => empty('CaseContact'),
    getSalesContact: () => ({ ClientInfo: client(), SalesContact: sales }),
    getPicsContact: () => ({ ClientInfo: client(), PicsContact: pics }),
    getCaseAgentContact: () => empty('CaseAgentContact')
  }
}

function transport(handlers: Record<string, (params: URLSearchParams) => unknown>, calls: string[]) {
  return {
    post: async (operation: string, params: URLSearchParams) => {
      calls.push(`${operation}:${params.get('Call')}`)
      const body = handlers[operation]?.(params)
      return body === undefined ? { ok: false, error: { code: 'HTTP_ERROR', message: '没有这个响应', status: 500 } } : { ok: true, data: body }
    }
  } as unknown as EasyTransport
}

describe('limit mail submit', () => {
  it('reads a created mail from objid even when ClientInfo.Result is false', () => {
    expect(readLimitMailCustomer({ ClientInfo: client(), objid: mail })).toEqual({ ok: true, mailId: mail })
    const confirm = readLimitMailCustomer({ NeedConfirmFillAgency: true, ClientInfo: client({ Message: '请确认代理机构' }) })
    expect(confirm.ok).toBe(false)
    if (!confirm.ok) expect(confirm.kind).toBe('confirm')
  })

  it('accepts MailSubmit only when Result is true', () => {
    expect(readMailSubmit({ ClientInfo: client({ Result: true }) }).ok).toBe(true)
    const rejected = readMailSubmit({ ClientInfo: client({ Result: false, Message: '不行' }) })
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.kind).toBe('rejected')
  })

  it('submits the new mail to the logged-in reviewer and leaves score and dates empty', async () => {
    const calls: string[] = []
    const sent: { params: URLSearchParams | null } = { params: null }
    const saved: { params: URLSearchParams | null } = { params: null }
    const result = await submitLimitMailBatch(transport({
      limitMailCustomer: () => ({ ClientInfo: client(), objid: mail }),
      ...contacts(),
      saveMailInfo: params => {
        saved.params = params
        return { ClientInfo: client({ Result: false, Status: true }) }
      },
      getFlowInfo: () => flowInfo(),
      getFlowSubmit: () => nodes([other, user]),
      getUrgencyList: () => ({ ClientInfo: client(), UrgencyList: [{ urgency_id: urgency, urgency_code: 'CM', urgency_name: '普通', seq: 1 }] }),
      getFlowLastStatus: () => ({ ClientInfo: client(), last_status: null }),
      mailSubmit: params => {
        sent.params = params
        return { ClientInfo: client({ Result: true }) }
      }
    }, calls), user, [draft()])
    expect(result.stopped).toBe(false)
    expect(result.results[0]?.state).toBe('submitted')
    expect(result.results[0]?.message).toContain('抄送已含商务')
    expect(calls.filter(item => item.startsWith('limitMailCustomer'))).toHaveLength(1)
    expect(calls.filter(item => item.startsWith('mailSubmit'))).toHaveLength(1)
    const saveAt = calls.findIndex(item => item.startsWith('saveMailInfo'))
    const submitAt = calls.findIndex(item => item.startsWith('mailSubmit'))
    expect(saveAt).toBeGreaterThan(-1)
    expect(submitAt).toBeGreaterThan(saveAt)
    expect(saved.params?.get('mail_to')).toBe('雷工(ipr@example.com);')
    expect(saved.params?.get('mail_cc')).toBe('商务甲(sales@example.com);')
    expect(saved.params?.get('mail_subject')).toBe('主题')
    expect(saved.params?.get('mail_body')).toBe('正文')
    expect(saved.params?.get('is_zip')).toBe('0')
    expect(saved.params?.get('Call')).toBe('SaveMailInfo')
    expect(sent.params?.get('Call')).toBe('MailSubmit')
    expect(sent.params?.get('handler')).toBe('Mail.ashx')
    expect(sent.params?.get('f_next_user_id')).toBe(user)
    expect(sent.params?.get('f_status')).toBe('1000')
    expect(sent.params?.get('f_next_node_code')).toBe('')
    expect(sent.params?.get('f_score')).toBe('')
    expect(sent.params?.get('finishdate')).toBe('false')
    expect(sent.params?.get('f_list_id')).toBe(list2)
    expect(sent.params?.get('f_cur_node_code')).toBe('FIRST')
  })

  it('does not pick another reviewer and does not submit when the logged-in user is absent', async () => {
    const calls: string[] = []
    const result = await submitLimitMailBatch(transport({
      limitMailCustomer: () => ({ ClientInfo: client(), objid: mail }),
      ...contacts(),
      saveMailInfo: () => ({ ClientInfo: client({ Result: false, Status: true }) }),
      getFlowInfo: () => flowInfo(),
      getFlowSubmit: () => nodes([other]),
      getUrgencyList: () => ({ ClientInfo: client(), UrgencyList: [] }),
      getFlowLastStatus: () => ({ ClientInfo: client(), last_status: null })
    }, calls), user, [draft()])
    expect(result.results[0]?.state).toBe('created')
    expect(calls.some(item => item.startsWith('mailSubmit'))).toBe(false)
  })

  it('does not create a second mail after an unconfirmed submit', async () => {
    const calls: string[] = []
    const result = await submitLimitMailBatch(transport({
      limitMailCustomer: () => ({ ClientInfo: client(), objid: mail }),
      ...contacts(),
      saveMailInfo: () => ({ ClientInfo: client({ Result: false, Status: true }) }),
      getFlowInfo: () => flowInfo(),
      getFlowSubmit: () => nodes([user]),
      getUrgencyList: () => ({ ClientInfo: client(), UrgencyList: [{ urgency_id: urgency, urgency_code: 'CM', urgency_name: '普通', seq: 1 }] }),
      getFlowLastStatus: () => ({ ClientInfo: client(), last_status: null }),
      mailSubmit: () => ({ nope: true })
    }, calls), user, [draft(), draft({ procId: proc2 })])
    expect(result.results[0]?.state).toBe('unknown')
    expect(result.results).toHaveLength(1)
    expect(calls.filter(item => item.startsWith('limitMailCustomer'))).toHaveLength(1)
    expect(calls.filter(item => item.startsWith('mailSubmit'))).toHaveLength(1)
  })

  it('stops when the site asks to confirm the agency and does not resubmit', async () => {
    const calls: string[] = []
    const result = await submitLimitMailBatch(transport({
      limitMailCustomer: () => ({ NeedConfirmFillAgency: true, ClientInfo: client({ Message: '请确认' }) })
    }, calls), user, [draft()])
    expect(result.results[0]?.state).toBe('failed')
    expect(calls).toHaveLength(1)
  })

  it('writes the technical lead to the recipient and IPR plus sales to CC', async () => {
    const calls: string[] = []
    const saved: { params: URLSearchParams | null } = { params: null }
    const result = await submitLimitMailBatch(transport({
      limitMailCustomer: () => ({ ClientInfo: client(), objid: mail }),
      ...contacts(
        [{ cn_name: '商务甲', email: 'sales@example.com' }],
        [{ cn_name: '雷工', email: 'ipr@example.com' }, { cn_name: '技术甲', email: 'lead@example.com' }]
      ),
      saveMailInfo: params => {
        saved.params = params
        return { ClientInfo: client({ Result: false, Status: true }) }
      },
      getFlowInfo: () => flowInfo(),
      getFlowSubmit: () => nodes([user]),
      getUrgencyList: () => ({ ClientInfo: client(), UrgencyList: [{ urgency_id: urgency, urgency_code: 'CM', urgency_name: '普通', seq: 1 }] }),
      getFlowLastStatus: () => ({ ClientInfo: client(), last_status: null }),
      mailSubmit: () => ({ ClientInfo: client({ Result: true }) })
    }, calls), user, [draft({ mode: 'lead', leadName: '技术甲' })])
    expect(result.results[0]?.state).toBe('submitted')
    expect(saved.params?.get('mail_to')).toBe('技术甲(lead@example.com);')
    expect(saved.params?.get('mail_cc')).toContain('雷工(ipr@example.com);')
    expect(saved.params?.get('mail_cc')).toContain('商务甲(sales@example.com);')
  })

  it('does not submit when the mail page has no sales address', async () => {
    const calls: string[] = []
    const result = await submitLimitMailBatch(transport({
      limitMailCustomer: () => ({ ClientInfo: client(), objid: mail }),
      ...contacts([])
    }, calls), user, [draft()])
    expect(result.results[0]?.state).toBe('created')
    expect(result.results[0]?.message).toContain('商务')
    expect(calls.some(item => item.startsWith('saveMailInfo'))).toBe(false)
    expect(calls.some(item => item.startsWith('mailSubmit'))).toBe(false)
  })

  it('does not submit when the sheet IPR does not match a contact', async () => {
    const calls: string[] = []
    const result = await submitLimitMailBatch(transport({
      limitMailCustomer: () => ({ ClientInfo: client(), objid: mail }),
      ...contacts()
    }, calls), user, [draft({ iprName: '没有这个人' })])
    expect(result.results[0]?.state).toBe('created')
    expect(result.results[0]?.message).toContain('没有这个人')
    expect(calls.some(item => item.startsWith('saveMailInfo'))).toBe(false)
    expect(calls.some(item => item.startsWith('mailSubmit'))).toBe(false)
  })

  it('refuses a volume that has no single mail type', () => {
    expect(limitMailItems({ procIds: [proc], rows: [{ procId: proc, caseVolume: 'PA1' }], sheetRows: [], mode: 'ipr' }).ok).toBe(false)
    const named = limitMailItems({
      procIds: [proc],
      rows: [{ procId: proc, caseVolume: 'PA1' }],
      sheetRows: [{ ourVolume: 'PA1', mailTypeId: mailType, iprName: '雷工', customerName: '客户甲' }],
      mode: 'ipr'
    })
    expect(named.ok && named.items[0]?.iprName).toBe('雷工')
    expect(limitMailItems({
      procIds: [proc],
      rows: [{ procId: proc, caseVolume: 'PA1' }],
      sheetRows: [{ ourVolume: 'PA1', mailTypeId: mailType, iprName: '雷工' }],
      mode: 'lead'
    }).ok).toBe(false)
    const current: WorkflowNode = { listId: list1, seq: 1, next: '9', nodeId: first, nodeCode: 'FIRST', nodeName: '启动', allowSkip: null, allowEdit: true, userType: '', parallel: false, needAllAudit: false, reviewers: [], reviewerFormat: 'structured' }
    expect(pickMailSubmitNodes([current]).ok).toBe(false)
    expect(buildMailSubmit({
      info: { objId: mail, flowId: flow, flowType: 'CO', flowSubType: '', deptId: dept, deptFullName: '', status: -1, curNodeId: '', curUserId: '', nodeCode: '', nodeName: null, cnName: '', isSkip: false, isEnabled: true, urgencyId: '', updateTime: '', updateTimeDd: '', updateTimeMm: '', updateTimeSs: '' },
      current, next: { ...current, nodeId: next, nodeCode: 'END', listId: list2, seq: 9 },
      reviewer: { id: user, name: '本人' }, urgencyId: urgency
    }).params).toBeNull()
  })
})
