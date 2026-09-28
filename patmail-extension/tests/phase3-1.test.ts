import { describe, expect, it } from 'vitest'
import { acceptanceBlockReason } from '../src/automation/acceptance-context'
import { MemoryEvidenceStore } from '../src/automation/evidence-store'
import { ExecutionLedger, memoryTransactionStore } from '../src/automation/ledger'
import { SerialTaskStore } from '../src/automation/indexed-store'
import { buildTask } from '../src/automation/task-builder'
import { handleAuthorityMessage } from '../src/background/authority'
import { saveCustomerAccount, saveRuleAccount, type LocalArea } from '../src/background/account-data'
import { scopeExtensionPageMessage } from '../src/background/scope'
import { handleWorkspaceMessage, type WorkspaceHost } from '../src/background/workspace'
import type { CustomerQueryProfile } from '../src/customer/types'
import { emptyMailRules } from '../src/mail'
import { MailRuleRepository } from '../src/mail/repository'
import type { MailRuleBundle, SelectedPatentFile } from '../src/mail/types'
import { EasyConnectionController, emptyConnection, scopeFromConnection } from '../src/shared/connection'
import { MessageType } from '../src/shared/message'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const origin = 'http://183.36.43.66:88'
const guid = (suffix: string) => `${suffix}-1111-4111-8111-111111111111`
const userA = guid('aaaaaaaa')
const userB = guid('bbbbbbbb')

