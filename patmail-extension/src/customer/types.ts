export interface CustomerQueryProfile {
  id: string
  name: string
  easyCustomerId?: string
  baseTemplateId: string
  overrides: Record<string, string>
  enabled: boolean
  createdAt: string
  updatedAt: string
}
