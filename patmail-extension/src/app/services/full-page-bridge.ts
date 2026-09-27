import { MessageType, type ContentResponse, type MessageBridge } from '../../shared/message'
import { sendToBackground } from '../../utils/runtime'

/** 完整页面只通过后台把有类型的请求送到已绑定的 EASY 标签页。 */
export function createFullPageBridge(): MessageBridge {
  return {
    async request(message): Promise<ContentResponse> {
      const slow = message.type === MessageType.SearchFiles || message.type === MessageType.SearchLimitMonitor
      const response = await sendToBackground({ type: MessageType.Workspace, payload: { action: 'forward', message } }, slow ? 70_000 : 30_000)
      if (!response || response.type !== MessageType.WorkspaceResult || !response.payload.forwarded || response.payload.forwarded.type === MessageType.Error || response.payload.forwarded.type === MessageType.WorkspaceResult) {
        const text = response?.type === MessageType.WorkspaceResult ? response.payload.message : ''
        return { type: MessageType.Error, payload: { message: text || 'EASY 通道没有返回结果。' } }
      }
      return response.payload.forwarded as ContentResponse
    }
  }
}
