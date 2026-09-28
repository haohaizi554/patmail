import { describe, expect, it, vi } from 'vitest'
import { EasyTransport } from '../src/api/transport'
import { productionGate, type MailWriteGate } from '../src/mail/easy/gate'
import { MailExecutionRuntime, type SelectionClaim } from '../src/mail/easy/runtime'
import { ExecutionStore, MemoryExecutionStore } from '../src/mail/easy/store'
import { selectionFingerprint } from '../src/mail/fingerprint'
import { planDrafts } from '../src/mail'
import type { MailDraftPreview, MailRuleBundle, SelectedPatentFile } from '../src/mail/types'
import type { CustomerQueryProfile } from '../src/customer/types'
import { productionWorkflowGate } from '../src/workflow/gate'
import { buildEndEmailFlow, buildFlowSubmit } from '../src/workflow/submit-builder'
import { readFlowHistory, readFlowSubmit, readUrgency, versionAgrees } from '../src/workflow/contracts'
import { MemoryWorkflowStore } from '../src/workflow/store'
import { WorkflowRuntime } from '../src/workflow/runtime'

const origin = 'http://183.36.43.66:88'
const guid = (suffix: string) => `${suffix}-1111-4111-8111-111111111111`
const user = guid('aaaaaaaa')
const other = guid('bbbbbbbb')
const mailType = guid('cccccccc')
const customerId = guid('b0f4c252')
const mailsetId = guid('1b46f503')
const fileA = guid('11111111')
const mailId = guid('083aa041')
const flowId = guid('f10f10f1')
const nextNode = guid('d0d0d0d0')
const otherNode = guid('e1e1e1e1')
const urgency = guid('e0e0e0e0')
const client = { ClientInfo: { IsLogin: true, Status: true, Result: false, Message: null } }
const openGate: MailWriteGate = { blockers: () => [], relatedFileIds: ids => ids.join(';') }
const mockPage = { score: '0', finishDate: '2026-09-26', picUser: '', intDueDate: '', cusDueDate: '', legDueDate: '', source: 'mock-page' as const }

