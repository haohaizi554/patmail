import type { QueryBundleRepository } from '../storage/query-bundle'
import type { CustomerQueryProfile } from './types'

export interface CustomerRepository {
  list(): Promise<CustomerQueryProfile[]>
  get(id: string): Promise<CustomerQueryProfile | null>
  save(profile: CustomerQueryProfile): Promise<void>
  delete(id: string): Promise<void>
}

function clone(profile: CustomerQueryProfile): CustomerQueryProfile {
  return { ...profile, overrides: { ...profile.overrides }, ...(profile.easyCustomerId ? { easyCustomerId: profile.easyCustomerId } : {}) }
}

export class BundleCustomerRepository implements CustomerRepository {
  constructor(private readonly bundles: QueryBundleRepository) {}

  async list(): Promise<CustomerQueryProfile[]> {
    const { bundle } = await this.bundles.load()
    return bundle.customers.map(clone)
  }

  async get(id: string): Promise<CustomerQueryProfile | null> {
    const { bundle } = await this.bundles.load()
    const found = bundle.customers.find(item => item.id === id)
    return found ? clone(found) : null
  }

  async save(profile: CustomerQueryProfile): Promise<void> {
    const { bundle } = await this.bundles.load()
    const next = clone(profile)
    const index = bundle.customers.findIndex(item => item.id === next.id)
    if (index >= 0) bundle.customers.splice(index, 1, next)
    else bundle.customers.push(next)
    await this.bundles.save(bundle)
  }

  async delete(id: string): Promise<void> {
    const { bundle } = await this.bundles.load()
    bundle.customers = bundle.customers.filter(item => item.id !== id)
    await this.bundles.save(bundle)
  }
}
