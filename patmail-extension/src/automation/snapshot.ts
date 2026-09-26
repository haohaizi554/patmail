import { isQueryGuid } from '../query/query-validator'
import type { CustomerQueryProfile } from '../customer/types'
import type { SelectedPatentFile } from '../mail/types'
import type { CustomerIdentitySnapshot } from './types'

/** 复制成普通对象。响应式代理不能直接 structuredClone。 */
export function plainClone<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function createTaskSnapshot<T>(value: T): T {
  return plainClone(value)
}

function byText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/** 客户身份来自 Profile 上的 EASY GUID。本地 Profile 编号不会被写进 easyCustomerId。 */
export function customerIdentities(files: SelectedPatentFile[], profiles: CustomerQueryProfile[]): CustomerIdentitySnapshot[] {
  const rows = new Map<string, CustomerIdentitySnapshot>()
  for (const file of files) {
    const profileId = file.customerBinding?.profileId || file.customerProfileId || ''
    if (!profileId) continue
    const profile = profiles.find(item => item.id === profileId)
    const easyCustomerId = profile?.easyCustomerId && isQueryGuid(profile.easyCustomerId) ? profile.easyCustomerId : ''
    const row: CustomerIdentitySnapshot = {
      profileId,
      profileName: profile?.name || file.customerBinding?.profileName || '',
      easyCustomerId,
      bindingSource: file.customerBinding?.source || '',
      confirmed: file.customerBinding?.confirmed === true,
      baseTemplateId: profile?.baseTemplateId ?? '',
      overrideFingerprint: overrideFingerprint(profile?.overrides),
      enabled: profile ? profile.enabled : false
    }
    rows.set([row.profileId, row.easyCustomerId, row.bindingSource, row.confirmed ? '1' : '0'].join('\u0000'), row)
  }
  return [...rows.values()].sort((left, right) => byText(left.profileId, right.profileId) || byText(left.easyCustomerId, right.easyCustomerId) || byText(left.bindingSource, right.bindingSource))
}

export function emptyIdentity(): CustomerIdentitySnapshot {
  return { profileId: '', profileName: '', easyCustomerId: '', bindingSource: '', confirmed: false, baseTemplateId: '', overrideFingerprint: '', enabled: false }
}

function overrideFingerprint(overrides: Record<string, string> | undefined): string {
  if (!overrides) return ''
  return Object.keys(overrides).sort().map(key => `${key}=${overrides[key]}`).join('\n')
}

/** 字符码求和已废弃，不能用来判断模板是否变化。模板变化看 queryDependencies。 */
export function queryTemplateVersionOf(_profiles: Array<{ id: string; updatedAt: string }>): number {
  return 0
}
