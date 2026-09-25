import { describe, expect, it, vi } from 'vitest'
import { EasyRuntime } from '../src/api/client'
import { EasyTransport } from '../src/api/transport'
import { adaptMailDraft } from '../src/mail/easy/adapter'
import { buildMailCustomerParams, formatRecipientList, readMailCustomer, saveParams } from '../src/mail/easy/contracts'
import { productionGate, type MailWriteGate } from '../src/mail/easy/gate'
import { EasyMailReadService } from '../src/mail/easy/read-service'
import { MailExecutionRuntime } from '../src/mail/easy/runtime'
import { blocksAnotherCreate, nextState } from '../src/mail/easy/state'
import { MemoryExecutionStore } from '../src/mail/easy/store'
import type { EasyMailSnapshot, MailExecutionRecord } from '../src/mail/easy/types'
import { selectionFingerprint } from '../src/mail/fingerprint'
import { planDrafts, planMailGroups, reviewCustomerBind, applyConfirmedBind, upsertMapping } from '../src/mail'
import type { MailDraftPreview, MailRuleBundle, SelectedPatentFile } from '../src/mail/types'
import { isMessage } from '../src/shared/message'
import type { CustomerQueryProfile } from '../src/customer/types'

const origin = 'http://183.36.43.66:88'
const guid = (suffix: string) => `${suffix}-1111-4111-8111-111111111111`
const user = guid('aaaaaaaa')
const mailType = guid('cccccccc')
const customerId = guid('b0f4c252')
const mailsetId = guid('1b46f503')
const fileA = guid('11111111')
const fileB = guid('22222222')
const mailId = guid('083aa041')
const client = { ClientInfo: { IsLogin: true, Status: true, Result: false, Message: null } }
const openGate: MailWriteGate = { blockers: () => [], relatedFileIds: ids => ids.join(';') }
const saveWithoutBind: MailWriteGate = { blockers: () => [], relatedFileIds: () => null }

