import { MessageType, type ContentResponse, type MessageBridge } from '../../shared/message'
import { fileSearchTimeoutMs } from '../../api/file-search-params'
import { sendToBackground } from '../../utils/runtime'

/** 完整页面只通过后台把有类型的请求送到已绑定的 EASY 标签页。 */
export function createFullPageBridge(): MessageBridge {
  return {
    async request(message): Promise<ContentResponse> {
      const lookupFlow = message.type === MessageType.LookupIcFlow
      const contactExport = message.type === MessageType.ExportCaseContacts
      // 提交一封信要串完建单、联系人、保存和提交流程，并成几件的信更长。原站高峰期 30 秒不够，放宽到 3 分钟。
      const submitWait = message.type === MessageType.SubmitLimitMail || message.type === MessageType.SubmitFileManage ? 180_000 : 0
      const slow = contactExport || submitWait > 0 || message.type === MessageType.SearchFiles || message.type === MessageType.SearchLimitMonitor
        || message.type === MessageType.ListMailProcesses || message.type === MessageType.ListFlowReviewers
        || message.type === MessageType.ReadCaseDemands
        || message.type === MessageType.ReadCaseBusFlow
        || message.type === MessageType.ReadCustomerDemands
        || message.type === MessageType.ReadCustomerDirectory
        || message.type === MessageType.ReadMailContacts
        || message.type === MessageType.DiagnoseExistingMail
        || message.type === MessageType.LoadDictionary || message.type === MessageType.ScanFileSearchForm
      const searchWait = message.type === MessageType.SearchFiles || message.type === MessageType.SearchLimitMonitor
        ? fileSearchTimeoutMs(message.payload.timeoutMs) + 15_000 : 0
      const response = await sendToBackground({ type: MessageType.Workspace, payload: { action: 'forward', message } }, lookupFlow ? 300_000 : contactExport ? 180_000 : submitWait || searchWait || (slow ? 70_000 : 30_000))
      if (response?.type === MessageType.Error) return response
      const forwarded = response?.type === MessageType.WorkspaceResult ? response.payload.forwarded : null
      if (forwarded && forwarded.type === MessageType.Error) return forwarded
      if (!response || response.type !== MessageType.WorkspaceResult || !forwarded || forwarded.type === MessageType.WorkspaceResult) {
        const text = response?.type === MessageType.WorkspaceResult ? response.payload.message : ''
        return { type: MessageType.Error, payload: { message: text || 'EASY 通道没有返回结果。' } }
      }
      return forwarded as ContentResponse
    }
  }
}
