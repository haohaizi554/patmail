import { describe, expect, it } from 'vitest'
import { assignColumnWidths, type ColumnFit } from '../src/shell/column-fit'

function sum(widths: number[]): number {
  return widths.reduce((total, width) => total + width, 0)
}

describe('期限表列宽', () => {
  it('两列都没超出下限时，空位平均铺满，锁定列不加宽', () => {
    const columns: ColumnFit[] = [
      { min: 72, content: 36, grow: true },
      { min: 64, content: 40, grow: true },
      { min: 80, content: 88, lock: true }
    ]
    const widths = assignColumnWidths(columns, 72 + 64 + 88 + 200)
    expect(widths).toEqual([172, 164, 88])
  })

  it('只有一列超出下限时，短列停在下限，空位都给这一列', () => {
    const widths = assignColumnWidths([
      { min: 72, content: 36, grow: true },
      { min: 64, content: 200, grow: true },
      { min: 80, content: 88, lock: true }
    ], 72 + 200 + 88 + 50)
    expect(widths).toEqual([72, 250, 88])
  })

  it('行不够宽时只省略还没分到文字宽度的列，旁边已放下的列不再留白', () => {
    const widths = assignColumnWidths([
      { min: 72, content: 130 },
      { min: 64, content: 420, grow: true },
      { min: 64, content: 64, grow: true },
      { min: 80, content: 180, lock: true }
    ], 130 + 64 + 64 + 180 + 40)
    expect(widths).toEqual([130, 104, 64, 180])
    expect(sum(widths)).toBe(130 + 64 + 64 + 180 + 40)
  })

  it('可伸长的列已经到下限后，才压缩其余列', () => {
    const widths = assignColumnWidths([
      { min: 72, content: 160 },
      { min: 48, content: 300, grow: true },
      { min: 80, content: 180, lock: true }
    ], 72 + 48 + 180 + 20)
    expect(widths[2]).toBe(180)
    expect(widths[1]).toBe(48)
    expect(widths[0]).toBe(72 + 20)
    expect(widths[0]).toBeLessThan(160)
  })

  it('锁定列在行比它还窄时仍保持文字宽度', () => {
    const widths = assignColumnWidths([
      { min: 40, content: 40, grow: true },
      { min: 20, content: 200, lock: true }
    ], 100)
    expect(widths).toEqual([40, 200])
  })

  it('每列都能放下时铺满整行，锁定列不加空白', () => {
    const widths = assignColumnWidths([
      { min: 40, content: 100, lock: true },
      { min: 40, content: 80, grow: true },
      { min: 40, content: 60 }
    ], 400)
    expect(widths).toEqual([100, 240, 60])
  })
})
