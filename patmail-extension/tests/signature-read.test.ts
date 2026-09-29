import { describe, expect, it } from 'vitest'
import { combineSignatures, readNamedSignatures, readSignatureContent, readSignatureRows, signaturePlainText } from '../src/mail/easy/signature-read'

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

  it('个人设置的邮件签名列表只留有效项，正文从 SignatureInfo 里解出来', () => {
    const rows = readSignatureRows({
      TableRows: [
        { signature_id: id, signature_name: '吴晨晨', is_enabled: '是' },
        { signature_id: other, signature_name: '停用的', is_enabled: '0' }
      ]
    })
    expect(rows.filter(item => item.enabled).map(item => item.name)).toEqual(['吴晨晨'])
    expect(readSignatureContent({
      SignatureInfo: [{ signature_content: '&lt;p&gt;Best Regards,&lt;br&gt;吴晨晨&lt;/p&gt;&lt;p&gt;公司&amp;nbsp;/&amp;nbsp;事务所&amp;nbsp;&lt;/p&gt;&lt;p&gt;0755-86218128&amp;nbsp;&amp;nbsp;手机：18371011021&lt;/p&gt;' }]
    })).toBe('Best Regards,\n吴晨晨\n公司 / 事务所\n0755-86218128  手机：18371011021')
  })

  it('采用邮件签名。标明默认的那一条生效，多项又没有标明时不拿第一条充数', () => {
    const named = readNamedSignatures({
      Signature: [
        { signature_id: id, signature_name: '甲', signature_content: '甲的签名' },
        { signature_id: other, signature_name: '乙', signature_content: '乙的签名', is_default: 1 }
      ]
    })
    expect(combineSignatures(named).reserved).toEqual({ id: other, name: '乙', content: '乙的签名' })
    expect(combineSignatures(named.map(item => ({ ...item, reserved: false }))).reserved).toBeNull()
    expect(combineSignatures(named.slice(0, 1)).reserved?.name).toBe('甲')
  })
})
