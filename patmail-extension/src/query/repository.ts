import type { QueryBundleRepository } from '../storage/query-bundle'
import { cloneTemplate } from './query-validator'
import type { QueryTemplate, QueryTemplateRepository } from './query-types'

export class BundleTemplateRepository implements QueryTemplateRepository {
  constructor(private readonly bundles: QueryBundleRepository) {}

  async list(): Promise<QueryTemplate[]> {
    const { bundle } = await this.bundles.load()
    return bundle.templates.map(cloneTemplate)
  }

  async get(id: string): Promise<QueryTemplate | null> {
    const { bundle } = await this.bundles.load()
    const found = bundle.templates.find(item => item.id === id)
    return found ? cloneTemplate(found) : null
  }

  async save(template: QueryTemplate): Promise<void> {
    if (template.source !== 'local') throw new Error('只能保存 PatMail 本地模板。')
    const { bundle } = await this.bundles.load()
    const next = cloneTemplate(template)
    const index = bundle.templates.findIndex(item => item.id === next.id)
    if (index >= 0) bundle.templates.splice(index, 1, next)
    else bundle.templates.push(next)
    await this.bundles.save(bundle)
  }

  async delete(id: string): Promise<void> {
    const { bundle } = await this.bundles.load()
    const found = bundle.templates.find(item => item.id === id)
    if (found && found.source !== 'local') throw new Error('不能删除原网站历史模板。')
    bundle.templates = bundle.templates.filter(item => item.id !== id)
    await this.bundles.save(bundle)
  }
}
