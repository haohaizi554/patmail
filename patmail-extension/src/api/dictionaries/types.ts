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
  /** 原样保留。契约没有说明取值含义，不能据此判断能否发文。 */
  treeType?: string
  /** 只有调用方明确给出时才使用。树构建不会从 TreeType 推断。 */
  selectable?: boolean
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

export interface PickerSnapshot {
  kind: 'picker'
  dictionaries: Record<string, NormalizedDictionary>
  warnings: string[]
}

export interface SignatureSnapshot {
  kind: 'signature'
  mailsetId: string
  reserved: { id: string; name: string; content: string } | null
  items: Array<{ id: string; name: string; content: string }>
  note: string
}

export type DictionarySnapshot =
  | BasicDataSnapshot | FlowDataSnapshot | FileTypeTreeSnapshot | FieldColumnSnapshot | ListColumnSnapshot | MailTypeSnapshot | ReviewerSnapshot | PickerSnapshot | MailSetSnapshot | SignatureSnapshot

export interface MailTypeSnapshot {
  kind: 'mailType'
  nodes: Array<{ id: string; name: string; parentId: string; treeType: string }>
  diagnostics: string[]
}

export interface ReviewerSnapshot {
  kind: 'reviewer'
  reviewers: Array<{ id: string; name: string }>
}

export interface MailSetSnapshot {
  kind: 'mailSet'
  items: Array<{ id: string; name: string; email: string; label: string }>
}

export type DictionaryKind = 'basic' | 'flow' | 'fileType' | 'fieldColumn' | 'listColumn' | 'mailType' | 'reviewer' | 'picker' | 'mailSet' | 'signature'

export type DictionaryLoadRequest =
  | { kind: 'basic' | 'flow' | 'fieldColumn' | 'listColumn' | 'mailType' | 'reviewer' | 'mailSet'; force: boolean }
  | { kind: 'picker'; force: boolean; caseTypeId?: string; country?: string; procType?: string }
  | { kind: 'fileType'; force: boolean; caseTypeId: string }
  | { kind: 'signature'; force: boolean; mailsetId: string }
