import { isQueryGuid } from '../query/query-validator'

/** 只有确认过的 EASY 用户 GUID 可以进入任务库、租约和测试写。 */
export function isConfirmedOperator(operatorId: string): boolean {
  return isQueryGuid(operatorId)
}
