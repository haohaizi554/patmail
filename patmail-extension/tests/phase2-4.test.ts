import { describe, expect, it } from 'vitest'
import { DictionaryCache } from '../src/api/dictionaries/cache'
import { DictionaryService } from '../src/api/dictionaries/service'
import { EasyTransport } from '../src/api/transport'
import type { ApiResult } from '../src/api/types'
import { resolveFileDescriptionDisplay } from '../src/schema/resolver'
import { buildFileTypeTree } from '../src/schema/file-type-tree'
import {
  bindCustomer, buildBody, buildSubject, emptyMailRules, injectCount, MailRuleRepository, mailStorageKey,
  matchMailType, planDrafts, planMailGroups, selectPage, toSelectedFile, toggleSelected, uniqueAddresses
} from '../src/mail'
import type { CustomerMailPolicy, DescriptionMailTypeMapping, MailRuleBundle, SelectedPatentFile } from '../src/mail/types'
import type { PatentFile } from '../src/api/file-search-types'
import type { CustomerQueryProfile } from '../src/customer/types'

const guid = (suffix: string) => `${suffix}-1111-4111-8111-111111111111`
const user = guid('aaaaaaaa')
const other = guid('bbbbbbbb')
const mailType = guid('cccccccc')
const client = { ClientInfo: { IsLogin: true, Status: true, Result: false, Message: null } }

