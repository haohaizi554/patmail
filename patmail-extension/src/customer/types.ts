export type QuerySurfaceId = 'file' | 'limit'
export type LimitMailStyle = '1' | '2' | '3'
/** 文件管理弹层 FileSearchMail.aspx。合并发文的 mailstyle=1 已核对，单个来文的提交值还没有。 */
export type FileMailStyle = 'merge_by_customer_description' | 'single_file'
export type ReviewTarget = 'self'

export interface PctTaskRow {
  ourVolume: string
  customerVolume: string
  customerName: string
  contactName: string
  iprName: string
  /** 鹏城专案的技术负责人。括号里的拼音已去掉。邮箱列不读。 */
  leadName?: string
  /** 技术负责人是从同客户上一行补上的。 */
  leadCarried?: true
  /** 第一发明人是从同客户上一行补上的。页面标（补），对联系人仍用原名。 */
  contactCarried?: true
  /** IPR 是从同客户上一行补上的。页面标（补），对联系人仍用原名。 */
  iprCarried?: true
  procLabel: string
  /** 热加载到的发文类型名称。读不到树时先留空，创建任务前必须补上。 */
  mailTypeLabel: string
  /** 热加载到的发文类型 GUID。 */
  mailTypeId?: string
  /** 1 是贵方案号且深圳市，3 是我方案号且深圳市。这是树上的位置，不是提交值。 */
  mailTypeRadioIndex?: 1 | 3
  /** 这一行任务的收件人。加载这封发文时的预填在前，联系人追加在后。 */
  mailTo?: string
  /** 这一行任务的抄送。规则与收件人相同。 */
  mailCc?: string
}

/** 勾选 PCT 提醒后，用表格记下的任务。发文类型只记名称和顺序。 */
export interface PctTaskDraft {
  /** 勾选时所属的工作流。收件方式看 recipientMode，不看这个编号。 */
  workflowId: string
  /** 创建任务时从工作流「谁来收」抄下来的。ipr 发给 IPR，lead 发给技术负责人。 */
  recipientMode?: 'ipr' | 'lead'
  ctrlProcId: string
  rows: PctTaskRow[]
  confirmedProcIds: string[]
  /** 创建任务时选中的发件邮箱。没选则沿用客户配置。 */
  mailsetId?: string
  mailsetLabel?: string
  /** 旧数据可能把整张表收成一份。新的收件人、抄送记在每一行上。 */
  mailTo?: string
  /** 抄送。规则与收件人相同。 */
  mailCc?: string
  createdAt: string
}
/** 已封装的工作流。PCT提醒是第一条。 */
export type WorkflowId = 'pct-reminder' | 'pct-pengcheng' | 'file-manage'

/** 创建指定客户后默认带上的能力。案件联系人导出目前只给鹏城国家实验室，而且只认当前名称。 */
export type CustomerSkillId = 'case-contacts'

export interface CustomerQueryProfile {
  id: string
  name: string
  easyCustomerId?: string
  baseTemplateId: string
  overrides: Record<string, string>
  /** 查询入口。旧配置没有这个字段时，按文件查询理解。 */
  querySurface?: QuerySurfaceId
  /** 这条客户走哪条已封装工作流。 */
  workflowId?: WorkflowId
  /** 同一客户有多条工作流时，用这句话区分。 */
  workflowRemark?: string
  /** 期限监控弹层里三种可见发文模式。只在查询入口是期限监控时使用。 */
  limitMailStyle?: LimitMailStyle
  /** 文件管理弹层里的发文模式。只在查询入口是文件查询时使用。 */
  fileMailStyle?: FileMailStyle
  /** 查询页最后一次提交的字段，不是操作步骤。 */
  boundQuery?: Record<string, string>
  /** PCT 提醒提交给当前登录人审核。选了别人时不写这一项。 */
  reviewTarget?: ReviewTarget
  /** 从人员名单里选中的审核人。 */
  reviewerId?: string
  reviewerName?: string
  /** 从原站发件人列表选中的邮箱。 */
  mailsetId?: string
  mailsetLabel?: string
  /** 由 PCT 表格创建的任务。不会向 EASY 提交发文。 */
  pctTask?: PctTaskDraft
  /** 创建这家客户时默认打开的能力。没有这项的客户不出现对应入口。 */
  skills?: CustomerSkillId[]
  enabled: boolean
  /** 缺省视为 1。保存时必须带上读取到的版本，避免后写覆盖先写。 */
  revision?: number
  createdAt: string
  updatedAt: string
}
