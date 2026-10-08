import { describe, expect, it } from 'vitest'
import { isCustomerProfile } from '../src/customer/guards'
import { applyBoundQuery, mailStylesFor, matchPctMailTypes, pctMailTypeFor, pctVolumeSlot, querySnapshot, summarizeBoundQuery } from '../src/customer/mail-flow'
import type { CustomerQueryProfile } from '../src/customer/types'

function profile(extra: Partial<CustomerQueryProfile> = {}): CustomerQueryProfile {
  return {
    id: 'profile-a',
    name: '鹏城实验室',
    baseTemplateId: 'manual',
    overrides: {},
    enabled: true,
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
    ...extra
  }
}

const mailTypes = [
  { id: '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70', name: '提醒申请PCT（贵方案号）-深圳市' },
  { id: '82e178b4-e2b4-4e5c-98fa-49fb0ea7cf81', name: '提醒申请PCT（我方案号）非深圳市' },
  { id: '93f289c5-f3c5-4f6d-a90b-50ac1fb8d092', name: '提醒申请PCT（我方案号）-深圳市' }
]

describe('PCT 提醒文号', () => {
  it('有客户文号时对上热加载的贵方案号', () => {
    expect(pctVolumeSlot({ customerVolume: 'CS-CN20251009-01', ourVolume: 'PA2518728CND' })).toEqual({ id: 'customer_volume', radioIndex: 1 })
    expect(pctMailTypeFor({ customerVolume: 'CS-1', ourVolume: 'PA1' }, mailTypes)?.name).toBe('提醒申请PCT（贵方案号）-深圳市')
  })

  it('只有我方文号时对上热加载的我方案号深圳市', () => {
    expect(pctMailTypeFor({ customerVolume: '  ', ourVolume: 'PA2518728CND' }, mailTypes)?.id).toBe('93f289c5-f3c5-4f6d-a90b-50ac1fb8d092')
  })

  it('树还没读到时不写死名称，名字只是包含那几个词时也不对', () => {
    expect(pctMailTypeFor({ customerVolume: 'CS-1', ourVolume: 'PA1' }, [])).toBeNull()
    expect(matchPctMailTypes(mailTypes).ourVolumeShenzhen?.name).toBe('提醒申请PCT（我方案号）-深圳市')
    expect(matchPctMailTypes(mailTypes).ourVolumeOtherCity).toBeNull()
    expect(matchPctMailTypes([
      { id: '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70', name: '提醒申请PCT（贵方案号）深圳市' }
    ]).customerVolume).toBeNull()
  })

  it('两个文号都没有时不猜', () => {
    expect(pctVolumeSlot({ customerVolume: '', ourVolume: '' })).toBeNull()
  })
})

describe('绑定最后提交的字段', () => {
  it('只保留有值的字段，不保留空步骤', () => {
    expect(querySnapshot({ ctrl_proc: ' 提醒申请PCT ', case_volume: '', customer_name: '鹏城实验室' })).toEqual({
      ctrl_proc: '提醒申请PCT',
      customer_name: '鹏城实验室'
    })
  })

  it('期限查询绑到客户时留下字段快照，不写进文件查询覆盖项', () => {
    const next = applyBoundQuery(profile({ limitMailStyle: '1', overrides: { case_volume: '旧的' } }), {
      surface: 'limit',
      fields: { ctrl_proc: 'abc', customer_name: '鹏城实验室' },
      templateId: 'limit-template',
      reviewSelf: true
    })
    expect(next.boundQuery).toEqual({ ctrl_proc: 'abc', customer_name: '鹏城实验室' })
    expect(next.overrides).toEqual({})
    expect(next.baseTemplateId).toBe('limit-template')
    expect(next.reviewTarget).toBe('self')
    expect(isCustomerProfile(next)).toBe(true)
  })

  it('文件查询只把已注册字段放进覆盖项', () => {
    const next = applyBoundQuery(profile(), {
      surface: 'file',
      fields: { case_volume: 'PA1', not_a_field: 'x' }
    })
    expect(next.overrides).toEqual({ case_volume: 'PA1' })
    expect(next.boundQuery).toEqual({ case_volume: 'PA1', not_a_field: 'x' })
  })

  it('拒绝不认识的发文模式', () => {
    expect(isCustomerProfile(profile({ limitMailStyle: '9' as '1' }))).toBe(false)
  })

  it('查询入口决定发文模式，文件查询不带期限弹层的第一联系人', () => {
    expect(mailStylesFor('file').map(item => item.label)).toEqual(['同客户合并发文', '单个来文发文'])
    expect(mailStylesFor('limit').map(item => item.value)).toEqual(['1', '2', '3'])
    expect(isCustomerProfile(profile({ querySurface: 'file', fileMailStyle: 'merge_by_customer_description' }))).toBe(true)
    expect(isCustomerProfile(profile({ querySurface: 'limit', workflowId: 'pct-reminder', limitMailStyle: '1' }))).toBe(true)
    expect(isCustomerProfile(profile({ workflowId: 'other' as 'pct-reminder' }))).toBe(false)
  })

  it('记住的查询用页面上的说法，不露出字段名和内部代号', () => {
    const ids = Array.from({ length: 3 }, () => 'a52c7405-5303-47a6-8ab9-b7823cbe7df6').join(',')
    expect(summarizeBoundQuery({
      case_type: '31D1A147-2931-43B5-94AE-B72B1525BA8A',
      customer_name_vague: '广汽丰田',
      file_status: 'UN',
      fileclass: 'general',
      filetype: ids
    })).toBe('客户名称：广汽丰田，文件处理状态：未处理，文件描述：3 项，案件类型：专利')
  })
})
