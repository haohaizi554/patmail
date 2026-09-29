import { isQueryGuid } from '../../query/query-validator'
import { isWriteSwitchOpen } from '../../settings/write-switch'
import type { SendMode } from '../types'

/** 跟系统设置里的写开关走。默认打开。 */
export function mailWritesEnabled(): boolean {
  return isWriteSwitchOpen()
}

/** 抓包只确认了合并发文 mailstyle=1。创建和保存的响应原文还没落下。关联文件的分隔符已从 mail.js 核对。 */
export const WRITE_CONTRACT = {
  mergeMailStyleConfirmed: true,
  singleMailStyleConfirmed: false,
  mailCustomerBodyCaptured: false,
  saveResponseBodyCaptured: false,
  relatedFileIdFormatConfirmed: true
} as const

/** mail.js 把勾选文件的 objid 用分号拼进 file_ids。空列表提交空字符串。 */
export function encodeRelatedFileIds(fileIds: string[]): string | null {
  if (fileIds.some(id => !isQueryGuid(id))) return null
  return fileIds.join(';')
}

export function liveWriteBlockers(mode: SendMode): string[] {
  const reasons: string[] = []
  if (!mailWritesEnabled()) reasons.push('写开关已关闭。')
  if (!WRITE_CONTRACT.mailCustomerBodyCaptured) reasons.push('MailCustomer 的响应正文还没有核对，不能创建。')
  if (!WRITE_CONTRACT.saveResponseBodyCaptured) reasons.push('SaveMailInfo 的响应正文还没有核对，不能保存。')
  if (!WRITE_CONTRACT.relatedFileIdFormatConfirmed) reasons.push('SaveMailRalteCaseFile 的 file_ids 格式还没有核对。')
  if (mode === 'single_file' || !WRITE_CONTRACT.singleMailStyleConfirmed && mode !== 'merge_by_customer_description') {
    reasons.push('单个来文的 mailstyle 还没有在抓包里出现。')
  }
  if (mode === 'merge_by_customer_description' && !WRITE_CONTRACT.mergeMailStyleConfirmed) reasons.push('合并发文的 mailstyle 未确认。')
  return reasons
}

export interface MailWriteGate {
  blockers(mode: SendMode): string[]
  /** 返回 null 表示非空 file_ids 的格式还没核对，调用方不得发送关联请求。 */
  relatedFileIds(fileIds: string[]): string | null
}

export const productionGate: MailWriteGate = {
  blockers: liveWriteBlockers,
  relatedFileIds: encodeRelatedFileIds
}
