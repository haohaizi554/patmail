export type SchemaControlType = 'text' | 'select' | 'tree' | 'multi-select' | 'date' | 'date-range' | 'checkbox'
export type SchemaValueType = 'text' | 'internal-id' | 'date' | 'boolean-string'
export type SchemaSource = 'api' | 'history' | 'dom' | 'local'

export interface BusinessFieldSchema {
  key: string
  label: string
  controlType: SchemaControlType
  valueType: SchemaValueType
  source: SchemaSource
  dictionaryKey?: string
  enabled: boolean
  required?: boolean
  dependsOn?: string[]
  endKey?: string
  advanced?: boolean
}
