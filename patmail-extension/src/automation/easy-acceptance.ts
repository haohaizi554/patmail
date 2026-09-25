export interface ReadonlyCheck {
  call: string
  purpose: string
  status: 'PENDING'
}

/** 现场只读验收。没有已登录会话时保持 PENDING，不能写成通过。 */
export const LIVE_EASY_ACCEPTANCE = {
  status: 'PENDING' as const,
  reason: '当前环境没有已登录的 EASY 会话。只读清单可以带到现场执行，这里不记录为通过。',
  checks: [
    { call: 'GetUserModel', purpose: '确认操作员 GUID', status: 'PENDING' },
    { call: 'GetSearchFiles', purpose: '核对文件 ID、描述和客户', status: 'PENDING' },
    { call: 'IPGetBasicData', purpose: '核对基础字典', status: 'PENDING' },
    { call: 'GetFlowdirection', purpose: '核对流程方向', status: 'PENDING' },
    { call: 'LoadMailType', purpose: '核对发文类型 GUID', status: 'PENDING' },
    { call: 'GetMailInfo', purpose: '对照原网站邮件', status: 'PENDING' },
    { call: 'GetMailFile', purpose: '对照关联文件', status: 'PENDING' },
    { call: 'GetMailCase', purpose: '对照关联案件', status: 'PENDING' },
    { call: 'GetMailRule', purpose: '对照邮件规则', status: 'PENDING' },
    { call: 'GetCustomerContact', purpose: '对照联系人', status: 'PENDING' },
    { call: 'GetSignature', purpose: '对照签名', status: 'PENDING' },
    { call: 'GetFlowInfo', purpose: '对照当前流程', status: 'PENDING' },
    { call: 'GetFlowHistory', purpose: '对照审核历史', status: 'PENDING' },
    { call: 'GetUrgencyList', purpose: '对照缓急', status: 'PENDING' },
    { call: 'GetFlowSubmit', purpose: '对照下一节点；502 记失败', status: 'PENDING' },
    { call: 'GetFlowLastStatus', purpose: '对照流程版本', status: 'PENDING' }
  ] satisfies ReadonlyCheck[]
}

const WRITE_CALLS = new Set(['MailCustomer', 'SaveMailInfo', 'SaveMailRalteCaseFile', 'FlowSubmit', 'EndEmailFlowd'])

export function classifyReadonlyCall(call: string, statusCode: number): { ok: boolean; message: string } {
  if (WRITE_CALLS.has(call)) return { ok: false, message: '只读验收不能调用写接口。' }
  if (statusCode === 502 || statusCode === 503) return { ok: false, message: `${call} 返回 ${statusCode}，不能当成成功。` }
  if (statusCode < 200 || statusCode >= 300) return { ok: false, message: `${call} 没有成功响应。` }
  return { ok: true, message: `${call} 响应可解析。这仍不是现场通过记录。` }
}
