import { describe, expect, it } from 'vitest'
import { emptyMailRules, planMailGroups, readMailRules, removeCustomerPolicy, upsertCustomerPolicy } from '../src/mail'
import type { CustomerMailPolicy, SelectedPatentFile } from '../src/mail/types'

function policy(customer: string, remark = '', sendMode: CustomerMailPolicy['sendMode'] = 'merge_by_customer_description'): CustomerMailPolicy {
  return {
    customerProfileId: customer,
    querySurface: 'file',
    ...(remark ? { remark } : {}),
    sendMode,
    enabled: true,
    version: 1,
    updatedAt: '2026-09-24T00:00:00.000Z'
  }
}

function file(id: string, customer: string): SelectedPatentFile {
  return {
    fileId: id,
    fileName: `文件${id}`,
    fileDescription: '专利证书',
    customerName: '客户名',
    customerProfileId: customer,
    customerBinding: { profileId: customer, profileName: '客户名', sourceCustomerName: '客户名', confirmed: true, source: 'explicit' }
  }
}

describe('客户发文方式备注', () => {
  it('同一客户可以留下备注不同的两套', () => {
    const first = upsertCustomerPolicy([], {
      customerProfileId: 'a', querySurface: 'file', sendMode: 'merge_by_customer_description', limitMailStyle: '', remark: '日常', replaceKey: ''
    }, '2026-09-29T00:00:00.000Z')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = upsertCustomerPolicy(first.policies, {
      customerProfileId: 'a', querySurface: 'file', sendMode: 'single_file', limitMailStyle: '', remark: '加急', replaceKey: ''
    }, '2026-09-29T00:00:01.000Z')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.policies.map(item => item.remark)).toEqual(['日常', '加急'])
  })

  it('改备注时替换原来那一套，不会另起一行', () => {
    const saved = upsertCustomerPolicy([policy('a', '日常')], {
      customerProfileId: 'a', querySurface: 'file', sendMode: 'single_file', limitMailStyle: '', remark: '加急',
      replaceKey: JSON.stringify(['a', 'file', '日常'])
    }, '2026-09-29T00:00:00.000Z')
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.policies).toHaveLength(1)
    expect(saved.policies[0]?.remark).toBe('加急')
    expect(saved.policies[0]?.sendMode).toBe('single_file')
    expect(saved.policies[0]?.version).toBe(2)
  })

  it('改成另一套已经用过的备注时不覆盖', () => {
    const saved = upsertCustomerPolicy([policy('a', '日常'), policy('a', '加急', 'single_file')], {
      customerProfileId: 'a', querySurface: 'file', sendMode: 'merge_by_customer_description', limitMailStyle: '', remark: '加急',
      replaceKey: JSON.stringify(['a', 'file', '日常'])
    })
    expect(saved).toEqual({ ok: false, message: '这个客户在这个查询方式下已经有同样的备注。' })
  })

  it('删除只去掉备注对上的那一套', () => {
    const left = removeCustomerPolicy([policy('a', '日常'), policy('a', '加急', 'single_file')], {
      customerProfileId: 'a', querySurface: 'file', remark: '日常'
    })
    expect(left.map(item => item.remark)).toEqual(['加急'])
  })

  it('旧配置没有备注时仍可读取，过长的备注不会覆盖原配置', () => {
    const owner = '11111111-1111-4111-8111-111111111111'
    const legacy = emptyMailRules(owner)
    legacy.policies = [policy('a')]
    expect(readMailRules(legacy, owner).writable).toBe(true)
    const broken = emptyMailRules(owner)
    broken.policies = [{ ...policy('a'), remark: '过'.repeat(81) }]
    expect(readMailRules(broken, owner).writable).toBe(false)
  })

  it('几套发文方式相同时，备注不挡住分组', () => {
    const grouped = planMailGroups(
      [file('1', 'a'), file('2', 'a')],
      [policy('a', '日常'), policy('a', '加急')]
    )
    expect(grouped.groups).toHaveLength(1)
    expect(grouped.groups[0]?.files.map(item => item.fileId)).toEqual(['1', '2'])
    expect(grouped.skipped).toEqual([])
  })
})
