import type { PageInfo, PageSnapshot } from './types'
import { isPageInfo, isPageSnapshot, isRecord } from './guards'

/** 所有通道共享的 JSON 消息信封；具体消息使用下方的可辨识联合类型。 */
export interface Message<TPayload = unknown> {
  type: string
  payload?: TPayload
}

export const MessageType = {
  ScanPage: 'SCAN_PAGE',
  ScanResult: 'SCAN_RESULT',
  GetPageInfo: 'GET_PAGE_INFO',
  PageInfo: 'PAGE_INFO',
  ShowPanel: 'SHOW_PANEL',
  PanelShown: 'PANEL_SHOWN',
  Ping: 'PING',
  Pong: 'PONG',
  Error: 'ERROR'
} as const

type Request<T extends string> = Message<undefined> & { type: T }
type Response<T extends string, P> = Message<P> & { type: T; payload: P }

export type ContentRequest = Request<'SCAN_PAGE'> | Request<'GET_PAGE_INFO'> | Request<'SHOW_PANEL'> | Request<'PING'>
export type ErrorMessage = Response<'ERROR', { message: string }>
export type BackgroundRequest = Request<'PING'>
export type BackgroundResponse = Response<'PONG', { ok: true }> | ErrorMessage
export type ContentResponse =
  | Response<'SCAN_RESULT', PageSnapshot>
  | Response<'PAGE_INFO', PageInfo>
  | Response<'PANEL_SHOWN', { ok: true }>
  | BackgroundResponse
export type AppMessage = ContentRequest | ContentResponse

/** 先校验未知值，再缩窄类型，避免把畸形负载当成合法扫描结果。 */
export function isMessage(value: unknown): value is AppMessage {
  if (!isRecord(value)) return false
  switch (value.type) {
    case MessageType.ScanPage:
    case MessageType.GetPageInfo:
    case MessageType.ShowPanel:
    case MessageType.Ping:
      return value.payload === undefined
    case MessageType.ScanResult:
      return isPageSnapshot(value.payload)
    case MessageType.PageInfo:
      return isPageInfo(value.payload)
    case MessageType.PanelShown:
    case MessageType.Pong:
      return isRecord(value.payload) && value.payload.ok === true
    case MessageType.Error:
      return isRecord(value.payload) && typeof value.payload.message === 'string'
    default:
      return false
  }
}

export function isContentRequest(value: unknown): value is ContentRequest {
  return isMessage(value) && (
    value.type === MessageType.ScanPage || value.type === MessageType.GetPageInfo ||
    value.type === MessageType.ShowPanel || value.type === MessageType.Ping
  )
}

/** 浮窗和 Content Script 同处隔离环境，通过依赖注入收发消息。 */
export interface MessageBridge {
  request(message: ContentRequest): Promise<ContentResponse>
}

