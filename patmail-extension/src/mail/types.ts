export type SendMode = 'merge_by_customer_description' | 'single_file'
export type DraftStatus = 'ready' | 'warning' | 'blocked'
export type IssueSeverity = 'warning' | 'error'

export interface CustomerBinding {
  profileId: string
  profileName: string
  sourceCustomerName: string
  confirmed: boolean
  source: 'explicit'
}

export interface SelectedPatentFile {
  fileId: string
  fileName: string
  fileDescription: string
  fileDescriptionId?: string
  customerName: string
  customerId?: string
  customerProfileId?: string
  customerBinding?: CustomerBinding
  caseId?: string
  caseVolume?: string
  applicationNo?: string
  /** 由 Background 签发。页面自行编造的值不会被当成可信查询运行。 */
  querySessionId?: string
}

export interface SelectionSnapshot {
  selectedAt: string
  files: SelectedPatentFile[]
  configVersion: number
  userId: string
  origin: string
  fingerprint: string
}

export interface CustomerMailPolicy {
  customerProfileId: string
  sendMode: SendMode
  recipientTemplateId?: string
  enabled: boolean
  version: number
  updatedAt: string
}

export interface DescriptionMailTypeMapping {
  id: string
  fileDescriptionId?: string
  fileDescriptionText?: string
  mailTypeId: string
  mailTypeName: string
  enabled: boolean
  version: number
  updatedAt: string
}

export interface CustomerRecipientTemplate {
  id: string
  customerProfileId: string
  name: string
  to: string[]
  cc: string[]
  enabled: boolean
  isDefault: boolean
  version: number
  updatedAt: string
}

export interface OperatorSignature {
  id: string
  operatorId: string
  name: string
  content: string
  enabled: boolean
  isDefault: boolean
  version: number
  updatedAt: string
}

export type MissingAnchorPolicy = 'keep' | 'prefix' | 'confirm'

export interface SubjectRule {
  template: string
  countInjection: boolean
  anchor: string
  missingAnchor: MissingAnchorPolicy
  version: number
}

export interface BodyRule {
  template: string
  supplement: string
  version: number
}

export interface DefaultReviewer {
  userId: string
  name: string
}

/** 发文规则里缓存的默认发件邮箱。名单仍从原站现读，这里只记选中的那一项。 */
export interface DefaultSender {
  mailsetId: string
  label: string
}

export interface MailRuleBundle {
  version: 1
  revision: number
  ownerId: string
  policies: CustomerMailPolicy[]
  mappings: DescriptionMailTypeMapping[]
  recipients: CustomerRecipientTemplate[]
  signatures: OperatorSignature[]
  subject: SubjectRule
  body: BodyRule
  /** 缺省表示还没设。旧配置没有这个字段时按未设置读取。 */
  defaultReviewer: DefaultReviewer | null
  /** 缺省表示还没设。创建任务时可以沿用，也可以当场改。 */
  defaultSender: DefaultSender | null
}

export interface MailGroup {
  id: string
  customerProfileId: string
  customerIdentity: string
  descriptionIdentity: string
  descriptionLabel: string
  sendMode: SendMode
  files: SelectedPatentFile[]
  policyVersion: number
}

export interface ValidationIssue {
  code: string
  severity: IssueSeverity
  message: string
  field: string
  draftId: string
}

export interface MailDraftPreview {
  id: string
  customerProfileId: string
  fileIds: string[]
  files: SelectedPatentFile[]
  mailTypeId: string
  mailTypeName: string
  to: string[]
  cc: string[]
  subject: string
  body: string
  signature: string
  sendMode: SendMode
  status: DraftStatus
  issues: ValidationIssue[]
  ruleVersions: Record<string, number>
  fingerprint: string
}

export interface MailTypeNode {
  id: string
  name: string
  parentId: string
  treeType: string
}
