import { MessageType, type MessageBridge } from '../shared/message'
import type { MailSender } from './mailset'

export async function fetchMailSenders(bridge: MessageBridge, force: boolean): Promise<{ items: MailSender[]; message: string }> {
  try {
    const response = await bridge.request({ type: MessageType.LoadDictionary, payload: { kind: 'mailSet', force } })
    if (response.type === MessageType.Error) return { items: [], message: response.payload.message }
    if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'mailSet') {
      const message = response.type === MessageType.DictionaryResult && !response.payload.ok
        ? response.payload.error.message
        : '发件邮箱没有从原网站读到。'
      return { items: [], message }
    }
    return { items: response.payload.data.items, message: response.payload.data.items.length ? '' : '原网站没有返回发件邮箱。' }
  } catch {
    return { items: [], message: '读取发件邮箱失败。' }
  }
}
