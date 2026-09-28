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

/** 原站签名是 HTML。操作员签名按纯文本带回，换行保留。 */
export function signaturePlainText(value: string): string {
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.slice(0, 4000)
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

/** Getmailset 的 mailsetinfo[0].Signature。一个发件邮箱只带这一条，发文页会直接写进正文。 */
export function readMailboxSignature(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.mailsetinfo) || !isRecord(data.mailsetinfo[0])) return ''
  const raw = data.mailsetinfo[0].Signature
  return typeof raw === 'string' ? signaturePlainText(raw) : ''
}

export function combineSignatures(named: Array<MailSignatureItem & { reserved: boolean }>, mailbox: string): MailSignatureRead {
  const items = named.map(({ id, name, content }) => ({ id, name, content }))
  const matched = mailbox ? named.find(item => item.content === mailbox) : undefined
  if (matched) return { reserved: { id: matched.id, name: matched.name, content: matched.content }, items, note: '' }
  if (mailbox) {
    const reserved = { id: '', name: '邮箱预留签名', content: mailbox }
    return {
      reserved,
      items: [reserved, ...items],
      note: items.length ? '这个发件邮箱预留了一条签名。下拉里还有另外的签名。' : ''
    }
  }
  const marked = named.filter(item => item.reserved)
  if (marked.length === 1) {
    const one = marked[0]
    return { reserved: { id: one.id, name: one.name, content: one.content }, items, note: '' }
  }
  if (named.length === 1) {
    const one = named[0]
    return { reserved: { id: one.id, name: one.name, content: one.content }, items, note: '' }
  }
  if (!named.length) return { reserved: null, items: [], note: '这个发件邮箱没有返回预留签名。' }
  return { reserved: null, items, note: '原站返回了多项签名，没有标明预留的是哪一条。' }
}
