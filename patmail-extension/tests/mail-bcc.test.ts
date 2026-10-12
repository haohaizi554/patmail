import { describe, expect, it } from 'vitest'
import { readBlindCopy, resolveMailBcc } from '../src/mail/easy/bcc'

describe('发文密送', () => {
  it('草稿里已有密送时原样保留', () => {
    expect(resolveMailBcc({
      saved: '已有(kept@example.com);',
      rule: 'info@centips.com',
      senderEmail: 'info@centips.com'
    })).toBe('已有(kept@example.com);')
  })

  it('草稿为空时用规则里的 blind_copy，写成名称(邮箱)', () => {
    expect(readBlindCopy({ MailRuleInfo: [{ blind_copy: 'info@centips.com' }] })).toBe('info@centips.com')
    expect(resolveMailBcc({ saved: '', rule: 'info@centips.com', senderEmail: 'other@example.com' })).toBe('info(info@centips.com);')
  })

  it('规则也没有时密送发件邮箱', () => {
    expect(resolveMailBcc({ saved: '', rule: '', senderEmail: 'info@centips.com' })).toBe('info(info@centips.com);')
  })
})