function selected(id: string, source = '客户A'): SelectedPatentFile {
  return {
    fileId: id, fileName: `文件${id.slice(0, 8)}`, fileDescription: '专利证书', customerName: source, customerProfileId: 'profile-a',
    customerBinding: { profileId: 'profile-a', profileName: '客户A', sourceCustomerName: source, confirmed: true, source: 'explicit' }
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
    body: { template: '请查收{文件数量}个文件。', supplement: '', version: 1 }
  }
}
function profile(): CustomerQueryProfile {
  return { id: 'profile-a', name: '客户A', baseTemplateId: 'base', overrides: {}, enabled: true, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' }
}
function previewOf(files: SelectedPatentFile[], bundle = rules()): MailDraftPreview {
  const snapshot = { selectedAt: '2026-09-24T00:00:00.000Z', files, configVersion: bundle.revision, userId: user, origin, fingerprint: '' }
  snapshot.fingerprint = selectionFingerprint({ files, revision: bundle.revision, userId: user, origin })
  const drafts = planDrafts(snapshot, bundle, [profile()], user)
  const draft = drafts[0]
  if (!draft) throw new Error('missing draft')
  return draft
}
function mailRow(extra: Record<string, unknown> = {}) {
  return {
    mail_id: mailId, mail_type_id: mailType, mail_type: '证书通知', customer_id: customerId, customer_name: '客户A',
    mailset_id: mailsetId, mail_subject: '原主题', mail_body: '原正文', mail_to: '', mail_cc: '', mail_bcc: '',
    subject_desc: '', mail_tags: '', is_zip: '0', zip_pwd: '', rename_zip: '', reply_date: '', proc_ids: '',
    express_id: '', message_id: '', finish_ctrl_proc: '', ...extra
  }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}
function callsOf(bodies: string[]): string[] {
  return bodies.map(body => new URLSearchParams(body).get('Call') ?? '')
}

describe('客户身份和映射', () => {
  it('does not merge different confirmed customers or conflicting mappings', () => {
    const files = [selected(fileA, '甲客户'), selected(fileB, '乙客户')]
    const grouped = planMailGroups(files, rules().policies)
    expect(grouped.groups).toHaveLength(2)
    const review = reviewCustomerBind(files, 'profile-a', '客户A')
    expect(review.every(group => group.nameMatches)).toBe(false)
    const unbound = { ...files[1]!, customerProfileId: undefined, customerBinding: undefined }
    const bound = applyConfirmedBind({ [fileA]: { ...files[0]!, customerBinding: undefined }, [fileB]: unbound }, 'profile-a', '客户A', ['甲客户'])
    expect(bound[fileA]?.customerBinding?.confirmed).toBe(true)
    expect(bound[fileB]?.customerBinding).toBeUndefined()
    const conflict = [
      rules().mappings[0]!,
      { ...rules().mappings[0]!, id: 'map-2', mailTypeId: guid('dddddddd'), mailTypeName: '另一类型' }
    ]
    const blocked = previewOf([selected(fileA)], { ...rules(), mappings: conflict })
    expect(blocked.status).toBe('blocked')
    expect(blocked.mailTypeId).toBe('')
    expect(blocked.issues.some(issue => issue.code === 'MAPPING_CONFLICT')).toBe(true)
    const kept = upsertMapping(conflict, { ...conflict[1]!, mailTypeId: guid('eeeeeeee') })
    expect(kept.ok).toBe(false)
    const edited = upsertMapping([conflict[0]!], { ...conflict[0]!, enabled: false })
    expect(edited.ok && edited.mappings[0]?.version).toBe(2)
    const before = selectionFingerprint({ files: [selected(fileA)], revision: 2, userId: user, origin })
    const after = selectionFingerprint({ files: [selected(fileA, '乙客户')], revision: 3, userId: guid('bbbbbbbb'), origin: 'http://other' })
    expect(before).not.toBe(after)
  })
})

describe('创建契约', () => {
  it('builds merge requests in file order and refuses an unconfirmed single send', () => {
    const preview = previewOf([selected(fileB), selected(fileA)])
    const params = buildMailCustomerParams(preview)
    expect(params.ok).toBe(true)
    if (!params.ok) return
    expect(params.params.get('Call')).toBe('MailCustomer')
    expect(params.params.get('mailstyle')).toBe('1')
    expect(params.params.get('mailtype')).toBe(mailType)
    expect(params.params.get('_file_ids')?.split(';')).toEqual([fileA, fileB])
    expect(params.params.get('_file_names')?.split(';')).toHaveLength(2)
    expect(buildMailCustomerParams({ ...preview, sendMode: 'single_file' }).ok).toBe(false)
    expect(buildMailCustomerParams({ ...preview, fileIds: [fileA] }).ok).toBe(false)
    expect(readMailCustomer({ ...client, objid: mailId })).toMatchObject({ status: 'ok', data: { mailId } })
    expect(readMailCustomer({ ...client }).status).toBe('unknown')
  })

  it('does not call EASY when the production gate is closed', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const runtime = new MailExecutionRuntime(new EasyTransport(origin, { fetcher }), new MemoryExecutionStore(), productionGate, origin)
    const preview = previewOf([selected(fileA)])
    const first = await runtime.create(user, preview, preview.fingerprint)
    expect(first.record.state).toBe('CONFIRM_REQUIRED')
    expect(first.record.requestSent).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
    const single = previewOf([selected(fileA)], { ...rules(), policies: [{ ...rules().policies[0]!, sendMode: 'single_file' }] })
    expect((await runtime.create(user, single, single.fingerprint)).blockers.join('')).toContain('mailstyle')
  })

  it('keeps an unknown create from being sent again', async () => {
    const bodies: string[] = []
    const fetcher: typeof fetch = async (_url, init) => {
      bodies.push(String(init?.body))
      const call = new URLSearchParams(String(init?.body)).get('Call')
      if (call === 'MailCustomer') return json({ ...client, ClientInfo: { ...client.ClientInfo, Status: true } })
      return json(client)
    }
    const runtime = new MailExecutionRuntime(new EasyTransport(origin, { fetcher }), new MemoryExecutionStore(), openGate, origin)
    const preview = previewOf([selected(fileA)])
    const created = await runtime.create(user, preview, preview.fingerprint)
    expect(created.record.state).toBe('UNKNOWN')
    expect(created.record.requestSent).toBe(true)
    const again = await runtime.create(user, preview, preview.fingerprint)
    expect(again.record.executionId).toBe(created.record.executionId)
    expect(callsOf(bodies).filter(call => call === 'MailCustomer')).toHaveLength(1)
  })

  it('treats a lost response as unknown and retains the mail id after a later read failure', async () => {
    let createCalls = 0
    const fetcher: typeof fetch = async (_url, init) => {
      const call = new URLSearchParams(String(init?.body)).get('Call')
      if (call === 'MailCustomer') {
        createCalls += 1
        return json({ ...client, objid: mailId })
      }
      if (call === 'GetMailInfo') return json({ ...client, ClientInfo: { ...client.ClientInfo, IsLogin: false } })
      return json(client)
    }
    const runtime = new MailExecutionRuntime(new EasyTransport(origin, { fetcher }), new MemoryExecutionStore(), openGate, origin)
    const preview = previewOf([selected(fileA)])
    const created = await runtime.create(user, preview, preview.fingerprint)
    expect(created.record.state).toBe('FAILED')
    expect(created.record.mailId).toBe(mailId)
    expect(blocksAnotherCreate(created.record)).toBe(true)
    await runtime.create(user, preview, preview.fingerprint)
    expect(createCalls).toBe(1)
    const hanging: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    })
    const timed = new MailExecutionRuntime(new EasyTransport(origin, { fetcher: hanging, timeoutMs: 5 }), new MemoryExecutionStore(), openGate, origin)
    const timeout = await timed.create(user, preview, preview.fingerprint)
    expect(timeout.record.state).toBe('UNKNOWN')
    expect(timeout.record.requestSent).toBe(true)
  })
})

