import { describe, expect, it } from 'vitest'
import { accountMailset, readMailSenders } from '../src/customer/mailset'

const id = '1b46f503-1111-4111-8111-111111111111'

describe('发件邮箱列表', () => {
  it('按原站下拉的名称和邮箱拼出来，并丢掉响应里的新邮件编号', () => {
    const items = readMailSenders({
      mail_id: '75E8B4F2-A0D8-4628-9781-1D3246C029D3',
      mailsettinglist: [
        { mailset_id: id, cn_name: 'info@centips.com', SMTPFromEmail: 'info@centips.com', exchange_email: '' },
        { mailset_id: 'not-a-guid', cn_name: '坏的', SMTPFromEmail: 'bad@centips.com' }
      ]
    })
    expect(items).toEqual([{
      id,
      name: 'info@centips.com',
      email: 'info@centips.com',
      label: 'info@centips.com<info@centips.com>',
      isDefault: false,
      isPublic: false,
      signature: ''
    }])
    expect(JSON.stringify(items)).not.toContain('75E8B4F2')
  })

  it('没有列表时返回空，不补一个写死的邮箱', () => {
    expect(readMailSenders({ mailsettinglist: null })).toEqual([])
    expect(readMailSenders({})).toEqual([])
  })

  it('签名取登录账号标成默认的那条邮件设置', () => {
    const other = '93f289c5-f3c5-4f6d-a90b-50ac1fb8d092'
    const items = readMailSenders({
      mailsettinglist: [
        { mailset_id: other, cn_name: '公用', SMTPFromEmail: 'info@centips.com', is_public: '1', Signature: '<p>公用签名</p>' },
        { mailset_id: id, cn_name: '我的邮箱', SMTPFromEmail: 'me@centips.com', is_default: 1, Signature: 'Best Regards,<br>张三' }
      ]
    })
    expect(accountMailset(items)?.id).toBe(id)
    expect(accountMailset(items)?.signature).toBe('Best Regards,\n张三')
    const unmarked = items.map(item => ({ ...item, isDefault: false }))
    expect(accountMailset(unmarked)).toBeNull()
  })
})
