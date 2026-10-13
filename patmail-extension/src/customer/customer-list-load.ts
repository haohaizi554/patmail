import { MessageType, type MessageBridge } from '../shared/message'
import type { EasyCustomerOption } from './customer-list'
import { readSmeCustomerList } from './sme-customers'

export interface CustomerListLoad {
  ok: boolean
  customers: EasyCustomerOption[]
  /** 中小客户的名单快照才有：拉取时间。 */
  takenAt?: string
  message: string
}

export async function fetchCustomerList(bridge: MessageBridge | undefined, force: boolean): Promise<CustomerListLoad> {
  try {
    const local = await readSmeCustomerList(force)
    if (local) {
      if (!local.ok) return { ok: false, customers: [], message: local.error.message }
      const takenAt = local.data.takenAt
      return {
        ok: true,
        customers: local.data.customers,
        takenAt,
        message: takenAt
          ? `中小客户名单来自数据库快照，共 ${local.data.customers.length} 家，拉取于 ${takenAt}。`
          : ''
      }
    }
    if (!bridge) return { ok: false, customers: [], message: '读取客户名单失败。' }
    const response = await bridge.request({ type: MessageType.LoadDictionary, payload: { kind: 'customerList', force } })
    if (response.type === MessageType.Error) return { ok: false, customers: [], message: response.payload.message }
    if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'customerList') {
      const message = response.type === MessageType.DictionaryResult && !response.payload.ok
        ? response.payload.error.message
        : '客户名单没有从原网站读到。'
      return { ok: false, customers: [], message }
    }
    const data = response.payload.data
    const takenAt = typeof data.takenAt === 'string' ? data.takenAt : undefined
    return {
      ok: true,
      customers: data.customers,
      takenAt,
      message: takenAt
        ? `中小客户名单来自数据库快照，共 ${data.customers.length} 家，拉取于 ${takenAt}。`
        : data.customers.length ? '' : '原网站没有返回客户。'
    }
  } catch {
    return { ok: false, customers: [], message: '读取客户名单失败。' }
  }
}