function memoryArea(): LocalArea {
  const store: Record<string, unknown> = {}
  return {
    async get(key) { return { [key]: store[key] } },
    async set(items) { Object.assign(store, items) }
  }
}
function profile(overrides: Record<string, string> = { case_volume: 'ABC' }): CustomerQueryProfile {
  return { id: 'profile-a', name: '客户A', baseTemplateId: 'base', overrides, enabled: true, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' }
}
function rules(operator = userA): MailRuleBundle {
  return { ...emptyMailRules(operator), revision: 1 }
}
function file(): SelectedPatentFile {
  return {
    fileId: 'file-a', fileName: 'a.pdf', fileDescription: '专利证书', customerName: '客户A', customerProfileId: 'profile-a',
    customerBinding: { profileId: 'profile-a', profileName: '客户A', sourceCustomerName: '客户A', confirmed: true, source: 'explicit' }
  }
}
function session(userId: string) {
  return {
    type: MessageType.SessionResult,
    payload: { ok: true as const, data: { status: 'authenticated', userId, displayName: '测试员', checkedAt: '2026-09-26T00:00:00.000Z' } }
  }
}
function host(replies: unknown[]): WorkspaceHost {
  const tabs = [{ id: 3, url: `${origin}/inbox`, title: 'EASY' }]
  const connection = new EasyConnectionController()
  return {
    connection, area: memoryArea(), tasks: new SerialTaskStore(null), evidence: new MemoryEvidenceStore(),
    queryTabs: async () => tabs,
    getTab: async (tabId) => {
      const tab = tabs.find(item => item.id === tabId)
      if (!tab) throw new Error('closed')
      return tab
    },
    createTab: async () => undefined,
    focusTab: async () => undefined,
    openApp: async () => ({ tabId: 7, created: true }),
    sendToTab: async () => replies.shift()
  }
}

describe('Phase 3.1 连接、规则与任务来源', () => {
  it('restores only a pending candidate and ignores a stale session result', () => {
    const connection = new EasyConnectionController()
    connection.restoreCandidate({ easyOrigin: origin, easyTabId: 4, lastOperatorId: userA, connectionVersion: 2 })
    expect(connection.context.sessionStatus).toBe('pending')
    expect(connection.context.operatorId).toBe('')
    expect(connection.snapshot()).toMatchObject({ easyOrigin: origin, easyTabId: 4, lastOperatorId: userA })
    const version = connection.context.connectionVersion
    connection.beginBind({ id: 4, url: `${origin}/inbox` })
    connection.applySession({ ok: true, status: 'authenticated', userId: userB }, version)
    expect(connection.context.operatorId).not.toBe(userB)
    connection.applySession({ ok: true, status: 'authenticated', userId: userA, displayName: '测试员' }, connection.context.connectionVersion)
    expect(connection.context.operatorId).toBe(userA)
    expect(connection.context.sessionStatus).toBe('authenticated')
  })

  it('keeps customer overrides and rejects a stale rule bundle', async () => {
    const area = memoryArea()
    const saved = await saveCustomerAccount(area, origin, userA, profile())
    const renamed = await saveCustomerAccount(area, origin, userA, { ...saved, name: '客户A改', updatedAt: '2026-09-26T00:00:00.000Z' }, saved.revision ?? 1)
    expect(renamed.overrides).toEqual({ case_volume: 'ABC' })
    const first = await saveRuleAccount(area, origin, userA, rules(), null)
    await expect(saveRuleAccount(area, origin, userA, { ...rules(), revision: 1, subject: { ...rules().subject, template: '过期标题' } }, null)).rejects.toThrow('发文规则已被其他页面更新')
    const second = await saveRuleAccount(area, origin, userA, { ...first, subject: { ...first.subject, template: '新的标题' } }, null)
    expect(second.subject.template).toBe('新的标题')
    expect(second.revision).toBeGreaterThan(first.revision)
    const withReviewer = await saveRuleAccount(area, origin, userA, { ...second, defaultReviewer: { userId: userA, name: '吴晨晨' } }, null)
    expect(withReviewer.defaultReviewer).toEqual({ userId: userA, name: '吴晨晨' })
    const loaded = await new MailRuleRepository(userA, origin, area).load()
    expect(loaded.bundle.defaultReviewer).toEqual({ userId: userA, name: '吴晨晨' })
    expect(loaded.bundle.subject.template).toBe('新的标题')
    const mailbox = '33333333-3333-4333-8333-333333333333'
    const withSender = await saveRuleAccount(area, origin, userA, { ...withReviewer, defaultSender: { mailsetId: mailbox, label: '吴晨晨<wu@example.com>' } }, null)
    expect(withSender.defaultSender).toEqual({ mailsetId: mailbox, label: '吴晨晨<wu@example.com>' })
    const stored = await new MailRuleRepository(userA, origin, area).load()
    expect(stored.bundle.defaultSender).toEqual({ mailsetId: mailbox, label: '吴晨晨<wu@example.com>' })
    expect(stored.bundle.defaultReviewer).toEqual({ userId: userA, name: '吴晨晨' })
  })

  it('saves a task only when the message origin is the EASY origin', async () => {
    const runtime = host(Array.from({ length: 8 }, () => session(userA)))
    const bound = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'bind', tabId: 3 } }, runtime)
    if (bound.type !== MessageType.WorkspaceResult) throw new Error('bind')
    const task = buildTask({ origin, operatorId: userA, files: [file()], rules: rules(), profiles: [profile()], queryTemplateVersion: 1, now: '2026-09-26T00:00:00.000Z' })
    const rejected = scopeExtensionPageMessage({ type: MessageType.SaveTask, payload: { task: { ...task, origin: 'chrome-extension://abc' } as unknown as Record<string, unknown> } }, runtime.connection.context)
    expect(rejected).toEqual({ error: '任务账号与当前绑定会话不一致。' })
    const scoped = scopeExtensionPageMessage({ type: MessageType.SaveTask, payload: { task: task as unknown as Record<string, unknown> } }, runtime.connection.context)
    expect('error' in scoped).toBe(false)
    const store = runtime.tasks
    if (!store || !('error' in scoped) && scoped.type !== MessageType.SaveTask) throw new Error('scope')
    if ('error' in scoped) return
    const saved = await handleAuthorityMessage(scoped, { ledger: new ExecutionLedger(memoryTransactionStore(), 'owner'), tasks: store, evidence: runtime.evidence })
    expect(saved?.type).toBe(MessageType.TaskResult)
    if (saved?.type !== MessageType.TaskResult) return
    expect(saved.payload.ok).toBe(false)
    expect(saved.payload.message).toContain('正式页面不能提交完整任务')
    expect(await store.list(origin, userA)).toEqual([])
    const scope = scopeFromConnection(runtime.connection.context)
    if (!scope) throw new Error('scope')
    await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'saveRules', bundle: rules(), expectedScope: scope } }, runtime)
    await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'saveCustomer', profile: profile(), expectedScope: scope } }, runtime)
    const planned = await handleWorkspaceMessage({
      type: MessageType.Workspace,
      payload: { action: 'createTaskPlan', files: [file()], queryTemplateVersion: 0, expectedScope: scope }
    }, runtime)
    if (planned.type !== MessageType.WorkspaceResult) throw new Error('plan')
    expect(planned.payload.ok).toBe(true)
    expect(planned.payload.createdTask?.taskId).toBeTruthy()
    expect(planned.payload.createdTask?.taskId).not.toBe(task.taskId)
    const loaded = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'load' } }, runtime)
    if (loaded.type !== MessageType.WorkspaceResult) throw new Error('load')
    expect(loaded.payload.tasks.map(item => item.taskId)).toContain(planned.payload.createdTask?.taskId)
    expect((await store.list(origin, userA))[0]?.origin).toBe(origin)
  })

  it('blocks acceptance calls that lack business parameters before any request', async () => {
    expect(acceptanceBlockReason('GetMailInfo', {})).toContain('邮件 ID')
    expect(acceptanceBlockReason('LoadFileTypeByCaseType', {})).toContain('案件类型')
    expect(acceptanceBlockReason('GetFlowInfo', { mailId: guid('eeeeeeee') })).toContain('流程类型')
    expect(acceptanceBlockReason('GetUserModel', {})).toBe('')
    const calls: string[] = []
    const runtime = host([session(userA)])
    runtime.sendToTab = async (_tabId, message) => {
      calls.push(message.type)
      return session(userA)
    }
    const bound = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'bind', tabId: 3 } }, runtime)
    if (bound.type !== MessageType.WorkspaceResult) throw new Error('bind')
    calls.length = 0
    const blocked = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'runAcceptance', call: 'GetMailInfo' } }, runtime)
    if (blocked.type !== MessageType.WorkspaceResult) throw new Error('acceptance')
    expect(blocked.payload.message).toContain('BLOCKED')
    expect(calls).not.toContain(MessageType.RunReadonlyAcceptance)
    const panels = ['AutomationPanel.vue', 'ControlledExecutionPanel.vue', 'LiveAcceptancePanel.vue']
    for (const name of panels) {
      expect(readFileSync(path.join(process.cwd(), 'src/floating', name), 'utf8')).not.toContain('location.origin')
    }
    expect(emptyConnection().connectionVersion).toBe(0)
  })

  it('returns the readonly probe fields with the acceptance record', async () => {
    const caseTypeId = guid('cccccccc')
    const runtime = host([
      session(userA),
      session(userA),
      {
        type: MessageType.AcceptanceResult,
        payload: {
          records: [],
          probe: {
            httpStatus: 200,
            sessionOk: true,
            fields: { caseTypeCount: '7', caseTypeId, caseTypeLabel: '专利' },
            shape: 'object(CaseType,ClientInfo)'
          }
        }
      }
    ])
    const bound = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'bind', tabId: 3 } }, runtime)
    if (bound.type !== MessageType.WorkspaceResult) throw new Error('bind')
    const result = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'runAcceptance', call: 'IPGetBasicData' } }, runtime)
    if (result.type !== MessageType.WorkspaceResult) throw new Error('acceptance')
    expect(result.payload.forwarded?.type).toBe(MessageType.AcceptanceResult)
    if (result.payload.forwarded?.type !== MessageType.AcceptanceResult) return
    expect(result.payload.forwarded.payload.probe?.fields.caseTypeId).toBe(caseTypeId)
    expect(result.payload.forwarded.payload.probe?.fields.caseTypeLabel).toBe('专利')
  })
})
