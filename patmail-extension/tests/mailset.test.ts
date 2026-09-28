import { describe, expect, it } from 'vitest'
import { readMailSenders } from '../src/customer/mailset'

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
      label: 'info@centips.com<info@centips.com>'
    }])
    expect(JSON.stringify(items)).not.toContain('75E8B4F2')
  })

  it('没有列表时返回空，不补一个写死的邮箱', () => {
    expect(readMailSenders({ mailsettinglist: null })).toEqual([])
    expect(readMailSenders({})).toEqual([])
  })
})
