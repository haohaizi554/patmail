import { describe, expect, it } from 'vitest'
import { bodyWithSignature, planFileManageLetters, senderAddress } from '../src/customer/file-manage-plan'
import { classifyMailFlow, fileManageSubmitShouldHalt, formatPeople, matchConfiguredReviewer, nextFileManageAttempt } from '../src/customer/file-manage-submit'
import type { DescriptionMailTypeMapping, SubjectRule } from '../src/mail/types'
import type { WorkflowNode } from '../src/workflow/types'

const fileId = '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70'
const typeId = '82e178b4-e2b4-4e5c-98fa-49fb0ea7cf81'
const otherType = '93f289c5-f3c5-4f6d-a90b-50ac1fb8d092'

const subject: SubjectRule = {
  template: '{客户名称}-{文件描述}-{发文类型}',
  countInjection: false,
  anchor: '',
  missingAnchor: 'keep',
  version: 1
}

function mapping(text: string, mailTypeId: string): DescriptionMailTypeMapping {
  return {
    id: `map-${text}-${mailTypeId}`,
    fileDescriptionText: text,
    mailTypeId,
    mailTypeName: '专利电子证书',
    enabled: true,
    version: 1,
    updatedAt: '2026-10-08T00:00:00.000Z'
  }
}

describe('文件管理工作流规划', () => {
  it('同一文件描述合成一封，类型、标题按映射和模板', () => {
    const planned = planFileManageLetters({
      customerName: '鹏城实验室',
      mailStyle: 'merge_by_customer_description',
      files: [
        { fileId, fileName: '甲.pdf', fileDescription: '专利证书', customerName: '鹏城实验室', caseVolume: 'PA1' },
        { fileId: 'a2e178b4-e2b4-4e5c-98fa-49fb0ea7cf81', fileName: '乙.pdf', fileDescription: '专利证书', customerName: '鹏城 实验室' }
      ],
      mappings: [mapping('专利证书', typeId)],
      subject,
      hasSender: true,
      hasReviewer: true,
      hasSignature: true,
      now: new Date('2026-10-08T00:00:00.000Z')
    })
    expect(planned.letters).toHaveLength(1)
    expect(planned.letters[0]).toMatchObject({
      mailTypeId: typeId,
      mailTypeName: '专利电子证书',
      subject: '鹏城实验室-专利证书-专利电子证书',
      blocked: ''
    })
    expect(planned.letters[0]?.files).toHaveLength(2)
  })

  it('一个描述对上多种发文类型时不创建', () => {
    const planned = planFileManageLetters({
      customerName: '甲',
      mailStyle: 'merge_by_customer_description',
      files: [{ fileId, fileName: '甲.pdf', fileDescription: '专利证书', customerName: '甲' }],
      mappings: [mapping('专利证书', typeId), mapping('专利证书', otherType)],
      subject,
      hasSender: true,
      hasReviewer: true,
      hasSignature: true
    })
    expect(planned.letters[0]?.blocked).toContain('多种发文类型')
  })

  it('别的客户的文件不放进来', () => {
    const planned = planFileManageLetters({
      customerName: '甲',
      mailStyle: 'merge_by_customer_description',
      files: [{ fileId, fileName: '甲.pdf', fileDescription: '专利证书', customerName: '乙' }],
      mappings: [mapping('专利证书', typeId)],
      subject,
      hasSender: true,
      hasReviewer: true,
      hasSignature: true
    })
    expect(planned.letters).toHaveLength(0)
    expect(planned.notes[0]).toContain('不是这位客户')
  })

  it('签名按 HTML 写进正文，已有同样一段时不再加', () => {
    expect(bodyWithSignature('<p>您好</p>', '<div>此致<br>敬礼</div>')).toBe('<p>您好</p><br><br><div>此致<br>敬礼</div>')
    expect(bodyWithSignature('<p>您好</p><br><br><div>此致<br>敬礼</div>', '<div>此致<br>敬礼</div>')).toBe('<p>您好</p><br><br><div>此致<br>敬礼</div>')
  })

  it('没设默认签名时不创建', () => {
    const planned = planFileManageLetters({
      customerName: '甲',
      mailStyle: 'merge_by_customer_description',
      files: [{ fileId, fileName: '甲.pdf', fileDescription: '专利证书', customerName: '甲' }],
      mappings: [mapping('专利证书', typeId)],
      subject,
      hasSender: true,
      hasReviewer: true,
      hasSignature: false
    })
    expect(planned.letters[0]?.blocked).toContain('默认签名')
  })

  it('默认发件人能从名称和尖括号里拆出来', () => {
    expect(senderAddress({ label: '林小樱<lin@example.com>' })).toEqual({ name: '林小樱', email: 'lin@example.com' })
    expect(senderAddress({ name: '林小樱', email: 'lin@example.com', label: '' })).toEqual({ name: '林小樱', email: 'lin@example.com' })
  })

  it('客户联系人和商务都写成名称加邮箱，写不成的跳过', () => {
    expect(formatPeople([{ name: '魏丽琼', email: 'wei@example.com' }, { name: '', email: '' }])).toEqual({
      value: '魏丽琼(wei@example.com);',
      skipped: []
    })
    expect(formatPeople([
      { name: '魏丽琼(IPR)', email: 'wei@example.com' },
      { name: '林小樱', email: 'lin@example.com' }
    ])).toEqual({
      value: '林小樱(lin@example.com);',
      skipped: ['魏丽琼(IPR)']
    })
    expect(formatPeople([{ name: '魏丽琼(IPR)', email: 'wei@example.com' }])).toEqual({
      value: '',
      skipped: ['魏丽琼(IPR)']
    })
  })

  it('某一封联系人写不成地址时，不拦住后面勾选的', () => {
    expect(fileManageSubmitShouldHalt('没有提交到审核人。客户联系人「魏丽琼(IPR)」的姓名或邮箱不能写成「名称(邮箱);」，没有提交。')).toBe(false)
    expect(fileManageSubmitShouldHalt('没有提交到审核人。这封还在审核里，没有再创建。')).toBe(false)
    expect(fileManageSubmitShouldHalt('没有提交到审核人。提交响应无法确认，没有再次提交。')).toBe(true)
  })

  it('审核人必须是下一节点里的默认审核人', () => {
    const node = { reviewers: [{ id: typeId, name: '林小樱' }], reviewerFormat: 'structured' } as WorkflowNode
    expect(matchConfiguredReviewer(typeId, node)).toEqual({ ok: true, id: typeId, name: '林小樱' })
    expect(matchConfiguredReviewer(fileId, node).ok).toBe(false)
  })

  it('记过已提交的先去读那封的流程，没确认的停住', () => {
    const item = {
      fileId,
      fileIds: [fileId],
      fileNames: ['甲.pdf'],
      mailTypeId: typeId,
      mailStyle: '1' as const,
      subject: '标题',
      senderId: typeId,
      senderName: '林',
      senderEmail: 'lin@example.com',
      reviewerId: fileId,
      reviewerName: '审',
      signature: '此致'
    }
    const recalled = nextFileManageAttempt(item, { fileId, mailId: otherType, state: 'submitted' })
    expect(recalled.action === 'send' && recalled.item.recall && recalled.item.mailId).toBe(otherType)
    expect(nextFileManageAttempt(item, { fileId, mailId: '', state: 'submitted' }).action).toBe('send')
    expect(nextFileManageAttempt(item, { fileId, mailId: '', state: 'unknown' }).action).toBe('stop')
    const again = nextFileManageAttempt(item, { fileId, mailId: otherType, state: 'created' })
    expect(again.action === 'send' && again.item.mailId).toBe(otherType)
    expect(classifyMailFlow('END', 'node')).toBe('done')
    expect(classifyMailFlow('CHECK', 'node')).toBe('pending')
    expect(classifyMailFlow(null, null)).toBe('open')
  })
})
