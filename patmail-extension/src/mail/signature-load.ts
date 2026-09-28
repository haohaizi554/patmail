import { MessageType, type MessageBridge } from '../shared/message'
import type { MailSignatureItem } from './easy/signature-read'

export interface LoadedSignature {
  reserved: MailSignatureItem | null
  items: MailSignatureItem[]
  note: string
}

export async function fetchMailboxSignature(bridge: MessageBridge, mailsetId: string, force: boolean): Promise<{ data: LoadedSignature | null; message: string }> {
  try {
    const response = await bridge.request({ type: MessageType.LoadDictionary, payload: { kind: 'signature', force, mailsetId } })
    if (response.type === MessageType.Error) return { data: null, message: response.payload.message }
    if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'signature') {
      const message = response.type === MessageType.DictionaryResult && !response.payload.ok
        ? response.payload.error.message
        : '签名没有从原网站读到。'
      return { data: null, message }
    }
    const data = response.payload.data
    return { data: { reserved: data.reserved, items: data.items, note: data.note }, message: data.note }
  } catch {
    return { data: null, message: '读取签名失败。' }
  }
}
