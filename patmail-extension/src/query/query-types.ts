export interface ParsedQueryXml {
  fields: Record<string, string>
  displayValues: Record<string, string>
  unknownFields: Record<string, string>
  warnings: string[]
}

export interface QueryTemplate {
  id: string
  name: string
  source: 'easy' | 'local'
  sourceQueryId?: string
  queryType: 'FileSearch'
  fields: Record<string, string>
  displayValues?: Record<string, string>
  unknownFields?: Record<string, string>
  version: number
  createdAt: string
  updatedAt: string
}

export type FieldSource = 'base' | 'customer' | 'temporary'

export interface ResolvedQuery {
  fields: Record<string, string>
  sources: Record<string, FieldSource>
  warnings: string[]
}

export interface QueryTemplateRepository {
  list(): Promise<QueryTemplate[]>
  get(id: string): Promise<QueryTemplate | null>
  save(template: QueryTemplate): Promise<void>
  delete(id: string): Promise<void>
}
