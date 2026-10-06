/** 第一阶段只允许自动只读。写请求即使被放进路由表也不能发出。 */
export const READ_ONLY_AUTO = 'READ_ONLY_AUTO' as const

export const LIVE_WRITE_CALLS = [
  'MailCustomer',
  'LimitMailCustomer',
  'SaveMailInfo',
  'SaveMailRalteCaseFile',
  'MailSubmit',
  'FlowSubmit',
  'EndEmailFlowd'
] as const

export const READ_ONLY_AUTO_CALLS = [
  'GetUserModel',
  'GetSearchFiles',
  'IPGetBasicData',
  'LoadFileTypeByCaseType',
  'LoadMailType',
  'GetMailInfo',
  'GetMailFile',
  'GetMailCase',
  'GetFlowInfo',
  'GetFlowHistory'
] as const

const WRITES = new Set<string>(LIVE_WRITE_CALLS)
const READS = new Set<string>(READ_ONLY_AUTO_CALLS)

export function isLiveWriteCall(call: string): boolean {
  return WRITES.has(call)
}

export function readOnlyAutoDecision(call: string): 'allow' | 'write-blocked' | 'unknown-blocked' {
  if (WRITES.has(call)) return 'write-blocked'
  if (READS.has(call)) return 'allow'
  return 'unknown-blocked'
}

export interface TestWritePrecheck {
  mode: 'TEST_WRITE_STEP'
  execute: false
  customer: string
  file: string
  mailType: string
  guids: { customer: string; file: string; mailType: string; description: string }
  plannedWrites: readonly string[]
  readback: readonly string[]
  rollback: string
}

/** 只列出拟测步骤。没有单独授权时 execute 固定为 false。 */
export function testWritePrecheck(observed: {
  customerGuid?: string
  fileId?: string
  mailTypeId?: string
  descriptionId?: string
  descriptionSelectable?: 'pending' | 'confirmed'
}): TestWritePrecheck {
  const missing = '未从原站响应确认'
  return {
    mode: 'TEST_WRITE_STEP',
    execute: false,
    customer: observed.customerGuid ? '响应中出现客户 GUID，仍未对照原站客户控件。' : missing,
    file: observed.fileId ? '响应中出现文件 ID，仍未作为写请求使用。' : missing,
    mailType: observed.mailTypeId ? '响应中出现发文类型 ID。TreeType 含义未确认，不能当作可选发文参数。' : missing,
    guids: {
      customer: observed.customerGuid || missing,
      file: observed.fileId || missing,
      mailType: observed.mailTypeId || missing,
      description: observed.descriptionSelectable === 'confirmed' && observed.descriptionId ? observed.descriptionId : 'descriptionSelectability=pending'
    },
    plannedWrites: LIVE_WRITE_CALLS,
    readback: ['GetMailInfo', 'GetMailFile', 'GetMailCase', 'GetFlowInfo', 'GetFlowHistory'],
    rollback: '本阶段不发送写请求，没有需要回滚的邮件或流程。若以后授权测试写入，失败时停止后续写步骤，并用上述只读接口核对是否留下半成品。'
  }
}
