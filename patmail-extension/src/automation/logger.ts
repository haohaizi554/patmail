import type { AutomationLog } from './types'

const SECRET = /cookie|authorization|password|token|sessionid/i

export function createLog(partial: Omit<AutomationLog, 'timestamp'> & { timestamp?: string }): AutomationLog {
  return { ...partial, timestamp: partial.timestamp ?? new Date().toISOString() }
}

export function exportDiagnostic(logs: AutomationLog[]): string {
  const text = JSON.stringify(logs.map(item => ({ ...item, event: item.event.slice(0, 80), errorCode: item.errorCode.slice(0, 80) })))
  if (SECRET.test(text)) throw new Error('诊断包含有凭证字段，已停止导出。')
  return text
}
