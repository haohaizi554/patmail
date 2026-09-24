import type { CustomerRecipientTemplate } from '../types'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase()
}

export function uniqueAddresses(values: string[]): { addresses: string[]; invalid: string[] } {
  const addresses: string[] = []
  const invalid: string[] = []
  for (const value of values) {
    const address = normalizeAddress(value)
    if (!address) continue
    if (!EMAIL.test(address) || address.length > 200) invalid.push(address)
    else if (!addresses.includes(address)) addresses.push(address)
  }
  return { addresses, invalid }
}

export function resolveRecipients(customerProfileId: string, templates: CustomerRecipientTemplate[], preferredId?: string): CustomerRecipientTemplate | null {
  const own = templates.filter(item => item.enabled && item.customerProfileId === customerProfileId)
  return own.find(item => item.id === preferredId) ?? own.find(item => item.isDefault) ?? own[0] ?? null
}
