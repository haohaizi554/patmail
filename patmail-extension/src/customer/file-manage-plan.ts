import { isQueryGuid } from '../query/query-validator'
import { buildSubject } from '../mail/rules/subject-builder'
import type { DescriptionMailTypeMapping, MailGroup, SubjectRule } from '../mail/types'
import type { FileMailStyle } from './types'

export const FILE_MANAGE_BATCH = 20

export interface FileManageFile {
  fileId: string
  fileName: string
  fileDescription: string
  customerName: string
  caseVolume?: string
  customerVolume?: string
  caseName?: string
  applicationNo?: string
  officialPostDate?: string
}

export interface FileManageLetterPlan {
  key: string
  files: FileManageFile[]
  description: string
  mailTypeId: string
  mailTypeName: string
  subject: string
  /** 非空时这一封不创建、不提交。 */
  blocked: string
}

const BAD_ADDRESS = /[();；]/

/** 把发文页下拉里的签名 HTML 写进正文。已经有同样一段时不再加一次。 */
export function bodyWithSignature(body: string, signatureHtml: string): string {
  const sign = signatureHtml.trim()
  const text = body.trim()
  if (!sign) return text
  if (text.includes(sign)) return text
  return text ? `${text}<br><br>${sign}` : sign
}

export function sameCustomerName(left: string, right: string): boolean {
  return left.replace(/\s+/g, '') === right.replace(/\s+/g, '')
}

/** 默认发件人要能写成「名称(邮箱);」。标签形如 名称<邮箱> 时也能拆开。 */
export function senderAddress(sender: { name?: string; email?: string; label?: string } | null | undefined): { name: string; email: string } | null {
  if (!sender) return null
  const directName = sender.name?.trim() ?? ''
  const directEmail = sender.email?.trim() ?? ''
  if (directName && directEmail.includes('@') && !BAD_ADDRESS.test(directName) && !BAD_ADDRESS.test(directEmail)) {
    return { name: directName, email: directEmail }
  }
  const label = sender.label?.trim() ?? ''
  const angle = label.match(/^(.*)<([^<>]+)>$/)
  const name = angle?.[1]?.trim() ?? ''
  const email = angle?.[2]?.trim() ?? ''
  if (!name || !email.includes('@') || BAD_ADDRESS.test(name) || BAD_ADDRESS.test(email)) return null
  return { name, email }
}

function matchDescription(description: string, mappings: DescriptionMailTypeMapping[]): { mailTypeId: string; mailTypeName: string } | 'missing' | 'conflict' {
  const text = description.trim()
  const hits = mappings.filter(item => item.enabled && isQueryGuid(item.mailTypeId) && (item.fileDescriptionText ?? '').trim() === text)
  const types = [...new Set(hits.map(item => item.mailTypeId))]
  if (types.length > 1) return 'conflict'
  const hit = hits[0]
  if (!hit) return 'missing'
  return { mailTypeId: hit.mailTypeId, mailTypeName: hit.mailTypeName.trim() || '已映射的发文类型' }
}

function groupOf(key: string, description: string, files: FileManageFile[], mode: FileMailStyle): MailGroup {
  return {
    id: key,
    customerProfileId: '',
    customerIdentity: '',
    descriptionIdentity: description ? `text:${description}` : '',
    descriptionLabel: description,
    sendMode: mode,
    policyVersion: 0,
    files: files.map(file => ({
      fileId: file.fileId,
      fileName: file.fileName,
      fileDescription: file.fileDescription,
      customerName: file.customerName,
      ...(file.caseVolume ? { caseVolume: file.caseVolume } : {}),
      ...(file.customerVolume ? { customerVolume: file.customerVolume } : {}),
      ...(file.caseName ? { caseName: file.caseName } : {}),
      ...(file.applicationNo ? { applicationNo: file.applicationNo } : {}),
      ...(file.officialPostDate ? { officialPostDate: file.officialPostDate } : {})
    }))
  }
}

