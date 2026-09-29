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
  caseName?: string
  caseVolume?: string
  /** 客户文号。转达邮件里常称作贵方案号，例如 ZL20250306002。 */
  customerVolume?: string
  applicationNo?: string
  officialPostDate?: string
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
  /** 大表查询方式。没有这个字段的旧配置按文件管理。 */
  querySurface?: 'file' | 'limit'
  /** 文件管理下的发文方式。期限监控的行可以不填。 */
  sendMode?: SendMode
  /** 期限监控下的发文方式。1 同客户合并，2 单个来文，3 同客户第一联系人合并。 */
  limitMailStyle?: '1' | '2' | '3'
  /** 同一客户可以有多套。备注用来区分。旧配置没有这个字段。 */
  remark?: string
  /** 旧配置可能把发文类型写在这里。新的发文类型由文件描述决定。 */
  mailTypeId?: string
  mailTypeName?: string
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
  /**
   * 发文时默认用哪一条签名。缺省表示用原站那一条。
   * 形如 site:原站签名id 或 diy:暂存签名id。原站正文不写进这里，打开任务时现读。
   */
  defaultSignatureId?: string | null
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
