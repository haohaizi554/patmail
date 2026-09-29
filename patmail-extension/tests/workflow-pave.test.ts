import { describe, expect, it } from 'vitest'
import { encodeRelatedFileIds } from '../src/mail/easy/gate'
import { readRelatedFiles } from '../src/mail/easy/contracts'
import { readCustomerFlow, readForeignPic, readMailNameRules, readWordRules } from '../src/mail/easy/page-reads'
import { buildEndEmailFlow, END_FLOW_NODE_ID } from '../src/workflow/submit-builder'

const client = { IsLogin: true, Status: true, Result: true, Message: null, Url: null }
const mailId = '083aa041-1111-4111-8111-111111111111'
const flowId = '93f289c5-f3c5-4f6d-a90b-50ac1fb8d092'
const nodeId = '1b46f503-1111-4111-8111-111111111111'
const fileA = '22222222-2222-4222-8222-222222222222'
const fileB = '33333333-3333-4333-8333-333333333333'

describe('后续工作流已经能组出来的请求', () => {
  it('用分号提交关联文件，坏的 ID 不发送', () => {
    expect(encodeRelatedFileIds([fileA, fileB])).toBe(`${fileA};${fileB}`)
    expect(encodeRelatedFileIds([])).toBe('')
    expect(encodeRelatedFileIds([fileA, '不是guid'])).toBeNull()
  })

  it('文件关联以 ClientInfo.Result 判断', () => {
    expect(readRelatedFiles({ ClientInfo: client }).status).toBe('ok')
    expect(readRelatedFiles({ ClientInfo: { ...client, Result: false } }).status).toBe('failed')
    expect(readRelatedFiles({ ClientInfo: { IsLogin: true, Status: true } }).status).toBe('unknown')
  })

  it('按结束流程脚本组 EndEmailFlowd', () => {
    expect(buildEndEmailFlow().params).toBeNull()
    const built = buildEndEmailFlow({
      mailId, status: 1000, flowId, flowType: 'CO', flowSubType: '',
      currentNodeId: nodeId, currentNodeCode: 'CIP'
    })
    expect(built.blockers).toEqual([])
    expect(built.params?.get('Call')).toBe('EndEmailFlowd')
    expect(built.params?.get('f_status')).toBe('5000')
    expect(built.params?.get('f_allow_edit')).toBe('0')
    expect(built.params?.get('f_next_node_code')).toBe('END')
    expect(built.params?.get('f_next_node_id')).toBe(END_FLOW_NODE_ID)
    expect(built.params?.get('f_audit_type_id')).toBe('submit')
    expect(built.params?.get('f_obj_id')).toBe(mailId)
  })
})

describe('邮件页其余只读', () => {
  it('读对外处理人、客户流程、文字规则和文件名规则', () => {
    expect(readForeignPic({
      ClientInfo: client,
      mailsettinglist: [{ mailset_id: mailId, cn_name: '对外', SMTPFromEmail: 'a@example.com' }]
    })).toEqual([{ id: mailId, name: '对外', email: 'a@example.com' }])
    expect(readCustomerFlow({ ClientInfo: client, CustomerFlow: null })).toEqual([])
    expect(readCustomerFlow({ ClientInfo: client, CustomerFlow: [{ cn_name: '甲', email: 'a@example.com' }] })).toEqual([{ name: '甲', email: 'a@example.com' }])
    expect(readWordRules({
      SJHCMailRule: [{
        customer_wordrule_proc_id: fileA,
        customer_level: 'A',
        customer_wordrule_review_stage: '',
        mail_type_zh_cn: '提醒',
        customer_wordrule_name_id: mailId
      }]
    })[0]).toMatchObject({ procId: fileA, mailTypeName: '提醒', mailTypeId: mailId })
    expect(readMailNameRules({
      RuleList: [
        { code: 'FV07', fixed_text: '固定' },
        { code: 'FV15', file_desc: '说明书' },
        { code: 'FV01', role_type: '客户' }
      ]
    })).toEqual([
      { code: 'FV07', text: '固定' },
      { code: 'FV15', text: '说明书' },
      { code: 'FV01', text: '客户' }
    ])
  })
})