function blockFile(file: FileManageFile): string {
  if (!isQueryGuid(file.fileId)) return '文件编号不是内部编号，不能创建。'
  if (!file.fileName.trim() || file.fileName.includes(';') || file.fileName.length > 180) return '文件名不能按分号提交。'
  return ''
}

function subjectOf(rule: SubjectRule | null, group: MailGroup, customerName: string, mailTypeName: string, now?: Date): { text: string; blocked: string } {
  if (!rule?.template.trim()) return { text: '', blocked: '还没有标题模板。' }
  const built = buildSubject(rule, group, customerName, { mailTypeName, ...(now ? { now } : {}) })
  if (built.unresolved.length) return { text: built.text, blocked: `标题里的 {${built.unresolved[0]}} 还没有对应内容。` }
  if (built.needsConfirm) return { text: built.text, blocked: '标题模板要求先确认件数，这一封没有创建。' }
  if (!built.text.trim()) return { text: '', blocked: '标题是空的，没有创建。' }
  return { text: built.text.trim().slice(0, 500), blocked: '' }
}

/** 同一客户下，按发文方式把文件收成一封封。发文类型只认文件描述的原文一对一映射。 */
export function planFileManageLetters(input: {
  customerName: string
  mailStyle: FileMailStyle
  files: FileManageFile[]
  mappings: DescriptionMailTypeMapping[]
  subject: SubjectRule | null
  hasSender: boolean
  hasReviewer: boolean
  hasSignature: boolean
  now?: Date
}): { letters: FileManageLetterPlan[]; notes: string[] } {
  const notes: string[] = []
  const kept: FileManageFile[] = []
  let others = 0
  for (const file of input.files) {
    const name = file.customerName.trim()
    if (name && !sameCustomerName(name, input.customerName)) {
      others += 1
      continue
    }
    kept.push(file)
  }
  if (others) notes.push(`有 ${others} 个文件不是这位客户，没有放进来。`)
  const buckets = new Map<string, FileManageFile[]>()
  for (const file of kept) {
    const description = file.fileDescription.trim()
    const key = input.mailStyle === 'single_file' || !description
      ? `single:${file.fileId || file.fileName}`
      : `merge:${description}`
    const list = buckets.get(key) ?? []
    list.push(file)
    buckets.set(key, list)
  }
  const letters: FileManageLetterPlan[] = []
  for (const [key, files] of buckets) {
    const description = files[0]?.fileDescription.trim() ?? ''
    const fileBlock = files.map(blockFile).find(Boolean) ?? ''
    const matched = description ? matchDescription(description, input.mappings) : 'missing'
    const mailTypeId = typeof matched === 'object' ? matched.mailTypeId : ''
    const mailTypeName = typeof matched === 'object' ? matched.mailTypeName : ''
    const subject = subjectOf(input.subject, groupOf(key, description, files, input.mailStyle), input.customerName, mailTypeName, input.now)
    const blocked = fileBlock
      || (!description ? '文件描述是空的，没有对上发文类型。' : '')
      || (matched === 'conflict' ? '这个文件描述对上了多种发文类型，没有创建。' : '')
      || (matched === 'missing' ? '发文映射里没有这个文件描述。' : '')
      || (input.mailStyle === 'single_file' ? '单个来文这种发文方式还不能创建。' : '')
      || (!input.hasSender ? '还没有默认发件人。到发文映射里设一个。' : '')
      || (!input.hasReviewer ? '还没有默认审核人。到发文映射里设一个。' : '')
      || (!input.hasSignature ? '还没有默认签名。到发文映射里设一个。' : '')
      || subject.blocked
    letters.push({
      key,
      files,
      description,
      mailTypeId,
      mailTypeName,
      subject: subject.text,
      blocked
    })
  }
  letters.sort((left, right) => left.description < right.description ? -1 : left.description > right.description ? 1 : left.key < right.key ? -1 : 1)
  return { letters, notes }
}
