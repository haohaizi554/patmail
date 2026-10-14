/** 一列在分配前的宽度。content 含单元格左右内边距。 */
export type ColumnFit = {
  /** 空内容或短内容时的下限。表头宽度通常就是这个下限。 */
  min: number
  /** 这一列里最宽的文字。 */
  content: number
  /** 按文字定宽，不伸长也不缩短。期限表里的日期和流程状态用这个。 */
  lock?: boolean
  /** 每列都能放下文字之后，多出来的宽度分到这里。 */
  grow?: boolean
}

/**
 * 先给每列 max(最小宽度, 文字宽度)。
 * 行还有空位时，空位只补给还想变宽的列，短列停在下限。
 * 行不够宽时，先压可伸长的列，再压其余列，锁定列保持文字宽度。
 * 只有分到的宽度仍小于文字宽度时，这一列才该省略。
 */
export function assignColumnWidths(columns: readonly ColumnFit[], container: number): number[] {
  const specs = columns.map(column => ({
    min: Math.max(0, Math.floor(column.min)),
    content: Math.max(0, Math.floor(column.content)),
    lock: column.lock === true,
    grow: column.grow === true && column.lock !== true
  }))
  const pref = specs.map(column => Math.max(column.min, column.content))
  const widths = pref.slice()
  const target = Math.max(0, Math.floor(container))
  const indexes = (pick: (column: (typeof specs)[number]) => boolean) =>
    specs.map((column, index) => (pick(column) ? index : -1)).filter(index => index >= 0)
  const lockIdx = indexes(column => column.lock)
  const growIdx = indexes(column => column.grow)
  const fitIdx = indexes(column => !column.lock && !column.grow)
  const sumAt = (list: number[], chosen: number[]) => chosen.reduce((total, index) => total + list[index], 0)

  const lockW = sumAt(pref, lockIdx)
  const fitW = sumAt(pref, fitIdx)
  const growW = sumAt(pref, growIdx)
  const fitMin = sumAt(specs.map(column => column.min), fitIdx)
  const growMin = sumAt(specs.map(column => column.min), growIdx)

  if (target >= lockW + fitW + growW) {
    const receivers = growIdx.length ? growIdx : (fitIdx.length ? fitIdx : lockIdx)
    share(widths, receivers, leftoverWeight(specs, receivers), target - lockW - fitW - growW)
    return widths
  }

  const budget = target - lockW
  if (budget >= fitW + growMin) {
    growIdx.forEach(index => { widths[index] = specs[index].min })
    share(widths, growIdx, slackWeight(specs, pref, growIdx), budget - fitW - growMin)
    return widths
  }

  if (budget >= fitMin + growMin) {
    growIdx.forEach(index => { widths[index] = specs[index].min })
    fitIdx.forEach(index => { widths[index] = specs[index].min })
    share(widths, fitIdx, slackWeight(specs, pref, fitIdx), budget - growMin - fitMin)
    return widths
  }

  fitIdx.forEach(index => { widths[index] = specs[index].min })
  growIdx.forEach(index => { widths[index] = specs[index].min })
  return widths
}

function leftoverWeight(specs: { min: number; content: number }[], indexes: number[]): number[] {
  return indexes.map(index => Math.max(0, specs[index].content - specs[index].min))
}

function slackWeight(specs: { min: number }[], pref: number[], indexes: number[]): number[] {
  return indexes.map(index => Math.max(0, pref[index] - specs[index].min))
}

function share(widths: number[], indexes: number[], weights: number[], amount: number): void {
  if (!indexes.length || amount <= 0) return
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let left = amount
  indexes.forEach((index, order) => {
    const last = order === indexes.length - 1
    const portion = total <= 0
      ? Math.floor(amount / indexes.length)
      : Math.floor(amount * weights[order] / total)
    const given = last ? left : portion
    widths[index] += given
    left -= given
  })
}
