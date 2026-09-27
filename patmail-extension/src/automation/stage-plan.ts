import { STAGES } from './state'
import type { AutomationStagePlan, AutomationTask, EvidenceLevel } from './types'

const DIAGNOSTIC = new Set(['SESSION_CHECK', 'FILE_QUERY', 'MAIL_READ', 'MAIL_VERIFY', 'WORKFLOW_READ', 'WORKFLOW_VERIFY', 'FINAL_VERIFY'])

const ISSUE_STAGE: Record<string, AutomationStagePlan['stage']> = {
  MISSING_CUSTOMER: 'CUSTOMER_RESOLVE',
  MISSING_POLICY: 'CUSTOMER_RESOLVE',
  MISSING_DESCRIPTION: 'DESCRIPTION_MAPPING',
  MISSING_MAPPING: 'DESCRIPTION_MAPPING',
  MISSING_RECIPIENT: 'RECIPIENT_RESOLVE'
}

/** 按阶段声明生成计划。写阶段在契约和写开关未满足时不可执行。 */
export function buildStagePlans(task: AutomationTask, contract: EvidenceLevel = 'UNKNOWN'): AutomationStagePlan[] {
  const plans: AutomationStagePlan[] = []
  for (const definition of Object.values(STAGES)) {
    for (const item of task.items.length > 0 ? task.items : [null]) {
      const issues = item ? [...item.issues, ...task.issues.filter(issue => issue.itemId === '' || issue.itemId === item.itemId)] : task.issues
      const blockers = issues.filter(issue => ISSUE_STAGE[issue.code] === definition.id).map(issue => issue.message)
      const write = definition.sideEffect === 'write'
      const gate = task.identityGate
      if (write) blockers.push('写操作默认关闭。', '接口还没有完成请求、响应和回读核验。')
      if (write && gate?.fileSource === 'FILE_SOURCE_UNVERIFIED') blockers.push('文件来源尚未经查询响应确认。')
      if (write && gate?.mixedQuerySession) blockers.push('所选文件不属于同一次查询运行。')
      if (write && gate?.persistence && gate.persistence !== 'PERSISTED') blockers.push('查询来源尚未持久化，执行前需要重新核验。')
      if (gate && !gate.descriptionIdsVerified && (write || definition.id === 'DESCRIPTION_MAPPING')) blockers.push('文件描述内部 ID 尚未确认可用于发文。')
      if (gate && !gate.customerIdsVerified && (definition.id === 'MAIL_CREATE' || definition.id === 'MAIL_SAVE')) blockers.push('EASY 客户 GUID 尚未确认。')
      if (task.status === 'BLOCKED' && !DIAGNOSTIC.has(definition.id)) blockers.push('任务尚未满足执行条件。')
      plans.push({
        stage: definition.id,
        itemId: item?.itemId ?? '',
        sideEffect: definition.sideEffect,
        precondition: definition.precondition,
        expectedInput: definition.input,
        expectedOutput: definition.output,
        canExecute: !write && blockers.length === 0,
        blockers,
        requiresConfirmation: definition.needsConfirmation || write,
        contractStatus: write ? 'UNKNOWN' : contract
      })
    }
  }
  return plans
}
