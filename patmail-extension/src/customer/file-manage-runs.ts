import type { FileManageRun, FileManageRunInput } from '../shared/message'

export type { FileManageRun, FileManageRunInput }

export function fileManageRunKey(origin: string, operatorId: string): string {
  return `patmail.fileManageRuns.v1:${origin}:${operatorId}`
}

export function fileManageRunStatus(text: string): FileManageRunInput['status'] {
  if (text.startsWith('已提交')) return 'submitted'
  if (/还在审核里|已经提交过|没有要提交/.test(text)) return 'skipped'
  if (/已创建|沿用这封/.test(text)) return 'held'
  return 'failed'
}

export function fileManageRunLabel(status: FileManageRunInput['status']): string {
  if (status === 'submitted') return '已提交给审核人'
  if (status === 'held') return '已创建，还没提交'
  if (status === 'skipped') return '没有再创建'
  return '没有提交'
}

export function parseFileManageRuns(value: unknown): FileManageRun[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const row = item as Partial<FileManageRun>
    if (typeof row.id !== 'string' || !row.id.trim() || row.id.length > 80) return []
    if (typeof row.at !== 'string' || row.at.length > 40) return []
    if (typeof row.customerName !== 'string' || row.customerName.length > 120) return []
    if (typeof row.subject !== 'string' || row.subject.length > 500) return []
    if (typeof row.note !== 'string' || row.note.length > 200) return []
    if (typeof row.fileCount !== 'number' || !Number.isInteger(row.fileCount) || row.fileCount < 1 || row.fileCount > 100) return []
    if (row.status !== 'submitted' && row.status !== 'held' && row.status !== 'skipped' && row.status !== 'failed') return []
    return [{
      id: row.id,
      at: row.at,
      customerName: row.customerName,
      subject: row.subject,
      fileCount: row.fileCount,
      status: row.status,
      note: row.note
    }]
  }).slice(0, 200)
}

/** 新的记在前面。同一编号只留最新一条。最多留 200 条。 */
export function appendFileManageRun(existing: readonly FileManageRun[], run: FileManageRun): FileManageRun[] {
  const rest = existing.filter(item => item.id !== run.id)
  return [run, ...rest].slice(0, 200)
}

const writeQueues = new Map<string, Promise<unknown>>()

/** 同一账号的写入排队，避免两封同时提交时互相盖掉。 */
export function enqueueFileManageWrite<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve()
  const run = previous.then(work, work)
  writeQueues.set(key, run.then(() => undefined, () => undefined))
  return run
}
