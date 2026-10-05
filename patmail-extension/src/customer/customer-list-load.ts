import { MessageType, type MessageBridge } from '../shared/message'
import type { EasyCustomerOption } from './customer-list'

export async function fetchCustomerList(bridge: MessageBridge, force: boolean): Promise<{ ok: boolean; customers: EasyCustomerOption[]; message: string }> {
  try {
    const response = await bridge.request({ type: MessageType.LoadDictionary, payload: { kind: 'customerList', force } })
    if (response.type === MessageType.Error) return { ok: false, customers: [], message: response.payload.message }
    if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'customerList') {
      const message = response.type === MessageType.DictionaryResult && !response.payload.ok
        ? response.payload.error.message
        : '客户名单没有从原网站读到。'
      return { ok: false, customers: [], message }
    }
    return {
      ok: true,
      customers: response.payload.data.customers,
      message: response.payload.data.customers.length ? '' : '原网站没有返回客户。'
    }
  } catch {
    return { ok: false, customers: [], message: '读取客户名单失败。' }
  }
}
