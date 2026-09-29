import { isQueryGuid } from '../../query/query-validator'
import { isRecord } from '../../api/response-guards'

/** 发文页签名下拉里的一项。内容已从原站 HTML 收成可读文本。 */
export interface MailSignatureItem {
  id: string
  name: string
  content: string
}

export interface MailSignatureRead {
  reserved: MailSignatureItem | null
  items: MailSignatureItem[]
  note: string
}

const RESERVED_FLAGS = ['is_default', 'IsDefault', 'is_reserved', 'reserved']

function decodeEntities(value: string): string {
  let text = value
  for (let pass = 0; pass < 3; pass += 1) {
    const next = text
      .replace(/&amp;/gi, '&')
      .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;|&#34;/gi, '"')
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    if (next === text) break
    text = next
  }
  return text.replace(/\u00a0/g, ' ')
}

/** 原站签名是 HTML，保存时还会再编码一次。操作员签名按纯文本带回，换行保留。 */
export function signaturePlainText(value: string): string {
  const text = decodeEntities(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.slice(0, 4000)
}

export interface SignatureListRow {
  id: string
  name: string
  enabled: boolean
}

function enabledFlag(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (typeof value !== 'string') return false
  const text = value.trim().toLowerCase()
  return text === '1' || text === 'true' || text === '是'
}

/** 个人设置「邮件签名」列表。GetMailSignatureSettingList 的 TableRows，正文不在这一张表里。 */
export function readSignatureRows(data: unknown): SignatureListRow[] {
  if (!isRecord(data) || !Array.isArray(data.TableRows)) return []
  const items: SignatureListRow[] = []
  for (const row of data.TableRows) {
    if (!isRecord(row) || typeof row.signature_id !== 'string' || !isQueryGuid(row.signature_id)) continue
    const name = typeof row.signature_name === 'string' ? row.signature_name.trim() : ''
    if (!name) continue
    if (items.some(item => item.id === row.signature_id)) continue
    items.push({ id: row.signature_id, name: name.slice(0, 80), enabled: enabledFlag(row.is_enabled) })
  }
  return items
}

/** GetSignatureset 的 SignatureInfo[0].signature_content。 */
export function readSignatureContent(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.SignatureInfo) || !isRecord(data.SignatureInfo[0])) return ''
  const raw = data.SignatureInfo[0].signature_content
  return typeof raw === 'string' ? signaturePlainText(raw) : ''
}

function flagged(row: Record<string, unknown>): boolean {
  return RESERVED_FLAGS.some(key => row[key] === true || row[key] === 1 || row[key] === '1')
}

/** GetSignature 的 Signature 列表。下拉显示 signature_name，正文用 signature_content。 */
export function readNamedSignatures(data: unknown): Array<MailSignatureItem & { reserved: boolean }> {
  if (!isRecord(data) || !Array.isArray(data.Signature)) return []
  const items: Array<MailSignatureItem & { reserved: boolean }> = []
  for (const row of data.Signature) {
    if (!isRecord(row) || typeof row.signature_id !== 'string' || !isQueryGuid(row.signature_id)) continue
    const name = typeof row.signature_name === 'string' ? row.signature_name.trim() : ''
    const content = typeof row.signature_content === 'string' ? signaturePlainText(row.signature_content) : ''
    if (!name || !content) continue
    if (items.some(item => item.id === row.signature_id)) continue
    items.push({ id: row.signature_id, name: name.slice(0, 80), content, reserved: flagged(row) })
  }
  return items
}

/** 发文页「邮件签名」下拉。写进正文的是这里的 signature_content，不是邮件设置里的 Signature。 */
export function combineSignatures(named: Array<MailSignatureItem & { reserved: boolean }>): MailSignatureRead {
  const items = named.map(({ id, name, content }) => ({ id, name, content }))
  const marked = named.filter(item => item.reserved)
  if (marked.length === 1) {
    const one = marked[0]
    return { reserved: { id: one.id, name: one.name, content: one.content }, items, note: '' }
  }
  if (named.length === 1) {
    const one = named[0]
    return { reserved: { id: one.id, name: one.name, content: one.content }, items, note: '' }
  }
  if (!named.length) return { reserved: null, items: [], note: '当前登录账号没有有效的邮件签名。' }
  return { reserved: null, items, note: '邮件签名有多项有效的，没有标明哪一条会写进正文。' }
}