function file(id: string, customer: string, description: string, extra: Partial<SelectedPatentFile> = {}): SelectedPatentFile {
  return { fileId: id, fileName: `文件${id}`, fileDescription: description, customerName: '客户名', customerProfileId: customer, ...extra }
}
function policy(customer: string, sendMode: CustomerMailPolicy['sendMode'] = 'merge_by_customer_description'): CustomerMailPolicy {
  return { customerProfileId: customer, sendMode, enabled: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }
}
function mapping(text: string, enabled = true, id = mailType): DescriptionMailTypeMapping {
  return { id: `map-${text}`, fileDescriptionText: text, mailTypeId: id, mailTypeName: '证书通知', enabled, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }
}
function rules(partial: Partial<MailRuleBundle> = {}): MailRuleBundle {
  return { ...emptyMailRules(user), ...partial, ownerId: partial.ownerId ?? user }
}
function profile(id: string, name: string): CustomerQueryProfile {
  return { id, name, baseTemplateId: 'base', overrides: {}, enabled: true, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' }
}
function patent(id: string, name: string): PatentFile {
  return { fileId: id, fileName: name, fileDescription: '专利证书', customerName: '客户A', caseVolume: 'PA-1', applicationNo: 'CN1', caseId: guid('dddddddd') }
}
function memoryArea() {
  const store: Record<string, unknown> = {}
  return {
    store,
    get: async (key: string) => ({ [key]: store[key] }),
    set: async (items: Record<string, unknown>) => { Object.assign(store, items) }
  }
}

describe('文件描述显示', () => {
  it('uses the same resolver for saved ids and history text', () => {
    const id = guid('10000000')
    const known = resolveFileDescriptionDisplay({ savedIds: id, descriptions: [{ id, name: '专利证书' }] })
    expect(known).toMatchObject({ resolved: true, text: '专利证书', unresolvedIds: [] })
    const unknown = resolveFileDescriptionDisplay({ savedIds: guid('20000000'), historyText: '旧名称', descriptions: [] })
    expect(unknown.resolved).toBe(false)
    expect(unknown.unresolvedIds).toEqual([guid('20000000')])
    expect(unknown.text).toContain('未识别')
    const tree = buildFileTypeTree([
      { id: guid('10000000'), name: '官方来文', pid: '', seq: 1, tree_level: 1 },
      { id: guid('20000000'), name: '专利证书', pid: guid('10000000'), seq: 1, tree_level: 2 },
      { id: guid('30000000'), name: '发明证书', pid: guid('20000000'), seq: 1, tree_level: 3 }
    ])
    expect(tree.nodes.find(node => node.id === guid('20000000'))?.childIds).toEqual([guid('30000000')])
  })
})

describe('字典缓存世代', () => {
  it('does not let an invalidated request refill the cache', async () => {
    const cache = new DictionaryCache(10_000, () => 1)
    let release: (value: ApiResult<number>) => void = () => undefined
    const first = cache.load<number>('user|basic', false, () => new Promise(resolve => { release = resolve }))
    cache.invalidateUser('user')
    release({ ok: true, data: 1 })
    expect(await first).toMatchObject({ ok: true, data: 1 })
    let calls = 0
    const second = await cache.load('user|basic', false, async () => {
      calls += 1
      return { ok: true, data: 2 }
    })
    expect(calls).toBe(1)
    expect(second).toMatchObject({ ok: true, data: 2 })
  })
})

describe('文件选择', () => {
  it('selects by file id across pages and ignores duplicates', () => {
    const first = toSelectedFile(patent('f1', '甲'))
    const second = toSelectedFile(patent('f2', '乙'))
    let selected = toggleSelected({}, first)
    selected = selectPage(selected, [first, second], true)
    selected = selectPage(selected, [toSelectedFile(patent('f3', '丙'))], true)
    expect(Object.keys(selected).sort()).toEqual(['f1', 'f2', 'f3'])
    selected = toggleSelected(selected, first)
    expect(selected.f1).toBeUndefined()
    selected = selectPage(selected, [second], false)
    expect(selected.f2).toBeUndefined()
    selected = bindCustomer({ f3: selected.f3! }, ['f3'], 'profile-a')
    expect(selected.f3?.customerProfileId).toBe('profile-a')
    expect(first.fileId).toBe('f1')
  })
})

describe('发文分组', () => {
  it('merges only the same customer and description', () => {
    const files = [
      file('1', 'a', '专利证书'), file('2', 'a', '专利证书'), file('3', 'a', '审查意见'),
      file('4', 'b', '专利证书'), file('5', 'a', '')
    ]
    const grouped = planMailGroups(files, [policy('a'), policy('b')])
    expect(grouped.groups.map(group => group.files.map(item => item.fileId))).toEqual([['1', '2'], ['3'], ['4']])
    expect(grouped.skipped.map(item => item.code)).toEqual(['MISSING_DESCRIPTION'])
    const single = planMailGroups([file('1', 'a', '专利证书'), file('2', 'a', '专利证书')], [policy('a', 'single_file')])
    expect(single.groups).toHaveLength(2)
    const again = planMailGroups(files, [policy('a'), policy('b')])
    expect(again.groups.map(group => group.id)).toEqual(grouped.groups.map(group => group.id))
    const duplicate = planMailGroups([file('1', 'a', '专利证书'), file('1', 'a', '专利证书')], [policy('a')])
    expect(duplicate.groups[0]?.files).toHaveLength(1)
    expect(duplicate.skipped[0]?.code).toBe('DUPLICATE_FILE')
    const unnamed = planMailGroups([file('9', '', '专利证书', { customerProfileId: undefined, customerName: '客户A' })], [policy('a')])
    expect(unnamed.groups).toHaveLength(0)
  })
})

describe('发文类型映射和草稿', () => {
  it('matches exact ids, blocks missing or disabled mappings, and keeps the guid', () => {
    const group = planMailGroups([file('1', 'a', '专利证书', { fileDescriptionId: guid('10000000') })], [policy('a')]).groups[0]!
    expect(matchMailType(group, [mapping('专利证书')])).toBeNull()
    expect(matchMailType(group, [{ ...mapping('其他'), fileDescriptionId: guid('10000000') }])?.mailTypeId).toBe(mailType)
    const textGroup = planMailGroups([file('1', 'a', '专利证书')], [policy('a')]).groups[0]!
    expect(matchMailType(textGroup, [mapping('专利证书', false)])).toBeNull()
    expect(matchMailType(textGroup, [mapping('专利证书', true, '证书通知')])).toBeNull()
    const bundle = rules({
      policies: [policy('a')],
      mappings: [mapping('专利证书')],
      recipients: [{ id: 'to', customerProfileId: 'a', name: '默认', to: ['A@Example.com', 'a@example.com', 'bad'], cc: [], enabled: true, isDefault: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
      signatures: [{ id: 'sign', operatorId: user, name: '我', content: '此致', enabled: true, isDefault: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
      subject: { template: '关于{文件名称}的通知', countInjection: true, anchor: '关于', missingAnchor: 'confirm', version: 1 },
      body: { template: '请查收{文件数量}个文件。', supplement: '{不存在}', version: 1 }
    })
    const snapshot = { selectedAt: '2026-09-24T00:00:00.000Z', files: [file('1', 'a', '专利证书'), file('2', 'a', '专利证书')], configVersion: bundle.revision }
    const drafts = planDrafts(snapshot, bundle, [profile('a', '客户A')], user)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.mailTypeId).toBe(mailType)
    expect(drafts[0]?.to).toEqual(['a@example.com'])
    expect(drafts[0]?.subject).toBe('关于2个文件1、文件2的通知')
    expect(injectCount(drafts[0]!.subject, 2, '关于')).toBe(drafts[0]?.subject)
    expect(drafts[0]?.body).toContain('{不存在}')
    expect(drafts[0]?.body).toContain('此致')
    expect(drafts[0]?.status).toBe('blocked')
    expect(drafts[0]?.issues.some(issue => issue.code === 'INVALID_EMAIL')).toBe(true)
    const warned = planDrafts(snapshot, { ...bundle, recipients: [{ ...bundle.recipients[0]!, to: ['a@example.com'] }] }, [profile('a', '客户A')], user)
    expect(warned[0]?.status).toBe('warning')
    const otherSignature = planDrafts(snapshot, bundle, [profile('a', '客户A')], other)
    expect(otherSignature[0]?.signature).toBe('')
    const stale = planDrafts({ ...snapshot, configVersion: 99 }, bundle, [profile('a', '客户A')], user)
    expect(stale[0]?.issues.some(issue => issue.code === 'STALE_RULE')).toBe(true)
    const missing = planDrafts(snapshot, rules({ policies: [policy('a')], recipients: bundle.recipients }), [profile('a', '客户A')], user)
    expect(missing[0]?.status).toBe('blocked')
    expect(missing[0]?.issues.some(issue => issue.code === 'MISSING_MAPPING')).toBe(true)
  })

  it('builds subject and body without executing template text', () => {
    expect(uniqueAddresses([' A@B.com ', 'a@b.com', 'nope'])).toEqual({ addresses: ['a@b.com'], invalid: ['nope'] })
    const group = planMailGroups([file('1', 'a', '专利证书')], [policy('a')]).groups[0]!
    const subject = buildSubject({ template: '{文件名称}<script>', countInjection: false, anchor: '关于', missingAnchor: 'keep', version: 1 }, group, '客户A')
    expect(subject.text).toBe('文件1<script>')
    expect(subject.unresolved).toEqual([])
    const missingAnchor = buildSubject({ template: '通知', countInjection: true, anchor: '关于', missingAnchor: 'confirm', version: 1 }, {
      ...group, files: [file('1', 'a', '专利证书'), file('2', 'a', '专利证书')]
    }, '客户A')
    expect(missingAnchor.needsConfirm).toBe(true)
    expect(missingAnchor.text).toBe('通知')
    const body = buildBody({ template: '正文 {客户名称}', supplement: '此致', version: 1 }, group, '客户A', '此致')
    expect(body.text).toBe('正文 客户A\n\n此致')
  })
})

describe('发文配置存储', () => {
  it('keeps accounts apart, queues writes, and refuses corrupt or foreign data', async () => {
    expect(mailStorageKey('http://easy', 'not-a-guid')).toBeNull()
    const area = memoryArea()
    const repo = new MailRuleRepository(user, 'http://easy', area)
    const foreign = new MailRuleRepository(other, 'http://easy', area)
    const session = new MailRuleRepository('session', 'http://easy', area)
    await repo.update(bundle => { bundle.policies.push(policy('a')) })
    expect((await foreign.load()).bundle.policies).toEqual([])
    expect((await session.load()).scope).toBe('session')
    expect(Object.keys(area.store)).toEqual([`patmail.mail.v1:http://easy:${user}`])
    await Promise.all([
      repo.update(bundle => { bundle.policies.push(policy('b')) }),
      repo.update(bundle => { bundle.mappings.push(mapping('专利证书')) })
    ])
    const saved = await repo.load()
    expect(saved.bundle.policies.map(item => item.customerProfileId).sort()).toEqual(['a', 'b'])
    expect(saved.bundle.mappings).toHaveLength(1)
    expect(saved.bundle.revision).toBe(4)
    area.store[`patmail.mail.v1:http://easy:${user}`] = { version: 1, ownerId: user, revision: 1, cookie: 'secret' }
    const locked = await repo.load()
    expect(locked.writable).toBe(false)
    await expect(repo.update(() => undefined)).rejects.toThrow(/不允许保存/)
    const fresh = memoryArea()
    const importer = new MailRuleRepository(user, 'http://easy', fresh)
    const exported = repo.exportJson(saved.bundle)
    expect(exported.toLowerCase()).not.toContain('cookie')
    await importer.importJson(exported)
    await expect(foreign.importJson(exported)).rejects.toThrow(/归属/)
  })
})

describe('发文类型字典', () => {
  it('keeps real ids and does not invent one for a bad payload', async () => {
    const fetcher: typeof fetch = async (_url, init) => {
      const call = new URLSearchParams(String(init?.body)).get('Call')
      expect(call).toBe('LoadMailType')
      const page = new URLSearchParams(String(init?.body)).get('log_pagename')
      expect(page).toBe('FileSearchMail.aspx')
      return new Response(JSON.stringify({
        ...client,
        MailType: [{ id: mailType, name: '证书通知', pid: '', TreeType: 'User' }, { id: '证书通知', name: '不能当 ID' }]
      }), { status: 200 })
    }
    const service = new DictionaryService(new EasyTransport('http://183.36.43.66:88', { fetcher }))
    const loaded = await service.loadMailTypes(user, false)
    expect(loaded.ok && loaded.data.nodes).toEqual([{ id: mailType, name: '证书通知', parentId: '', treeType: 'User' }])
    const bad = new DictionaryService(new EasyTransport('http://183.36.43.66:88', {
      fetcher: async () => new Response(JSON.stringify({ ...client, MailType: { id: mailType } }), { status: 200 })
    }))
    expect((await bad.loadMailTypes(user, true)).ok).toBe(false)
  })
})