function selected(id: string): SelectedPatentFile {
  return {
    fileId: id, fileName: `文件${id.slice(0, 8)}`, fileDescription: '专利证书', customerName: '客户A', customerProfileId: 'profile-a',
    customerBinding: { profileId: 'profile-a', profileName: '客户A', sourceCustomerName: '客户A', confirmed: true, source: 'explicit' }
  }
}
function rules(): MailRuleBundle {
  return {
    version: 1, revision: 2, ownerId: user,
    policies: [{ customerProfileId: 'profile-a', sendMode: 'merge_by_customer_description', enabled: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
    mappings: [{ id: 'map-1', fileDescriptionText: '专利证书', mailTypeId: mailType, mailTypeName: '证书通知', enabled: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
    recipients: [{ id: 'to', customerProfileId: 'profile-a', name: '默认', to: ['a@example.com'], cc: [], enabled: true, isDefault: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
    signatures: [],
    subject: { template: '关于{文件名称}的通知', countInjection: false, anchor: '关于', missingAnchor: 'keep', version: 1 },
    body: { template: '请查收{文件数量}个文件。', supplement: '', version: 1 },
    defaultReviewer: null,
    defaultSender: null
  }
}
function profile(): CustomerQueryProfile {
  return { id: 'profile-a', name: '客户A', baseTemplateId: 'base', overrides: {}, enabled: true, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' }
}
function claimOf(preview: MailDraftPreview): SelectionClaim {
  return { files: preview.files, revision: rules().revision }
}
function previewOf(files: SelectedPatentFile[]): MailDraftPreview {
  const bundle = rules()
  const snapshot = { selectedAt: '2026-09-24T00:00:00.000Z', files, configVersion: bundle.revision, userId: user, origin, fingerprint: '' }
  snapshot.fingerprint = selectionFingerprint({ files, revision: bundle.revision, userId: user, origin })
  const draft = planDrafts(snapshot, bundle, [profile()], user)[0]
  if (!draft) throw new Error('missing draft')
  return draft
}
function mailRow(subject = '原主题') {
  return {
    mail_id: mailId, mail_type_id: mailType, mail_type: '证书通知', customer_id: customerId, customer_name: '客户A',
    mailset_id: mailsetId, mail_subject: subject, mail_body: '原正文', mail_to: '', mail_cc: '', mail_bcc: '',
    subject_desc: '', mail_tags: '', is_zip: '0', zip_pwd: '', rename_zip: '', reply_date: '', proc_ids: '',
    express_id: '', message_id: '', finish_ctrl_proc: ''
  }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function flowRow(token = '', node = '', status = -1) {
  return {
    obj_id: mailId, flow_id: flowId, flow_type: 'CO', flow_sub_type: '', cur_node_id: node, node_code: node ? 'REV' : 'STA',
    node_name_zh_cn: node ? '审核' : '开始', status, dept_id: 'base', dept_full_name: '', cur_user_id: user, cn_name: '本人',
    is_skip: false, is_enabled: true, urgency_id: urgency, update_time: '', update_time_dd: '', update_time_mm: '', update_time_ss: token, user_list: ''
  }
}
function historyBody() {
  return {
    ...client,
    Result: [{ history_id: 'h1', node_id: otherNode, node_code: 'OLD', node_name_zh_cn: '历史节点', audit_user_id: other, audit_cn_name: '他人', audit_type_zh_cn: '提交', audit_time: '2026-09-01', remark: '历史备注' }],
    flow_activity: { node_id: '', node_code: 'STA', node_name: '开始', status: -1, allow_edit: true, audit_user_id: user, audit_cn_name: '本人' }
  }
}
function urgencyBody() {
  return { ...client, UrgencyList: [{ urgency_id: urgency, urgency_code: '01', urgency_name: '普通', seq: 1 }] }
}
function node(id: string, people: Array<{ user_id: string; cn_name: string }>, extra: Record<string, unknown> = {}) {
  return {
    list_id: 'L1', seq: 1, next: id, node_id: id, node_code: 'REV', node_name_zh_cn: '审核', allow_skip: false,
    user_type: 'U', user_list: people, need_all_audit: 0, is_parallel: 0, ...extra
  }
}
function submitBody(rows: unknown[]) {
  return { ...client, flow_type_name: '发文', Result: rows }
}

function mailFetcher(mode: 'stable' | 'changed' | 'hold'): typeof fetch {
  let infoReads = 0
  let held = false
  return async (_url, init) => {
    const call = new URLSearchParams(String(init?.body)).get('Call')
    if (call === 'MailCustomer') {
      if (mode === 'hold' && !held) {
        held = true
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        })
      }
      return json({ ...client, objid: mailId })
    }
    if (call === 'GetMailInfo') {
      infoReads += 1
      return json({ ...client, MailInfo: [mailRow(mode === 'changed' && infoReads > 1 ? '已改主题' : '原主题')] })
    }
    if (call === 'GetCustomerContact') return json({ ...client, CustomerContact: [{ contact_name: '张三', email: 'a@example.com' }] })
    if (call === 'GetMailFile') return json({ ...client, TableRows: [{ file_id: fileA, file_name: '文件' }], TableRowsCount: '1' })
    if (call === 'GetMailCase') return json({ ...client, TableRows: [], TableRowsCount: '0' })
    if (call === 'MailinfoInit' || call === 'GetSignature' || call === 'GetMailRule') return json(client)
    if (call === 'SaveMailInfo') return json({ ...client, ClientInfo: { ...client.ClientInfo, Status: true } })
    return json(client)
  }
}

describe('Phase 2.5 收口', () => {
  it('shows the real diff before save and stops when a reread changes it', async () => {
    const calls: string[] = []
    const readMail = mailFetcher('changed')
    const runtime = new MailExecutionRuntime(new EasyTransport(origin, {
      fetcher: async (url, init) => {
        calls.push(new URLSearchParams(String(init?.body)).get('Call') ?? '')
        return readMail(url, init)
      }
    }), new MemoryExecutionStore(), openGate, origin)
    const preview = previewOf([selected(fileA)])
    const created = await runtime.create(user, preview, claimOf(preview))
    expect(created.record.state).toBe('MAIL_LOADED')
    expect(created.diffs.some(item => item.field === 'mail_subject' && item.easyValue === '原主题' && item.planValue && item.source)).toBe(true)
    expect(created.record.diffDigest.length).toBeGreaterThan(0)
    const saved = await runtime.save(user, created.record.executionId, preview, claimOf(preview), created.record.diffDigest)
    expect(saved.record.state).toBe('MAIL_LOADED')
    expect(saved.blockers.join('')).toContain('差异已变化')
    expect(saved.diffs.some(item => item.easyValue === '已改主题')).toBe(true)
    expect(calls.filter(call => call === 'SaveMailInfo')).toHaveLength(0)
  })

  it('recomputes the fingerprint from the current selection instead of a caller string', async () => {
    const fetcher = vi.fn<typeof fetch>(mailFetcher('stable'))
    const runtime = new MailExecutionRuntime(new EasyTransport(origin, { fetcher }), new MemoryExecutionStore(), openGate, origin)
    const preview = previewOf([selected(fileA)])
    const renamed: SelectionClaim = { files: preview.files.map(file => ({ ...file, fileName: '另一份' })), revision: rules().revision }
    const mismatch = await runtime.create(user, preview, renamed)
    expect(mismatch.record.requestSent).toBe(false)
    expect(mismatch.blockers.join('')).toContain('预览已失效')
    const lied = { ...preview, fingerprint: 'caller-supplied' }
    expect((await runtime.create(user, lied, claimOf(preview))).record.requestSent).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('lets one fingerprint enter MailCustomer only once in the same runtime', async () => {
    let creates = 0
    let release: () => void = () => {}
    const wait = new Promise<void>(resolve => { release = resolve })
    const fetcher: typeof fetch = async (url, init) => {
      const call = new URLSearchParams(String(init?.body)).get('Call')
      if (call === 'MailCustomer') {
        creates += 1
        if (creates === 1) await wait
      }
      return mailFetcher('stable')(url, init)
    }
    const runtime = new MailExecutionRuntime(new EasyTransport(origin, { fetcher }), new MemoryExecutionStore(), openGate, origin)
    const preview = previewOf([selected(fileA)])
    const first = runtime.create(user, preview, claimOf(preview))
    await vi.waitFor(() => expect(creates).toBe(1))
    const second = runtime.create(user, preview, claimOf(preview))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(creates).toBe(1)
    release()
    const [left, right] = await Promise.all([first, second])
    expect(creates).toBe(1)
    expect([left.record.executionId, right.record.executionId]).toContain(left.record.executionId)
    expect(right.record.mailId === left.record.mailId || right.blockers.join('').includes('已有创建记录')).toBe(true)
  })

  it('cannot make chrome.storage atomic across two execution stores', async () => {
    let writes = 0
    let release: () => void = () => {}
    const wait = new Promise<void>(resolve => { release = resolve })
    const area = {
      data: {} as Record<string, unknown>,
      async get(key: string) { return { [key]: this.data[key] } },
      async set(items: Record<string, unknown>) {
        writes += 1
        if (writes === 1) await wait
        Object.assign(this.data, items)
      }
    }
    let creates = 0
    const fetcher: typeof fetch = async (url, init) => {
      const call = new URLSearchParams(String(init?.body)).get('Call')
      if (call === 'MailCustomer') creates += 1
      return mailFetcher('stable')(url, init)
    }
    const left = new MailExecutionRuntime(new EasyTransport(origin, { fetcher }), new ExecutionStore(area), openGate, origin)
    const right = new MailExecutionRuntime(new EasyTransport(origin, { fetcher }), new ExecutionStore(area), openGate, origin)
    const preview = previewOf([selected(fileA)])
    const first = left.create(user, preview, claimOf(preview))
    await vi.waitFor(() => expect(writes).toBe(1))
    const second = right.create(user, preview, claimOf(preview))
    await vi.waitFor(() => expect(creates).toBe(1))
    release()
    await Promise.all([first, second])
    expect(creates).toBe(2)
    expect(productionGate.blockers('merge_by_customer_description').length).toBeGreaterThan(0)
    expect(productionWorkflowGate.blockers().join('')).toContain('跨标签页')
  })
})

describe('流程读取', () => {
  function flowFetcher(options: { info?: unknown; status?: number; nodes?: unknown[]; last?: unknown } = {}): typeof fetch {
    return async (_url, init) => {
      if (options.status) return json({ ...client }, options.status)
      const params = new URLSearchParams(String(init?.body))
      const call = params.get('Call')
      if (call === 'GetFlowInfo') {
        expect(params.get('flow_type')).toBe('CO')
        return json({ ...client, Result: options.info ?? flowRow() })
      }
      if (call === 'GetFlowHistory') return json(historyBody())
      if (call === 'GetUrgencyList') return json(urgencyBody())
      if (call === 'GetFlowSubmit') return json(submitBody(options.nodes ?? [node(nextNode, [{ user_id: user, cn_name: '本人' }])]))
      if (call === 'GetFlowLastStatus') return json({ ...client, last_status: options.last === undefined ? null : options.last })
      return json(client)
    }
  }
  function runtime(fetcher: typeof fetch, verified = true, mock?: (params: Record<string, string>) => Promise<{ status: 'accepted' | 'rejected' | 'unknown' }>) {
    return new WorkflowRuntime(new EasyTransport(origin, { fetcher }), new MemoryWorkflowStore(), { blockers: () => [] }, origin, async () => verified, { mockSubmit: mock })
  }

  it('reads flow info, history, urgency and keeps history apart from the current activity', async () => {
    const opened = runtime(flowFetcher())
    const view = await opened.read(user, mailId, 'CO')
    expect(view.record.status).toBe('READY')
    expect(view.snapshot?.flowType).toBe('CO')
    expect(view.snapshot?.versionToken).toBeNull()
    expect(view.snapshot?.history[0]?.nodeId).toBe(otherNode)
    expect(view.snapshot?.activity?.nodeCode).toBe('STA')
    expect(view.snapshot?.activity?.nodeId).not.toBe(view.snapshot?.history[0]?.nodeId)
    expect(view.snapshot?.urgencies[0]?.name).toBe('普通')
    expect(view.snapshot?.submitContract).toBe('unverified')
    const urgency = readUrgency({ ClientInfo: { IsLogin: true, Status: true, Result: false }, UrgencyList: urgencyBody().UrgencyList })
    expect(urgency.ok && urgency.items).toHaveLength(1)
  })

  it('blocks an unverified mail and rejects empty, invalid, logged-out and gateway responses', async () => {
    const fetcher = vi.fn<typeof fetch>(flowFetcher())
    const blocked = await runtime(fetcher, false).read(user, mailId, 'CO')
    expect(blocked.record.status).toBe('BLOCKED')
    expect(blocked.blockers.join('')).toContain('文件关联')
    expect(fetcher).not.toHaveBeenCalled()
    const empty = await runtime(flowFetcher({ info: { obj_id: mailId, flow_id: '' } })).read(user, mailId, 'CO')
    expect(empty.record.status).toBe('BLOCKED')
    expect(empty.blockers.join('')).toContain('没有流程')
    const invalid = await runtime(flowFetcher({ info: [] })).read(user, mailId, 'CO')
    expect(invalid.record.status).toBe('FAILED')
    const loggedOut = await runtime(async () => json({ ClientInfo: { IsLogin: false, Status: false, Result: false } })).read(user, mailId, 'CO')
    expect(loggedOut.blockers.join('')).toContain('登录')
    const gateway = await runtime(flowFetcher({ status: 502 })).read(user, mailId, 'CO')
    expect(gateway.record.status).toBe('FAILED')
    expect(gateway.blockers.join('')).toContain('网关')
    const unavailable = await runtime(flowFetcher({ status: 503 })).read(user, mailId, 'CO')
    expect(unavailable.blockers.join('')).toContain('暂不可用')
  })

  it('does not choose the first node or a reviewer by name', async () => {
    const many = await runtime(flowFetcher({
      nodes: [node(nextNode, [{ user_id: user, cn_name: '本人' }]), node(otherNode, [{ user_id: user, cn_name: '本人' }])]
    })).read(user, mailId, 'CO')
    const choosing = await runtime(flowFetcher({
      nodes: [node(nextNode, [{ user_id: user, cn_name: '本人' }]), node(otherNode, [{ user_id: user, cn_name: '本人' }])]
    }))
    const opened = await choosing.read(user, mailId, 'CO')
    const pending = await choosing.preview(user, opened.record.executionId, { currentUserId: user, nodeId: '', reviewerId: '', auditType: 'submit', remark: '', urgencyId: urgency, pageFields: mockPage })
    expect(pending.record.status).toBe('SELECTING_NODE')
    expect(pending.record.nextNodeId).toBe('')
    expect(many.snapshot?.availableNodes).toHaveLength(2)
    const names = node(nextNode, [{ user_id: user, cn_name: '同名' }, { user_id: other, cn_name: '同名' }])
    const named = await runtime(flowFetcher({ nodes: [names] })).read(user, mailId, 'CO')
    const duplicate = await runtime(flowFetcher({ nodes: [names] }))
    const loaded = await duplicate.read(user, mailId, 'CO')
    const held = await duplicate.preview(user, loaded.record.executionId, { currentUserId: user, nodeId: '', reviewerId: '', auditType: 'submit', remark: '', urgencyId: urgency, pageFields: mockPage })
    expect(held.blockers.join('')).toContain('同名')
    const outsider = node(nextNode, [{ user_id: other, cn_name: '本人' }])
    const missingUser = await runtime(flowFetcher({ nodes: [outsider] }))
    const openedOutsider = await missingUser.read(user, mailId, 'CO')
    const refused = await missingUser.preview(user, openedOutsider.record.executionId, { currentUserId: user, nodeId: '', reviewerId: '', auditType: 'submit', remark: '', urgencyId: urgency, pageFields: mockPage })
    expect(refused.record.status).toBe('BLOCKED')
    expect(refused.blockers.join('')).toContain('不在候选')
    const parsed = readFlowSubmit(submitBody([{ node_id: nextNode, node_code: 'REV', node_name_zh_cn: '审核', user_list_name: '只有姓名' }]))
    expect(parsed.ok && parsed.nodes[0]?.reviewerFormat).toBe('unknown')
    const history = readFlowHistory(historyBody())
    expect(history.ok && history.history[0]?.nodeName).toBe('历史节点')
    expect(history.ok && history.activity?.nodeName).toBe('开始')
  })

  it('builds a mock submit, rejects a stale version, and does not retry an unknown result', async () => {
    let infoReads = 0
    let submits = 0
    const fetcher: typeof fetch = async (_url, init) => {
      const call = new URLSearchParams(String(init?.body)).get('Call')
      if (call === 'GetFlowInfo') {
        infoReads += 1
        const moved = infoReads >= 3
        return json({ ...client, Result: flowRow('A', moved ? nextNode : '', moved ? 1000 : -1) })
      }
      if (call === 'GetFlowHistory') return json(historyBody())
      if (call === 'GetUrgencyList') return json(urgencyBody())
      if (call === 'GetFlowSubmit') return json(submitBody([node(nextNode, [{ user_id: user, cn_name: '本人' }])]))
      if (call === 'GetFlowLastStatus') return json({ ...client, last_status: null })
      return json(client)
    }
    const flow = runtime(fetcher, true, async params => {
      submits += 1
      expect(params.f_obj_id).toBe(mailId)
      expect(params.f_flow_id).toBe(flowId)
      expect(params.f_next_node_id).toBe(nextNode)
      expect(params.f_next_user_id).toBe(user)
      expect(params.f_audit_type_id).toBe('submit')
      expect(params.f_status).toBe('1000')
      return { status: 'accepted' }
    })
    const opened = await flow.read(user, mailId, 'CO')
    const preview = await flow.preview(user, opened.record.executionId, { currentUserId: 'ignored', nodeId: '', reviewerId: '', auditType: 'submit', remark: '备注', urgencyId: urgency, pageFields: mockPage })
    expect(preview.record.status).toBe('CONFIRM_REQUIRED')
    expect(preview.plan?.self).toBe(true)
    expect(preview.plan?.params?.f_flow_type).toBe('CO')
    const done = await flow.submit(user, preview.record.executionId, true)
    expect(done.record.status).toBe('COMPLETED')
    expect(done.blockers.join('')).toContain('不是 EASY 真实提交')
    expect(submits).toBe(1)
    expect(versionAgrees(-1, null, false, null)).toBe('match')
    expect(versionAgrees(1000, 'A', true, 'B')).toBe('stale')
    expect(buildEndEmailFlow().params).toBeNull()

    let checks = 0
    const staleFetcher: typeof fetch = async (_url, init) => {
      const call = new URLSearchParams(String(init?.body)).get('Call')
      if (call === 'GetFlowInfo') {
        checks += 1
        return json({ ...client, Result: flowRow(checks === 1 ? 'A' : 'B', '', 1000) })
      }
      if (call === 'GetFlowHistory') return json(historyBody())
      if (call === 'GetUrgencyList') return json(urgencyBody())
      if (call === 'GetFlowSubmit') return json(submitBody([node(nextNode, [{ user_id: user, cn_name: '本人' }])]))
      if (call === 'GetFlowLastStatus') return json({ ...client, last_status: { update_time_ss: 'B' } })
      return json(client)
    }
    let staleSubmits = 0
    const stale = runtime(staleFetcher, true, async () => { staleSubmits += 1; return { status: 'accepted' } })
    const staleOpened = await stale.read(user, mailId, 'CO')
    const stalePreview = await stale.preview(user, staleOpened.record.executionId, { currentUserId: user, nodeId: '', reviewerId: '', auditType: 'handover', remark: '', urgencyId: urgency, pageFields: mockPage })
    const staleResult = await stale.submit(user, stalePreview.record.executionId, true)
    expect(staleResult.record.status).toBe('STALE')
    expect(staleResult.record.nextNodeId).toBe('')
    expect(staleSubmits).toBe(0)

    let unknownCalls = 0
    const unknownFlow = runtime(flowFetcher(), true, async () => { unknownCalls += 1; return { status: 'unknown' } })
    const unknownOpened = await unknownFlow.read(user, mailId, 'CO')
    const unknownPreview = await unknownFlow.preview(user, unknownOpened.record.executionId, { currentUserId: user, nodeId: '', reviewerId: '', auditType: 'submit', remark: '', urgencyId: urgency, pageFields: mockPage })
    const unknown = await unknownFlow.submit(user, unknownPreview.record.executionId, true)
    expect(unknown.record.status).toBe('UNKNOWN')
    expect(unknown.record.requestSent).toBe(true)
    const again = await unknownFlow.submit(user, unknown.record.executionId, true)
    expect(again.record.status).toBe('UNKNOWN')
    expect(unknownCalls).toBe(1)
    const closed = new WorkflowRuntime(new EasyTransport(origin, { fetcher: flowFetcher() }), new MemoryWorkflowStore(), productionWorkflowGate, origin, async () => true)
    const closedOpened = await closed.read(user, mailId, 'CO')
    const closedPreview = await closed.preview(user, closedOpened.record.executionId, { currentUserId: user, nodeId: '', reviewerId: '', auditType: 'submit', remark: '', urgencyId: urgency, pageFields: null })
    expect(closedPreview.plan?.params).toBeNull()
    const closedSubmit = await closed.submit(user, closedPreview.record.executionId, true)
    expect(closedSubmit.record.requestSent).toBe(false)
    expect(closedSubmit.blockers.join('')).toContain('尚未开放')
    const parallel = node(nextNode, [{ user_id: user, cn_name: '本人' }], { is_parallel: 1, need_all_audit: 1 })
    const flags = buildFlowSubmit({
      snapshot: { ...(closedOpened.snapshot ?? { mailId, flowId, flowType: 'CO', flowSubType: '', currentNodeId: '', currentNodeCode: 'STA', currentNodeName: '开始', status: -1, currentUserId: user, currentUserName: '本人', urgencyId: urgency, versionToken: null, deptId: 'base', allowEdit: true, availableNodes: [], submitContract: 'unverified', history: [], activity: null, urgencies: [] }), availableNodes: [] },
      node: { listId: 'L1', seq: 1, next: nextNode, nodeId: nextNode, nodeCode: 'REV', nodeName: '审核', allowSkip: false, userType: 'U', parallel: true, needAllAudit: true, reviewers: [{ id: user, name: '本人' }], reviewerFormat: 'structured' },
      reviewer: { id: user, name: '本人' }, auditType: 'submit', remark: '', urgencyId: urgency, pageFields: mockPage
    })
    expect(flags.params).toBeNull()
    expect(flags.blockers.join('')).toContain('并行')
    expect(flags.blockers.join('')).toContain('全部审核')
    expect(parallel.node_id).toBe(nextNode)
  })
})
