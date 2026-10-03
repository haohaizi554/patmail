import { describe, expect, it } from 'vitest'
import { defaultPengchengWorkflow, defaultPctWorkflow } from '../src/workflow/catalog'
import { workflowPreview } from '../src/workflow/preview-chart'

describe('工作流全局预览', () => {
  it('鹏城专案从左到右画出收件人、抄送和对信分支', () => {
    const pieces = workflowPreview(defaultPengchengWorkflow(), {
      customerType: '提醒申请PCT（贵方案号）-深圳市',
      ourType: '提醒申请PCT（我方案号）-深圳市'
    })
    const text = pieces.flatMap(piece => [...piece.lines, ...(piece.arms ?? []).flat()]).join('\n')
    expect(pieces.map(piece => piece.stepId)).toEqual([
      'entry', 'sheet', 'proc', 'mail-type', 'mail-style', 'recipients', 'sender', 'review', 'query'
    ])
    expect(text).toContain('收件人列：技术负责人')
    expect(text).toContain('抄送列：IPR')
    expect(text).toContain('技术负责人收')
    expect(text).toContain('IPR 和商务抄送')
    expect(text).toContain('同一客户、同一收件人和抄送')
    expect(text).toContain('有客户文号')
    expect(text).toContain('只有我方文号')
    expect(text).toContain('贵方案号')
    expect(text).not.toContain('默认发文的收件人')
    const letter = pieces.find(piece => piece.stepId === 'mail-type')
    expect(letter?.arms).toHaveLength(2)
  })

  it('PCT提醒的收件人仍是 IPR', () => {
    const text = workflowPreview(defaultPctWorkflow()).flatMap(piece => piece.lines).join('\n')
    expect(text).toContain('IPR 收')
    expect(text).toContain('商务抄送')
    expect(text).toContain('一行一件')
    expect(text).not.toContain('技术负责人收')
  })
})
