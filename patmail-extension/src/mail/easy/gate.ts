import type { SendMode } from '../types'

/** 真实写操作默认关闭。页面消息不能打开它。 */
export const EASY_MAIL_WRITES_ENABLED = false

/** 抓包只确认了合并发文 mailstyle=1。响应正文和单发参数都还没核对。 */
export const WRITE_CONTRACT = {
  mergeMailStyleConfirmed: true,
  singleMailStyleConfirmed: false,
  mailCustomerBodyCaptured: false,
  saveResponseBodyCaptured: false,
  relatedFileIdFormatConfirmed: false
} as const

export function liveWriteBlockers(mode: SendMode): string[] {
  const reasons: string[] = []
  if (!EASY_MAIL_WRITES_ENABLED) reasons.push('真实写操作默认关闭。')
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
  relatedFileIds: () => null
}
