import { describe, expect, it } from 'vitest'
import { combineSignatures, readMailboxSignature, readNamedSignatures, signaturePlainText } from '../src/mail/easy/signature-read'

const id = '1b46f503-1111-4111-8111-111111111111'
const other = '93f289c5-f3c5-4f6d-a90b-50ac1fb8d092'

describe('发文签名', () => {
  it('把原站 HTML 收成文本', () => {
    expect(signaturePlainText('<div>Best Regards,<br>国际部</div>')).toBe('Best Regards,\n国际部')
  })

  it('下拉名单带上签名内容', () => {
    const items = readNamedSignatures({
      Signature: [
        { signature_id: id, signature_name: '国际部', signature_content: '国际部<br>深圳' },
        { signature_id: 'bad', signature_name: '坏的', signature_content: 'x' }
      ]
    })
    expect(items).toEqual([{ id, name: '国际部', content: '国际部\n深圳', reserved: false }])
  })

  it('邮箱上的 Signature 是唯一预留，多项下拉时不拿第一条充数', () => {
    const mailbox = readMailboxSignature({ mailsetinfo: [{ Signature: '<p>预留签名</p>' }] })
    expect(mailbox).toBe('预留签名')
    const named = readNamedSignatures({
      Signature: [
        { signature_id: id, signature_name: '甲', signature_content: '甲的签名' },
        { signature_id: other, signature_name: '乙', signature_content: '乙的签名', is_default: 1 }
      ]
    })
    expect(combineSignatures(named, mailbox).reserved).toEqual({ id: '', name: '邮箱预留签名', content: '预留签名' })
    expect(combineSignatures(named, '').reserved?.name).toBe('乙')
    expect(combineSignatures(named.map(item => ({ ...item, reserved: false })), '').reserved).toBeNull()
  })
})
