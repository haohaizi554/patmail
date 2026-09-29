import type { LimitMailStyle, QuerySurfaceId } from '../../customer/types'
import type { CustomerMailPolicy, SendMode } from '../types'

export const NEW_POLICY_SET = '__new__'

export interface CustomerPolicyInput {
  customerProfileId: string
  querySurface: QuerySurfaceId
  sendMode: SendMode | ''
  limitMailStyle: LimitMailStyle | ''
  remark: string
  /** 正在改的那一套。备注改了也替换这一套。空字符串表示新加。 */
  replaceKey: string
}

export function policySurface(item: { querySurface?: string }): QuerySurfaceId {
  return item.querySurface === 'limit' ? 'limit' : 'file'
}

/** 备注去掉首尾空白，最长 80 字。没写就是空字符串。 */
export function policyRemark(value: string | undefined): string {
  return (value ?? '').trim().slice(0, 80)
}

/** 同一客户、同一查询方式、同一备注是一套。 */
export function policySetKey(item: { customerProfileId: string; querySurface?: string; remark?: string }): string {
  return JSON.stringify([item.customerProfileId, policySurface(item), policyRemark(item.remark)])
}

export function upsertCustomerPolicy(
  policies: CustomerMailPolicy[],
  input: CustomerPolicyInput,
  now = new Date().toISOString()
): { ok: true; policies: CustomerMailPolicy[] } | { ok: false; message: string } {
  const remark = policyRemark(input.remark)
  const nextKey = policySetKey({ customerProfileId: input.customerProfileId, querySurface: input.querySurface, remark })
  const replaceKey = input.replaceKey
  if (replaceKey && replaceKey !== nextKey && policies.some(item => policySetKey(item) === nextKey)) {
    return { ok: false, message: '这个客户在这个查询方式下已经有同样的备注。' }
  }
  const previous = policies.find(item => policySetKey(item) === (replaceKey || nextKey))
  const saved: CustomerMailPolicy = {
    customerProfileId: input.customerProfileId,
    querySurface: input.querySurface,
    ...(remark ? { remark } : {}),
    enabled: true,
    version: (previous?.version ?? 0) + 1,
    updatedAt: now,
    ...(input.querySurface === 'file'
      ? { sendMode: input.sendMode as SendMode }
      : { limitMailStyle: input.limitMailStyle as LimitMailStyle }),
    ...(previous?.mailTypeId && previous.mailTypeName ? { mailTypeId: previous.mailTypeId, mailTypeName: previous.mailTypeName } : {}),
    ...(previous?.recipientTemplateId ? { recipientTemplateId: previous.recipientTemplateId } : {})
  }
  const drop = replaceKey || nextKey
  return { ok: true, policies: policies.filter(item => policySetKey(item) !== drop).concat(saved) }
}

export function removeCustomerPolicy(
  policies: CustomerMailPolicy[],
  target: { customerProfileId: string; querySurface: QuerySurfaceId; remark: string }
): CustomerMailPolicy[] {
  const key = policySetKey(target)
  return policies.filter(item => policySetKey(item) !== key)
}