describe('邮件读取和保存', () => {
  function readySnapshot(files = [{ fileId: fileA, fileName: '文件' }]): EasyMailSnapshot {
    return {
      mailId, customerId: { state: 'known', value: customerId }, customerName: { state: 'known', value: '客户A' },
      mailTypeId: { state: 'known', value: mailType }, mailTypeName: { state: 'known', value: '证书通知' },
      mailsetId: { state: 'known', value: mailsetId }, subject: { state: 'known', value: '原主题' },
      body: { state: 'known', value: '原正文' }, to: { state: 'known', value: '' }, cc: { state: 'known', value: '' },
      bcc: { state: 'known', value: '' }, subjectDesc: { state: 'known', value: '' }, mailTags: { state: 'known', value: '' },
      isZip: { state: 'known', value: '0' }, zipPwd: { state: 'known', value: '' }, renameZip: { state: 'known', value: '' },
      replyDate: { state: 'known', value: '' }, procIds: { state: 'known', value: '' }, expressId: { state: 'known', value: '' },
      messageId: { state: 'known', value: '' }, finishCtrlProc: { state: 'known', value: '' },
      files, fileListState: 'known', cases: [], caseListState: 'known',
      contacts: [{ name: '张三', email: 'a@example.com' }], signature: { state: 'known', value: '签名' },
      ruleSubject: { state: 'known', value: '默认主题' }
    }
  }

  it('maps PatMail fields onto the save names and refuses a profile id or mismatched files', () => {
    const preview = previewOf([selected(fileA)])
    const draft = adaptMailDraft(preview, readySnapshot())
    expect(draft.canSave).toBe(true)
    expect(draft.fields.mail_type).toBe(mailType)
    expect(draft.fields.customer_id).toBe(customerId)
    expect(draft.fields.customer_id).not.toBe(preview.customerProfileId)
    expect(draft.fields.mail_to).toBe('张三(a@example.com);')
    expect(draft.fields.mail_subject).toBe(preview.subject)
    expect(saveParams(draft.fields as Parameters<typeof saveParams>[0]).get('Call')).toBe('SaveMailInfo')
    expect(saveParams(draft.fields as Parameters<typeof saveParams>[0]).get('mailtype')).toBeNull()
    const missingContact = adaptMailDraft(preview, { ...readySnapshot(), contacts: [] })
    expect(missingContact.canSave).toBe(false)
    const mismatched = adaptMailDraft(preview, readySnapshot([{ fileId: fileB, fileName: '其他' }]))
    expect(mismatched.diffs.find(item => item.field === 'files')?.blocksSave).toBe(true)
    const unknownMessage = adaptMailDraft(preview, { ...readySnapshot(), messageId: { state: 'unknown', value: null } })
    expect(unknownMessage.canSave).toBe(false)
    expect(formatRecipientList(['a@example.com'], []).blocked).toBe(true)
  })

  it('saves, binds, then verifies the file ids from a fresh read', async () => {
    const bodies: string[] = []
    const fetcher: typeof fetch = async (_url, init) => {
      const body = String(init?.body)
      bodies.push(body)
      const call = new URLSearchParams(body).get('Call')
      if (call === 'MailCustomer') return json({ ...client, objid: mailId })
      if (call === 'MailinfoInit') return json({ ...client, mail_id: mailId, mailsettinglist: [] })
      if (call === 'GetMailInfo') return json({ ...client, MailInfo: [mailRow()] })
      if (call === 'GetSignature') return json({ ...client, Signature: [{ signature_content: '签名' }] })
      if (call === 'GetMailRule') return json({ ...client, subject: { subject: '默认主题' } })
      if (call === 'GetCustomerContact') return json({ ...client, CustomerContact: [{ contact_name: '张三', email: 'a@example.com' }] })
      if (call === 'GetMailFile') return json({ ...client, TableRows: [{ file_id: fileA, file_name: '文件' }], TableRowsCount: '1' })
      if (call === 'GetMailCase') return json({ ...client, TableRows: [], TableRowsCount: '0' })
      if (call === 'SaveMailInfo') {
        expect(new URLSearchParams(body).get('mail_type')).toBe(mailType)
        expect(new URLSearchParams(body).get('customer_id')).toBe(customerId)
        return json({ ...client, ClientInfo: { ...client.ClientInfo, Status: true } })
      }
      if (call === 'SaveMailRalteCaseFile') {
        expect(new URLSearchParams(body).get('file_ids')).toBe(fileA)
        return json({ ...client, ClientInfo: { ...client.ClientInfo, Status: true } })
      }
      return json({ ClientInfo: { IsLogin: false } })
    }
    const store = new MemoryExecutionStore()
    const runtime = new MailExecutionRuntime(new EasyTransport(origin, { fetcher }), store, openGate, origin)
    const preview = previewOf([selected(fileA)])
    const created = await runtime.create(user, preview, preview.fingerprint)
    expect(created.record.state).toBe('MAIL_LOADED')
    expect(created.record.mailId).toBe(mailId)
    const saved = await runtime.save(user, created.record.executionId, preview, preview.fingerprint)
    expect(saved.record.state).toBe('COMPLETED')
    expect(saved.linkedFileIds).toEqual([fileA])
    expect(callsOf(bodies).filter(call => call === 'SaveMailRalteCaseFile')).toHaveLength(1)
  })

  it('does not bind files when save fails, is unknown, or the file id format is unconfirmed', async () => {
    const modes = ['fail', 'timeout', 'nobind'] as const
    for (const mode of modes) {
      const calls: string[] = []
      const fetcher: typeof fetch = async (_url, init) => {
        const call = new URLSearchParams(String(init?.body)).get('Call') ?? ''
        calls.push(call)
        if (mode === 'timeout' && call === 'SaveMailInfo') return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        })
        if (call === 'MailCustomer') return json({ ...client, objid: mailId })
        if (call === 'MailinfoInit') return json({ ...client, mailsettinglist: [] })
        if (call === 'GetMailInfo') return json({ ...client, MailInfo: [mailRow()] })
        if (call === 'GetSignature') return json(client)
        if (call === 'GetMailRule') return json(client)
        if (call === 'GetCustomerContact') return json({ ...client, CustomerContact: [{ contact_name: '张三', email: 'a@example.com' }] })
        if (call === 'GetMailFile') return json({ ...client, TableRows: [{ file_id: fileA, file_name: '文件' }], TableRowsCount: '1' })
        if (call === 'GetMailCase') return json({ ...client, TableRows: [], TableRowsCount: '0' })
        if (call === 'SaveMailInfo' && mode === 'fail') return json({ ...client, ClientInfo: { ...client.ClientInfo, Status: false, Message: '拒绝' } })
        if (call === 'SaveMailInfo') return json({ ...client, ClientInfo: { ...client.ClientInfo, Status: true } })
        return json(client)
      }
      const runtime = new MailExecutionRuntime(
        new EasyTransport(origin, { fetcher, timeoutMs: mode === 'timeout' ? 5 : 15000 }),
        new MemoryExecutionStore(), mode === 'nobind' ? saveWithoutBind : openGate, origin
      )
      const preview = previewOf([selected(fileA)])
      const created = await runtime.create(user, preview, preview.fingerprint)
      const saved = await runtime.save(user, created.record.executionId, preview, preview.fingerprint)
      expect(calls.filter(call => call === 'SaveMailRalteCaseFile')).toHaveLength(0)
      if (mode === 'fail') expect(saved.record.state).toBe('FAILED')
      if (mode === 'timeout') expect(saved.record.state).toBe('UNKNOWN')
      if (mode === 'nobind') expect(saved.record.state).toBe('SAVED')
      expect(saved.record.mailId).toBe(mailId)
    }
  })

  it('marks partial failure when the reread files do not match the plan', async () => {
    let fileReads = 0
    const fetcher: typeof fetch = async (_url, init) => {
      const call = new URLSearchParams(String(init?.body)).get('Call')
      if (call === 'MailCustomer') return json({ ...client, objid: mailId })
      if (call === 'GetMailInfo') return json({ ...client, MailInfo: [mailRow()] })
      if (call === 'MailinfoInit' || call === 'GetSignature' || call === 'GetMailRule') return json(client)
      if (call === 'GetCustomerContact') return json({ ...client, CustomerContact: [{ contact_name: '张三', email: 'a@example.com' }] })
      if (call === 'GetMailFile') {
        fileReads += 1
        const id = fileReads < 3 ? fileA : fileB
        return json({ ...client, TableRows: [{ file_id: id, file_name: '文件' }], TableRowsCount: '1' })
      }
      if (call === 'GetMailCase') return json({ ...client, TableRows: [], TableRowsCount: '0' })
      if (call === 'SaveMailInfo' || call === 'SaveMailRalteCaseFile') return json({ ...client, ClientInfo: { ...client.ClientInfo, Status: true } })
      return json(client)
    }
    const runtime = new MailExecutionRuntime(new EasyTransport(origin, { fetcher }), new MemoryExecutionStore(), openGate, origin)
    const preview = previewOf([selected(fileA)])
    const created = await runtime.create(user, preview, preview.fingerprint)
    expect(created.record.state).toBe('MAIL_LOADED')
    const saved = await runtime.save(user, created.record.executionId, preview, preview.fingerprint)
    expect(saved.record.state).toBe('PARTIAL_FAILURE')
    expect(saved.record.mailId).toBe(mailId)
  })

  it('rejects a mail read whose id or login state does not match', async () => {
    const wrongId = new EasyMailReadService(new EasyTransport(origin, {
      fetcher: async (_url, init) => {
        const call = new URLSearchParams(String(init?.body)).get('Call')
        if (call === 'MailinfoInit') return json(client)
        return json({ ...client, MailInfo: [mailRow({ mail_id: fileB })] })
      }
    }))
    expect((await wrongId.load(mailId)).ok).toBe(false)
    const loggedOut = new EasyMailReadService(new EasyTransport(origin, {
      fetcher: async () => json({ ClientInfo: { IsLogin: false, Status: false, Result: false } })
    }))
    expect((await loggedOut.load(mailId)).ok).toBe(false)
    expect(nextState('SAVED', 'BIND_STARTED')).toBe('BINDING_FILES')
    expect(nextState('FAILED', 'CONFIRM_CREATE')).toBeNull()
    const record = { requestSent: true, mailId: '', state: 'UNKNOWN' } as MailExecutionRecord
    expect(blocksAnotherCreate(record)).toBe(true)
  })
})

describe('消息门禁', () => {
  it('rejects a create message that was not explicitly confirmed', () => {
    const preview = previewOf([selected(fileA)])
    expect(isMessage({ type: 'CREATE_EASY_MAIL', payload: { preview, currentFingerprint: preview.fingerprint, confirmed: false } })).toBe(false)
    expect(isMessage({ type: 'CREATE_EASY_MAIL', payload: { preview, currentFingerprint: preview.fingerprint, confirmed: true } })).toBe(true)
  })

  it('does not create mail from the runtime when the session is absent', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ ClientInfo: { IsLogin: false, Status: false, Result: false } }))
    const runtime = new EasyRuntime(origin, { fetcher, mailStore: new MemoryExecutionStore(), mailGate: openGate })
    const preview = previewOf([selected(fileA)])
    const result = await runtime.createEasyMail(preview, preview.fingerprint)
    expect(result.record.requestSent).toBe(false)
    expect(result.record.state).toBe('FAILED')
    expect(fetcher.mock.calls.some(call => String(call[1]?.body).includes('MailCustomer'))).toBe(false)
  })
})
