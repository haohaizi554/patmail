/** 没有真实发送核验时，记录只描述本地或未确认状态。 */
export function describeTaskRecord(status: string): string {
  if (status === 'UNKNOWN') return '结果未知'
  if (status === 'STALE') return '计划已过期'
  if (status === 'DRY_RUN_COMPLETED' || status === 'READY' || status === 'CREATED') return '本地计划'
  if (status === 'PARTIAL_FAILURE') return '部分步骤未完成'
  if (status === 'COMPLETED') return '本地流程结束，发送未核验'
  if (status === 'FAILED' || status === 'BLOCKED') return '未完成'
  return '尚未确认发送'
}

export function describeDraftState(input: { status: string; easyMailId: string; stage: string; verified: boolean }): string {
  if (input.verified) return '实际发送已核验'
  if (input.easyMailId && input.stage === 'MAIL_SAVE') return 'EASY 邮件已保存'
  if (input.easyMailId) return 'EASY 邮件已创建'
  if (input.status === 'UNKNOWN') return '结果未知'
  return '本地草稿'
}

export function describeItemRecord(status: string, easyMailId: string): string {
  if (status === 'UNKNOWN') return '结果未知'
  if (status === 'PARTIAL_FAILURE') return '部分失败'
  if (status === 'DRY_RUN_COMPLETED' || status === 'READY') return '本地草稿'
  if (easyMailId) return '记录了邮件标识，发送未确认'
  return '尚未创建邮件'
}
