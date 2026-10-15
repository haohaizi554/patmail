import { describe, expect, it } from 'vitest'
import { beginProgress, classifySubmitText, logProgress, noteProgress, progressDialog, progressSummaryLine, tallyProgress } from '../src/app/dialog'

describe('提交进度统计', () => {
  it('对不上邮箱算异常，已提交算成功', () => {
    expect(classifySubmitText('已提交 1 封，共 3 件，给当前登录人审核。')).toBe('success')
    expect(classifySubmitText('已提交 2 件给当前登录人审核。')).toBe('success')
    expect(classifySubmitText('没有提交到审核人。表格里的客户联系人(IPR)「雷群安」没有在发文联系人里对上邮箱。')).toBe('abnormal')
    expect(classifySubmitText('没有提交到审核人。表格里的技术负责人「张三」没有在发文联系人里对上邮箱。')).toBe('abnormal')
    expect(classifySubmitText('没有提交到审核人。「张三」对上了多个邮箱，没有追加到抄送。')).toBe('abnormal')
    expect(classifySubmitText('没有提交到审核人。发文页没有商务邮箱，没有提交。')).toBe('abnormal')
    expect(classifySubmitText('没有提交到审核人。「姜颖」在联系人里没有可用的「第一发明人」邮箱，没有追加到收件人。')).toBe('abnormal')
    expect(classifySubmitText('这些事项还在审核里，没有再创建。')).toBe('skipped')
    expect(classifySubmitText('这些事项已经提交过，没有再创建。')).toBe('skipped')
    expect(classifySubmitText('没有要提交的事项。')).toBe('skipped')
    expect(classifySubmitText('客户要求这封提醒不用发，没有创建发文。')).toBe('skipped')
    expect(classifySubmitText('没有提交到审核人。创建发文的响应无法确认，没有再次创建。')).toBe('failed')
  })

  it('按件数累加，结束时写出各项数量', () => {
    beginProgress('提交到 EASY', 4)
    tallyProgress('success', 3)
    tallyProgress('abnormal', 2)
    tallyProgress('failed', 1)
    expect(progressDialog.counts).toEqual({ success: 3, failed: 1, abnormal: 2, skipped: 0 })
    expect(progressSummaryLine()).toBe('统计：成功 3 件，失败 1 件，异常 2 件。')
    tallyProgress('skipped', 4)
    expect(progressSummaryLine()).toBe('统计：成功 3 件，失败 1 件，异常 2 件，跳过 4 件。')
    noteProgress('failed', 'CPA2529550CN', '没有提交到审核人。创建发文的响应无法确认，没有再次创建。')
    noteProgress('skipped', 'CW1PZ2528275CN', '上一封结果无法确认，这一件没有开始。')
    expect(progressSummaryLine()).toContain('失败 CPA2529550CN：创建发文的响应无法确认，没有再次创建。')
    expect(progressSummaryLine()).toContain('跳过 CW1PZ2528275CN：上一封结果无法确认，这一件没有开始。')
  })

  it('较小的完成数不会把进度条拉回去', () => {
    beginProgress('提交到 EASY', 4)
    logProgress('已完成 1 封。', 1)
    logProgress('并发下后开始的一封先报了更大的完成数。', 3)
    logProgress('较早的一封这时才把完成数报成 1。', 1)
    expect(progressDialog.done).toBe(3)
    logProgress('超过总数。', 9)
    expect(progressDialog.done).toBe(4)
  })
})
