export interface DictionaryOption {
  value: string
  label: string
  disabled?: boolean
  parentValue?: string
  order?: number
  metadata?: Record<string, string>
}

export type DictionaryStatus = 'ready' | 'empty' | 'partial' | 'invalid'

export interface NormalizedDictionary {
  key: string
  options: DictionaryOption[]
  status: DictionaryStatus
  warnings: string[]
}

export interface BasicDataSnapshot {
  kind: 'basic'
  dictionaries: Record<string, NormalizedDictionary>
  responseKeys: string[]
}

export interface FlowDataSnapshot {
  kind: 'flow'
  dictionaries: Record<string, NormalizedDictionary>
  responseKeys: string[]
}

export interface FileTypeNode {
  id: string
  name: string
  parentId: string
  order: number
  childIds: string[]
}

export interface FileTypeTreeSnapshot {
  kind: 'fileType'
  caseTypeId: string
  nodes: FileTypeNode[]
  rootIds: string[]
  diagnostics: string[]
}

export interface CustomFieldColumn {
  columnId: string
  field: string
  label: string
  enabled: boolean
  controlName: string
  status: 'ready' | 'partial'
}

export interface FieldColumnSnapshot {
  kind: 'fieldColumn'
  columns: CustomFieldColumn[]
  warnings: string[]
}

export interface ListColumnSnapshot {
  kind: 'listColumn'
  fields: string[]
  /** 有列配置时替换环境 colsel；空配置保持原值。 */
  colsel: string | null
  status: 'ready' | 'empty' | 'partial'
  warnings: string[]
}

export type DictionarySnapshot =
  | BasicDataSnapshot | FlowDataSnapshot | FileTypeTreeSnapshot | FieldColumnSnapshot | ListColumnSnapshot

export type DictionaryKind = 'basic' | 'flow' | 'fileType' | 'fieldColumn' | 'listColumn'

export type DictionaryLoadRequest =
  | { kind: 'basic' | 'flow' | 'fieldColumn' | 'listColumn'; force: boolean }
  | { kind: 'fileType'; force: boolean; caseTypeId: string }
