import { describe, expect, it } from 'vitest'
import { appendFileManageRun, fileManageRunLabel, fileManageRunStatus, parseFileManageRuns, type FileManageRun } from '../src/customer/file-manage-runs'

function run(partial: Partial<FileManageRun> & Pick<FileManageRun, 'id' | 'at'>): FileManageRun {
  return {
    customerName: '客户甲',
    subject: '主题',
    fileCount: 2,
    status: 'submitted',
    note: '已提交给默认审核人。',
    ...partial
  }
}

describe('文件管理本机记录', () => {
  it('按提交结果归类', () => {
    expect(fileManageRunStatus('已提交 1 封给默认审核人。')).toBe('submitted')
    expect(fileManageRunStatus('没有提交到审核人。这封还在审核里，没有再创建。')).toBe('skipped')
    expect(fileManageRunStatus('没有提交到审核人。发文已创建。默认审核人不在下一节点。')).toBe('held')
    expect(fileManageRunStatus('没有提交到审核人。发文页没有案件联系人邮箱，没有提交。')).toBe('failed')
    expect(fileManageRunLabel('submitted')).toBe('已提交给审核人')
  })

  it('新记录排在前面，坏数据丢掉，最多留 200 条', () => {
    const older = run({ id: 'a', at: '2026-10-01T00:00:00.000Z' })
    const newer = run({ id: 'b', at: '2026-10-08T00:00:00.000Z', status: 'failed', note: '没有提交。' })
    const next = appendFileManageRun([older], newer)
    expect(next.map(item => item.id)).toEqual(['b', 'a'])
    const noisy = parseFileManageRuns([newer, { id: 'x', note: '缺字段' }, { cookie: 'no' }])
    expect(noisy).toEqual([newer])
    const many = Array.from({ length: 205 }, (_, index) => run({ id: String(index), at: `2026-10-08T00:00:${String(index).padStart(2, '0')}.000Z` }))
    expect(appendFileManageRun([], many[0]).concat()).toHaveLength(1)
    expect(many.slice(1).reduce((list, item) => appendFileManageRun(list, item), [many[0]])).toHaveLength(200)
  })
})
