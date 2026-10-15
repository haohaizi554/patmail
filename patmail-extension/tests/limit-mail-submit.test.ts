import { describe, expect, it } from 'vitest'
import type { EasyTransport } from '../src/api/transport'
import {
  buildMailSubmit, dropPrefilledNoticeRecipient, limitMailItems, limitMailProcIds, limitMailSubmitShouldHalt, nextLimitMailAttempt, pickMailSubmitNodes, readLimitMailCustomer, readMailSubmit, selectionNeedsAddressChoice, submitLimitMailBatch, summarizeLimitMailSubmit,
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

const finishProc = '629cd76f-d7ed-4bf9-944b-a9b2b91b84a2'

function mailCases() {
  return {
    ClientInfo: client(),
    TableRows: [
      { case_id: customer, case_volume: 'PA1', ctrl_proc: '提醒申请PCT', ctrl_proc_id: finishProc },
      { case_id: customer, case_volume: 'PA2', ctrl_proc: '提醒申请PCT', ctrl_proc_id: finishProc }
    ],
    TableRowsCount: '2'
  }
}

function transport(handlers: Record<string, (params: URLSearchParams) => unknown>, calls: string[]) {
  return {
    post: async (operation: string, params: URLSearchParams) => {
      calls.push(`${operation}:${params.get('Call')}`)
      const body = handlers[operation]?.(params) ?? (operation === 'getMailCase' ? mailCases() : undefined)
      return body === undefined ? { ok: false, error: { code: 'HTTP_ERROR', message: '没有这个响应', status: 500 } } : { ok: true, data: body }
    }
  } as unknown as EasyTransport
}

describe('limit mail submit', () => {
  it('drops the prefilled notice address from recipients and copies', () => {
    expect(dropPrefilledNoticeRecipient('chenjch02@pcl.ac.cn;高宇(gaoy@pcl.ac.cn);')).toBe('高宇(gaoy@pcl.ac.cn);')
    expect(dropPrefilledNoticeRecipient('陈嘉成<chenjch02@pcl.ac.cn>;李克军(likj@pcl.ac.cn);')).toBe('李克军(likj@pcl.ac.cn);')
    expect(dropPrefilledNoticeRecipient('chenjch02@pcl.ac.cn')).toBe('')
    expect(dropPrefilledNoticeRecipient('高宇(gaoy@pcl.ac.cn);')).toBe('高宇(gaoy@pcl.ac.cn);')
  })

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
    expect(saved.params?.get('finish_ctrl_proc')).toBe(finishProc)
    expect(result.results[0]?.message).toContain('完成事项已勾上本封的处理事项')
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

  it('一件提交响应未确认只算这一件，同批第二件继续做', async () => {
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
    }, calls), user, [draft(), draft({ procId: proc2, mailTypeId: 'bbbbbbbb-4bbb-4bbb-8bbb-bbbbbbbbbbbb' })])
    expect(result.stopped).toBe(false)
    expect(result.results.every(item => item.state === 'unknown')).toBe(true)
    expect(result.results).toHaveLength(2)
    expect(calls.filter(item => item.startsWith('limitMailCustomer'))).toHaveLength(2)
    expect(calls.filter(item => item.startsWith('mailSubmit'))).toHaveLength(2)
  })

  it('stops when the site asks to confirm the agency and does not resubmit', async () => {
    const calls: string[] = []
    const result = await submitLimitMailBatch(transport({
      limitMailCustomer: () => ({ NeedConfirmFillAgency: true, ClientInfo: client({ Message: '请确认' }) })
    }, calls), user, [draft()])
    expect(result.results[0]?.state).toBe('failed')
    expect(calls).toHaveLength(1)
  })

  it('不用发是明确结论，同一批后面那件照常提交', async () => {
    const calls: string[] = []
    const result = await submitLimitMailBatch(transport({
      limitMailCustomer: () => ({ ClientInfo: client(), objid: mail }),
      ...contacts(),
      saveMailInfo: () => ({ ClientInfo: client({ Result: false, Status: true }) }),
      getFlowInfo: () => flowInfo(),
      getFlowSubmit: () => nodes([user]),
      getUrgencyList: () => ({ ClientInfo: client(), UrgencyList: [{ urgency_id: urgency, urgency_code: 'CM', urgency_name: '普通', seq: 1 }] }),
      getFlowLastStatus: () => ({ ClientInfo: client(), last_status: null }),
      mailSubmit: () => ({ ClientInfo: client({ Result: true }) })
    }, calls), user, [draft({ procId: proc, hold: 'skip' }), draft({ procId: proc2 })])
    expect(result.stopped).toBe(false)
    expect(result.results).toHaveLength(2)
    expect(result.results[0]?.state).toBe('failed')
    expect(result.results[0]?.message).toBe('客户要求这封提醒不用发，没有创建发文。')
    expect(result.results[1]?.state).toBe('submitted')
    expect(result.results[1]?.message).toContain('已提交')
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

  it('同一批人换顺序或带（仲）（补）仍并成一封，少一个人则分开', () => {
    const proc3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf'
    const rows = [
      { procId: proc, caseVolume: 'CPA2510783CN' },
      { procId: proc2, caseVolume: 'CW1P22538273CN' },
      { procId: proc3, caseVolume: 'CW1P22518274CN' }
    ]
    const customer = '深圳奕易控动力科技有限公司'
    const planned = limitMailItems({
      procIds: rows.map(row => row.procId),
      rows,
      sheetRows: [
        { ourVolume: 'CPA2510783CN', mailTypeId: mailType, customerName: customer, iprName: '金超,陈炬峰', mailCc: '商务' },
        { ourVolume: 'CW1P22538273CN', mailTypeId: mailType, customerName: customer, iprName: '陈炬峰,金超（仲）', mailCc: '商务', iprArbitrated: true as const },
        { ourVolume: 'CW1P22518274CN', mailTypeId: mailType, customerName: customer, iprName: '陈炬峰,金超（补）', mailCc: '商务' }
      ],
      mode: 'ipr',
      address: 'auto'
    })
    expect(planned.ok && planned.items).toHaveLength(1)
    if (!planned.ok) return
    expect(planned.items.flatMap(limitMailProcIds).sort()).toEqual(rows.map(row => row.procId).sort())
    const narrower = limitMailItems({
      procIds: [proc, proc2],
      rows,
      sheetRows: [
        { ourVolume: 'CPA2510783CN', mailTypeId: mailType, customerName: customer, iprName: '陈炬峰,金超' },
        { ourVolume: 'CW1P22538273CN', mailTypeId: mailType, customerName: customer, iprName: '陈炬峰' }
      ],
      mode: 'ipr',
      address: 'auto'
    })
    expect(narrower.ok && narrower.items).toHaveLength(2)
  })

  it('同客户同收件人的勾选并成一封，_file_ids 只列勾上的', async () => {
    const planned = limitMailItems({
      procIds: [proc, proc2],
      rows: [{ procId: proc, caseVolume: 'PA1' }, { procId: proc2, caseVolume: 'PA2' }],
      sheetRows: [
        { ourVolume: 'PA1', mailTypeId: mailType, customerName: '甲客户', iprName: '雷工' },
        { ourVolume: 'PA2', mailTypeId: mailType, customerName: '甲客户', iprName: '雷工' }
      ],
      mode: 'ipr'
    })
    expect(planned.ok && planned.items).toHaveLength(1)
    if (!planned.ok) return
    expect(planned.items[0]?.mailStyle).toBe('1')
    expect(planned.items.flatMap(limitMailProcIds).sort()).toEqual([proc, proc2].sort())
    const calls: string[] = []
    const fileIds: string[] = []
    const result = await submitLimitMailBatch(transport({
      limitMailCustomer: params => {
        fileIds.push(params.get('_file_ids') ?? '')
        return { ClientInfo: client(), objid: mail }
      },
      ...contacts(),
      saveMailInfo: params => {
        const savedTo = params.get('mail_to')
        if (savedTo) expect(decodeURIComponent(savedTo)).toBe('雷工(ipr@example.com);')
        return { ClientInfo: client({ Result: false, Status: true }) }
      },
      getFlowInfo: () => flowInfo(),
      getFlowSubmit: () => nodes([user]),
      getUrgencyList: () => ({ ClientInfo: client(), UrgencyList: [{ urgency_id: urgency, urgency_code: 'CM', urgency_name: '普通', seq: 1 }] }),
      getFlowLastStatus: () => ({ ClientInfo: client(), last_status: null }),
      mailSubmit: () => ({ ClientInfo: client({ Result: true }) })
    }, calls), user, planned.items)
    expect(fileIds).toEqual([`${proc};${proc2}`])
    expect(calls.filter(item => item.startsWith('limitMailCustomer'))).toHaveLength(1)
    expect(calls.filter(item => item.startsWith('mailSubmit'))).toHaveLength(1)
    expect(result.results.map(item => item.procId)).toEqual([proc, proc2])
    expect(result.results.every(item => item.state === 'submitted')).toBe(true)
    // 实际写进 EASY 的地址载荷随结果带回，提交总结弹窗靠它核对。
    expect(result.results.every(item => item.to === '雷工(ipr@example.com);' && item.cc === '商务甲(sales@example.com);')).toBe(true)
    expect(result.results[0]?.message).toContain('已把 2 件合成一封')
    const split = limitMailItems({
      procIds: [proc, proc2],
      rows: [{ procId: proc, caseVolume: 'PA1' }, { procId: proc2, caseVolume: 'PA2' }],
      sheetRows: [
        { ourVolume: 'PA1', mailTypeId: mailType, customerName: '甲客户', iprName: '雷工' },
        { ourVolume: 'PA2', mailTypeId: mailType, customerName: '甲客户', iprName: '王工' }
      ],
      mode: 'ipr'
    })
    expect(split.ok && split.items).toHaveLength(2)
  })

  it('accepts more than twenty confirmed items', () => {
    const procIds = Array.from({ length: 21 }, (_, index) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`)
    const planned = limitMailItems({
      procIds,
      rows: procIds.map((procId, index) => ({ procId, caseVolume: `PA${index + 1}` })),
      sheetRows: procIds.map((_, index) => ({ ourVolume: `PA${index + 1}`, mailTypeId: mailType, customerName: '甲客户', iprName: '雷工' })),
      mode: 'ipr'
    })
    // 同收件人的 21 件并成一封，_file_ids 分号连接。
    expect(planned.ok && planned.items).toHaveLength(1)
    if (!planned.ok) return
    expect(planned.items[0]?.mailStyle).toBe('1')
    expect(limitMailProcIds(planned.items[0]).sort()).toEqual([...procIds].sort())
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
    const checked = limitMailItems({
      procIds: [proc],
      rows: [{ procId: proc, caseVolume: 'PA1' }],
      sheetRows: [{ ourVolume: 'PA1', mailTypeId: mailType, iprName: '', customerName: '客户甲', mailCc: '韩玉奎' }],
      mode: 'ipr',
      address: 'checked'
    })
    expect(checked.ok && checked.items[0]?.contacts).toBe('all')
    expect(checked.ok && checked.items[0]?.ccName).toBe('韩玉奎')
    const withheld = limitMailItems({
      procIds: [proc, proc2],
      rows: [{ procId: proc, caseVolume: 'PA1' }, { procId: proc2, caseVolume: 'PA2' }],
      sheetRows: [
        { ourVolume: 'PA1', mailTypeId: mailType, iprName: '不用发', iprArbitrated: true, customerName: '城市公共安全' },
        { ourVolume: 'PA2', mailTypeId: mailType, iprName: '只发业务', iprArbitrated: true, customerName: '三一重能' }
      ],
      mode: 'ipr',
      address: 'auto'
    })
    expect(withheld.ok && withheld.items).toHaveLength(2)
    expect(withheld.ok && withheld.items[0]?.hold).toBe('skip')
    expect(withheld.ok && withheld.items[0]?.contacts).toBeUndefined()
    expect(withheld.ok && withheld.items[1]?.iprName).toBe('只发业务')
    expect(withheld.ok && withheld.items[1]?.contacts).toBeUndefined()
    expect(withheld.ok && withheld.items[1]?.hold).toBeUndefined()
    const current: WorkflowNode = { listId: list1, seq: 1, next: '9', nodeId: first, nodeCode: 'FIRST', nodeName: '启动', allowSkip: null, allowEdit: true, userType: '', parallel: false, needAllAudit: false, reviewers: [], reviewerFormat: 'structured' }
    expect(pickMailSubmitNodes([current]).ok).toBe(false)
    expect(buildMailSubmit({
      info: { objId: mail, flowId: flow, flowType: 'CO', flowSubType: '', deptId: dept, deptFullName: '', status: -1, curNodeId: '', curUserId: '', nodeCode: '', nodeName: null, cnName: '', isSkip: false, isEnabled: true, urgencyId: '', updateTime: '', updateTimeDd: '', updateTimeMm: '', updateTimeSs: '' },
      current, next: { ...current, nodeId: next, nodeCode: 'END', listId: list2, seq: 9 },
      reviewer: { id: user, name: '本人' }, urgencyId: urgency
    }).params).toBeNull()
  })

  it('结束流程后回传还没提交审核时，不再沿用上次已提交的记录', () => {
    const item = draft()
    const mark = { procId: proc, mailId: mail, state: 'submitted' as const }
    const again = nextLimitMailAttempt(item, mark, 'done')
    expect(again.action).toBe('send')
    if (again.action === 'send') expect(again.item.mailId).toBeUndefined()
    expect(nextLimitMailAttempt(item, mark, 'open').action).toBe('send')
    expect(nextLimitMailAttempt(item, mark, 'pending')).toEqual({ action: 'skip', reason: 'pending' })
    expect(nextLimitMailAttempt(item, mark, undefined)).toEqual({ action: 'skip', reason: 'remembered' })
  })

  it('创建后遇到网关异常，再点提交沿用这封，不因为流程是还没提交或已结束而新建', () => {
    const item = draft()
    const mark = { procId: proc, mailId: mail, state: 'created' as const }
    for (const gate of ['open', 'done', undefined] as const) {
      const again = nextLimitMailAttempt(item, mark, gate)
      expect(again.action).toBe('send')
      if (again.action === 'send') expect(again.item.mailId).toBe(mail)
    }
    expect(limitMailSubmitShouldHalt('没有提交到审核人。EASY 网关异常。再点「提交到 EASY」会沿用这封发文，不会重新创建。')).toBe(false)
    expect(limitMailSubmitShouldHalt('没有提交到审核人。请求超时，请重试。')).toBe(false)
    expect(limitMailSubmitShouldHalt('没有提交到审核人。创建发文的响应无法确认，没有再次创建。')).toBe(false)
    expect(limitMailSubmitShouldHalt('客户要求这封提醒不用发，没有创建发文。')).toBe(false)
    expect(limitMailSubmitShouldHalt('写开关已关闭，没有提交到 EASY。')).toBe(true)
    expect(limitMailSubmitShouldHalt('EASY 登录已失效，请在原网站重新登录。')).toBe(true)
    const heldSummary = summarizeLimitMailSubmit([{ procId: proc, mailId: '', state: 'failed', message: '客户要求这封提醒不用发，没有创建发文。' }], true)
    expect(heldSummary).toBe('客户要求这封提醒不用发，没有创建发文。')
    expect(summarizeLimitMailSubmit([{ procId: proc, mailId: mail, state: 'submitted', message: '已提交给当前登录人审核。' }], false)).toBe('已提交 1 件给当前登录人审核。')
  })

  it('提交按钮跟着当前勾选在一个和两个之间来回变', () => {
    const limit = [
      { procId: 'p-plain', caseVolume: 'PA1', ctrlProc: '提醒申请PCT' },
      { procId: 'p-marked', caseVolume: 'PA2', ctrlProc: '提醒申请PCT' }
    ]
    const sheet = [
      { ourVolume: 'PA1', procLabel: '提醒申请PCT', iprName: '雷群安' },
      { ourVolume: 'PA2', procLabel: '提醒申请PCT', iprName: '韩玉奎', iprArbitrated: true as const }
    ]
    expect(selectionNeedsAddressChoice(limit, sheet, [])).toBe(true)
    expect(selectionNeedsAddressChoice(limit, sheet, ['p-plain'])).toBe(false)
    expect(selectionNeedsAddressChoice(limit, sheet, ['p-plain', 'p-marked'])).toBe(true)
    expect(selectionNeedsAddressChoice(limit, sheet, ['p-marked'])).toBe(true)
    expect(selectionNeedsAddressChoice(limit, sheet, ['p-marked'], ['p-plain'])).toBe(false)
    expect(selectionNeedsAddressChoice(limit, sheet, [], ['p-plain'])).toBe(false)
    expect(selectionNeedsAddressChoice(limit, sheet, [], ['p-marked'])).toBe(true)
  })

  it('信任仲裁跳过还空着的行，全选联系人仍提交这些行', () => {
    const rows = [
      { procId: proc, caseVolume: 'PA1' },
      { procId: proc2, caseVolume: 'PA2' }
    ]
    const sheetRows = [
      { ourVolume: 'PA1', mailTypeId: mailType, customerName: '甲客户', iprName: '雷工' },
      { ourVolume: 'PA2', mailTypeId: mailType, customerName: '甲客户', iprName: '' }
    ]
    const trusted = limitMailItems({ procIds: [proc, proc2], rows, sheetRows, mode: 'ipr', address: 'named' })
    expect(trusted.ok && trusted.items.map(item => item.procId)).toEqual([proc])
    const checked = limitMailItems({ procIds: [proc2], rows, sheetRows, mode: 'ipr', address: 'checked' })
    expect(checked.ok && checked.items[0]?.contacts).toBe('all')
    const onlyEmpty = limitMailItems({ procIds: [proc2], rows, sheetRows, mode: 'ipr', address: 'named' })
    expect(onlyEmpty.ok).toBe(false)
    if (!onlyEmpty.ok) expect(onlyEmpty.message).toContain('直接全选')
  })

  it('合并按钮：有名字的行按仲裁提交，空着的行按发文规则全选兜底', () => {
    const rows = [
      { procId: proc, caseVolume: 'PA1' },
      { procId: proc2, caseVolume: 'PA2' }
    ]
    const sheetRows = [
      { ourVolume: 'PA1', mailTypeId: mailType, customerName: '甲客户', iprName: '雷工' },
      { ourVolume: 'PA2', mailTypeId: mailType, customerName: '甲客户', iprName: '' }
    ]
    const merged = limitMailItems({ procIds: [proc, proc2], rows, sheetRows, mode: 'ipr', address: 'auto' })
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    const namedItem = merged.items.find(item => limitMailProcIds(item).includes(proc))
    const allItem = merged.items.find(item => limitMailProcIds(item).includes(proc2))
    expect(namedItem?.iprName).toBe('雷工')
    expect(namedItem?.contacts).toBeUndefined()
    expect(allItem?.contacts).toBe('all')
    expect(allItem?.iprName).toBe('')
  })

  it('三件里勾两件就只发这两件，没勾的不带上', () => {
    const proc3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab0'
    const rows = [
      { procId: proc, caseVolume: 'PA1' },
      { procId: proc2, caseVolume: 'PA2' },
      { procId: proc3, caseVolume: 'PA3' }
    ]
    const sheetRows = [
      { ourVolume: 'PA1', mailTypeId: mailType, customerName: '甲客户', iprName: '雷工' },
      { ourVolume: 'PA2', mailTypeId: mailType, customerName: '甲客户', iprName: '雷工' },
      { ourVolume: 'PA3', mailTypeId: mailType, customerName: '甲客户', iprName: '雷工' }
    ]
    const two = limitMailItems({ procIds: [proc, proc2], rows, sheetRows, mode: 'ipr' })
    expect(two.ok).toBe(true)
    if (!two.ok) return
    expect(two.items).toHaveLength(1)
    expect(two.items[0]?.mailStyle).toBe('1')
    expect(two.items.flatMap(limitMailProcIds).sort()).toEqual([proc, proc2].sort())
    expect(two.items.flatMap(limitMailProcIds)).not.toContain(proc3)
  })

  it('直接全选不采用仲裁写回的收件人，原表有名字的行照表格提交', () => {
    const proc3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1'
    const rows = [
      { procId: proc, caseVolume: 'PA1' },
      { procId: proc2, caseVolume: 'PA2' },
      { procId: proc3, caseVolume: 'PA3' }
    ]
    const sheetRows = [
      { ourVolume: 'PA1', mailTypeId: mailType, customerName: '甲客户', iprName: '不用发', iprArbitrated: true as const },
      { ourVolume: 'PA2', mailTypeId: mailType, customerName: '甲客户', iprName: '雷工', iprArbitrated: true as const },
      { ourVolume: 'PA3', mailTypeId: mailType, customerName: '甲客户', iprName: '雷群安' }
    ]
    const forced = limitMailItems({ procIds: [proc, proc2, proc3], rows, sheetRows, mode: 'ipr', address: 'all' })
    expect(forced.ok).toBe(true)
    if (!forced.ok) return
    // 直接全选不执行「不用发」：件 1、2 都清成全选兜底、同键并成一封；原表有值的件 3 独立一封。
    expect(forced.items).toHaveLength(2)
    const fallback = forced.items.find(item => limitMailProcIds(item).includes(proc))
    const plain = forced.items.find(item => limitMailProcIds(item).includes(proc3))
    expect(fallback && limitMailProcIds(fallback).sort()).toEqual([proc, proc2].sort())
    expect(fallback?.contacts).toBe('all')
    expect(fallback?.iprName).toBe('')
    expect(fallback?.hold).toBeUndefined()
    expect(fallback?.arbitrated).toBeUndefined()
    expect(plain && limitMailProcIds(plain)).toEqual([proc3])
    expect(plain?.contacts).toBeUndefined()
    expect(plain?.iprName).toBe('雷群安')
    expect(forced.items.every(item => item.mailStyle === '1')).toBe(true)
    expect(forced.items.flatMap(limitMailProcIds).sort()).toEqual([proc, proc2, proc3].sort())
  })

  it('草稿建出来时预填的档案杂值不写进收件人，地址按写回值整列重写', async () => {
    const savedTo = { value: '' }
    const savedCc = { value: '' }
    const dirty = mailInfo()
    const row = dirty.MailInfo?.[0]
    if (!row) throw new Error('mailInfo 需要 MailInfo 行')
    row.mail_to = 'Archiv69@163.com;38199642@qq.com;'
    row.mail_cc = 'chenjch02@pcl.ac.cn;'
    const result = await submitLimitMailBatch(transport({
      limitMailCustomer: () => ({ ClientInfo: client(), objid: mail }),
      ...contacts(),
      getMailInfo: () => dirty,
      saveMailInfo: params => {
        savedTo.value = params.get('mail_to') ?? ''
        savedCc.value = params.get('mail_cc') ?? ''
        return { ClientInfo: client({ Result: false, Status: true }) }
      },
      getFlowInfo: () => flowInfo(),
      getFlowSubmit: () => nodes([user]),
      getUrgencyList: () => ({ ClientInfo: client(), UrgencyList: [{ urgency_id: urgency, urgency_code: 'CM', urgency_name: '普通', seq: 1 }] }),
      getFlowLastStatus: () => ({ ClientInfo: client(), last_status: null }),
      mailSubmit: () => ({ ClientInfo: client({ Result: true }) })
    }, []), user, [draft()])
    expect(result.results[0]?.state).toBe('submitted')
    expect(decodeURIComponent(savedTo.value)).toBe('雷工(ipr@example.com);')
    expect(decodeURIComponent(savedCc.value)).toBe('商务甲(sales@example.com);')
  })

  it('同一文号两行按处理事项精确对行，文号去空格比较，客户文号也能对上', () => {
    const procRemind = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2'
    const procNational = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab3'
    const otherType = 'bbbbbbbb-4bbb-4bbb-8bbb-bbbbbbbbbbbb'
    const rows = [
      { procId: procRemind, caseVolume: 'PA1', ctrlProc: '提醒申请PCT' },
      { procId: procNational, caseVolume: ' PA1 ', ctrlProc: '进国家' }
    ]
    const sheetRows = [
      { ourVolume: 'PA1', procLabel: '提醒申请PCT', mailTypeId: mailType, customerName: '甲客户', iprName: '雷工' },
      { ourVolume: 'PA1', procLabel: '进国家', mailTypeId: otherType, customerName: '甲客户', iprName: '韩玉奎' }
    ]
    const planned = limitMailItems({ procIds: [procRemind, procNational], rows, sheetRows, mode: 'ipr' })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const remind = planned.items.find(item => item.procId === procRemind)
    const national = planned.items.find(item => item.procId === procNational)
    expect(remind?.iprName).toBe('雷工')
    expect(remind?.mailTypeId).toBe(mailType)
    expect(national?.iprName).toBe('韩玉奎')
    expect(national?.mailTypeId).toBe(otherType)

    const byCustomerVolume = limitMailItems({
      procIds: [procRemind],
      rows: [{ procId: procRemind, caseVolume: 'K1' }],
      sheetRows: [{ ourVolume: 'PA1', customerVolume: 'K1', mailTypeId: mailType, customerName: '甲客户', iprName: '雷工' }],
      mode: 'ipr'
    })
    expect(byCustomerVolume.ok && byCustomerVolume.items[0]?.iprName).toBe('雷工')
  })

  it('lead 模式按钮分叉看技术负责人，ipr 模式看 IPR', () => {
    const limit = [
      { procId: 'p-lead-ok', caseVolume: 'PA1', ctrlProc: '提醒申请PCT' },
      { procId: 'p-lead-missing', caseVolume: 'PA2', ctrlProc: '提醒申请PCT' }
    ]
    const sheet = [
      { ourVolume: 'PA1', procLabel: '提醒申请PCT', iprName: '', leadName: '王工' },
      { ourVolume: 'PA2', procLabel: '提醒申请PCT', iprName: '雷群安', leadName: '' }
    ]
    expect(selectionNeedsAddressChoice(limit, sheet, [], undefined, 'lead')).toBe(true)
    expect(selectionNeedsAddressChoice(limit, sheet, ['p-lead-ok'], undefined, 'lead')).toBe(false)
    expect(selectionNeedsAddressChoice(limit, sheet, ['p-lead-missing'], undefined, 'lead')).toBe(true)
    expect(selectionNeedsAddressChoice(limit, sheet, [], undefined, 'ipr')).toBe(true)
    expect(selectionNeedsAddressChoice(limit, sheet, ['p-lead-ok'], undefined, 'ipr')).toBe(true)
    expect(selectionNeedsAddressChoice(limit, sheet, ['p-lead-missing'], undefined, 'ipr')).toBe(false)
  })

  it('合并按钮在技术负责人模式也兜底：没有负责人的行走全选', () => {
    const rows = [{ procId: proc, caseVolume: 'PA1' }]
    const sheetRows = [{ ourVolume: 'PA1', mailTypeId: mailType, customerName: '甲客户', iprName: '', leadName: '' }]
    const merged = limitMailItems({ procIds: [proc], rows, sheetRows, mode: 'lead', address: 'auto' })
    expect(merged.ok).toBe(true)
    if (merged.ok) expect(merged.items[0]?.contacts).toBe('all')
  })
})
