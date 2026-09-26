export interface CustomerQueryProfile {
  id: string
  name: string
  easyCustomerId?: string
  baseTemplateId: string
  overrides: Record<string, string>
  enabled: boolean
  /** 缺省视为 1。保存时必须带上读取到的版本，避免后写覆盖先写。 */
  revision?: number
  createdAt: string
  updatedAt: string
}
