import { describe, expect, it } from 'vitest'
import { buildBody } from '../src/mail/rules/body-builder'
import { buildSubject } from '../src/mail/rules/subject-builder'
import type { MailGroup, SelectedPatentFile, SubjectRule } from '../src/mail/types'

const now = new Date(2026, 8, 22)

function file(id: string, volume: string): SelectedPatentFile {
  return {
    fileId: id,
    fileName: `${volume}.pdf`,
    fileDescription: '实用新型专利证书(签章)',
    customerName: '广汽丰田汽车有限公司',
    customerVolume: volume,
    applicationNo: '202522164046.3',
    caseVolume: 'PA2527072CND',
    officialPostDate: '2026-09-22'
  }
}

function group(files: SelectedPatentFile[]): MailGroup {
  return {
    id: 'g',
    customerProfileId: 'c',
    customerIdentity: 'c',
    descriptionIdentity: 'text:证书',
    descriptionLabel: '实用新型专利证书(签章)',
    sendMode: 'merge_by_customer_description',
    files,
    policyVersion: 1
  }
}

const rangeRule: SubjectRule = {
  template: '关于转达{贵方案号范围}{发文类型}-{客户名称}-世纪恒程{日期}',
  countInjection: false,
  anchor: '关于',
  missingAnchor: 'keep',
  version: 1
}

describe('转达标题模板', () => {
  it('keeps the first and last customer volume and drops the pieces that were removed', () => {
    const built = buildSubject(rangeRule, group([
      file('1', 'ZL20250306002'),
      file('2', 'ZL20250505002'),
      file('3', 'ZL20250707002')
    ]), '广汽丰田汽车有限公司', { mailTypeName: '专利电子证书', now })
    expect(built.text).toBe('关于转达ZL20250306002-ZL20250707002专利电子证书-广汽丰田汽车有限公司-世纪恒程20260922')
    expect(built.unresolved).toEqual([])
  })

  it('uses the file count when the volume span is left out', () => {
    const files = Array.from({ length: 18 }, (_, index) => file(String(index + 1), `ZL${index}`))
    const built = buildSubject({
      ...rangeRule,
      template: '关于转达{文件数量}件{发文类型}-{客户名称}-世纪恒程{日期}'
    }, group(files), '广汽丰田汽车有限公司', { mailTypeName: '专利电子证书', now })
    expect(built.text).toBe('关于转达18件专利电子证书-广汽丰田汽车有限公司-世纪恒程20260922')
  })

  it('writes a single volume without a dash', () => {
    const built = buildSubject(rangeRule, group([file('1', 'ZL20250306002')]), '广汽丰田汽车有限公司', { mailTypeName: '专利电子证书', now })
    expect(built.text).toBe('关于转达ZL20250306002专利电子证书-广汽丰田汽车有限公司-世纪恒程20260922')
  })

  it('drops an empty segment and the dash after it, the same way the original default subject does', () => {
    const onlyOurs = file('1', '')
    delete onlyOurs.customerVolume
    onlyOurs.caseVolume = 'PA2527072CND'
    onlyOurs.caseName = ''
    const built = buildSubject({
      ...rangeRule,
      template: '{贵方案号}-{我方文号}-{案件名称}{发文类型}'
    }, group([onlyOurs]), '广汽丰田汽车有限公司', { mailTypeName: '专利电子证书', now })
    expect(built.text).toBe('PA2527072CND-专利电子证书')
    expect(built.unresolved).toEqual([])
  })

  it('keeps every filled segment of the original default subject', () => {
    const row = file('1', 'ZL20250704003')
    row.caseName = '一体贯穿式前灯结构'
    const built = buildSubject({
      ...rangeRule,
      template: '{贵方案号}-{我方文号}-{案件名称}{发文类型}'
    }, group([row]), '广汽丰田汽车有限公司', { mailTypeName: '专利电子证书', now })
    expect(built.text).toBe('ZL20250704003-PA2527072CND-一体贯穿式前灯结构专利电子证书')
  })

  it('accepts 客户文号 as another name for the same span', () => {
    const built = buildSubject({ ...rangeRule, template: '{客户文号范围}' }, group([
      file('1', 'ZL20250306002'),
      file('2', 'ZL20250707002')
    ]), '客户', { now })
    expect(built.text).toBe('ZL20250306002-ZL20250707002')
  })

  it('fills the same placeholders in the body', () => {
    const body = buildBody({
      template: '请查收{文件数量}件{发文类型}。',
      supplement: '',
      version: 1
    }, group([file('1', 'ZL20250306002'), file('2', 'ZL20250707002')]), '广汽丰田汽车有限公司', '', { mailTypeName: '专利电子证书', now })
    expect(body.text).toBe('请查收2件专利电子证书。')
  })
})
