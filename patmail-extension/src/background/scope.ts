import { isConfirmedOperator } from '../automation/operator'
import { MessageType, type AppMessage } from '../shared/message'
import type { EasyConnectionContext } from '../shared/connection'

/** 扩展页面和页面里的浮窗都不能用自行填写的用户标识读取其他账号。 */
export function scopeExtensionPageMessage(message: AppMessage, connection: EasyConnectionContext): AppMessage | { error: string } {
  const ready = connection.sessionStatus === 'authenticated' && isConfirmedOperator(connection.operatorId)
  const deny = '尚未确认 EASY 用户，不能读取其他账号的数据。'
  if (message.type === MessageType.ListTasks || message.type === MessageType.ListAcceptance || message.type === MessageType.RecoverExecution) {
    if (!ready) return { error: deny }
    return { ...message, payload: { origin: connection.easyOrigin, operatorId: connection.operatorId } }
  }
  if (message.type === MessageType.GetTask || message.type === MessageType.ArchiveTask || message.type === MessageType.ValidateTaskMetadata) {
    if (!ready) return { error: deny }
    return { ...message, payload: { ...message.payload, origin: connection.easyOrigin, operatorId: connection.operatorId } }
  }
  if (message.type === MessageType.SaveTask) {
    if (!ready) return { error: deny }
    if (message.payload.task.origin !== connection.easyOrigin || message.payload.task.operatorId !== connection.operatorId) {
      return { error: '任务账号与当前绑定会话不一致。' }
    }
  }
  if (message.type === MessageType.ClaimExecution || message.type === MessageType.MarkExecutionPrepared ||
    message.type === MessageType.MarkExecutionSent || message.type === MessageType.MarkExecutionResponse ||
    message.type === MessageType.MarkExecutionVerified || message.type === MessageType.CompleteExecution ||
    message.type === MessageType.ReleaseExecution || message.type === MessageType.MarkExecutionUnknown) {
    if (!ready) return { error: deny }
    if (message.payload.origin !== connection.easyOrigin || message.payload.operatorId !== connection.operatorId) {
      return { error: '执行账号与当前绑定会话不一致。' }
    }
  }
  return message
}
