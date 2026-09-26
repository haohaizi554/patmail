export interface VerifyResult {
  ok: boolean
  reason: string
}

export interface ContractVerifier {
  call: string
  validateRequest(fields: Record<string, unknown>): VerifyResult
  validateResponse(status: number, body: unknown): VerifyResult
  buildReadback(body: unknown): { call: string; fields: string[] } | null
  validateReadback(expected: Record<string, string>, actual: Record<string, string>): VerifyResult
}

const UNKNOWN = '真实响应尚未捕获，不能判断业务成功。'

function hasFields(fields: Record<string, unknown>, names: string[]): VerifyResult {
  const missing = names.filter(name => fields[name] === undefined || fields[name] === '')
  return missing.length === 0 ? { ok: true, reason: '' } : { ok: false, reason: `请求缺少 ${missing.join('、')}。` }
}

function explicitFailure(status: number, body: unknown): boolean {
  if (status === 502 || status === 503 || status < 200 || status >= 300) return true
  if (body == null || body === '') return true
  if (typeof body !== 'object') return true
  const record = body as Record<string, unknown>
  if (record.Status === false) return true
  const client = record.ClientInfo
  if (client && typeof client === 'object' && (client as Record<string, unknown>).Status === false) return true
  return false
}

function writeVerifier(call: string, requestFields: string[], readbackCall: string, compareKeys: string[]): ContractVerifier {
  return {
    call,
    validateRequest(fields) { return hasFields(fields, requestFields) },
    validateResponse(status, body) {
      if (explicitFailure(status, body)) return { ok: false, reason: status >= 200 && status < 300 ? 'HTTP 成功但业务失败。' : UNKNOWN }
      return { ok: false, reason: UNKNOWN }
    },
    buildReadback() { return { call: readbackCall, fields: compareKeys } },
    validateReadback(expected, actual) {
      const mismatched = compareKeys.filter(key => expected[key] !== actual[key])
      return mismatched.length === 0 ? { ok: true, reason: '' } : { ok: false, reason: `回读不一致：${mismatched.join('、')}` }
    }
  }
}

export const mailCustomerVerifier = writeVerifier('MailCustomer', ['_file_ids', '_file_names', 'mailstyle', 'mailtype'], 'GetMailInfo', ['mailId', 'fileIds'])
export const saveMailInfoVerifier = writeVerifier('SaveMailInfo', ['mail_id', 'mail_type'], 'GetMailInfo', ['mailId', 'mailType'])
export const saveMailRelatedVerifier = writeVerifier('SaveMailRalteCaseFile', ['mail_id', 'file_ids'], 'GetMailFile', ['fileIds'])
export const flowSubmitVerifier = writeVerifier('FlowSubmit', ['obj_id', 'flow_id', 'cur_node_id'], 'GetFlowInfo', ['flowId', 'curNodeId'])
export const endEmailFlowVerifier = writeVerifier('EndEmailFlowd', ['obj_id', 'flow_id'], 'GetFlowInfo', ['flowId'])

export const ContractVerifierRegistry: Record<string, ContractVerifier> = {
  MailCustomer: mailCustomerVerifier,
  SaveMailInfo: saveMailInfoVerifier,
  SaveMailRalteCaseFile: saveMailRelatedVerifier,
  FlowSubmit: flowSubmitVerifier,
  EndEmailFlowd: endEmailFlowVerifier
}
