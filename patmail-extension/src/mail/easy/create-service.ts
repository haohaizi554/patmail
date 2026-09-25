import type { EasyTransport } from '../../api/transport'
import type { MailDraftPreview } from '../types'
import { buildMailCustomerParams, readMailCustomer, unconfirmedWrite } from './contracts'
import type { MailWriteGate } from './gate'
import type { WriteStatus } from './types'

export function assessCreate(preview: MailDraftPreview, gate: MailWriteGate, currentFingerprint: string): { ok: true } | { ok: false; message: string } {
  if (preview.status !== 'ready') return { ok: false, message: '草稿还有未通过的校验，不能创建。' }
  if (preview.fingerprint !== currentFingerprint) return { ok: false, message: '预览已失效，不能把旧草稿提交创建。' }
  if (preview.issues.some(issue => issue.severity === 'error' || issue.code === 'STALE_RULE')) {
    return { ok: false, message: '预览已失效或仍有错误，不能创建。' }
  }
  const blockers = gate.blockers(preview.sendMode)
  if (blockers.length > 0) return { ok: false, message: blockers.join('') }
  const params = buildMailCustomerParams(preview)
  return params.ok ? { ok: true } : params
}

export class EasyMailCreateService {
  constructor(private readonly transport: EasyTransport, private readonly gate: MailWriteGate) {}

  async create(preview: MailDraftPreview, signal?: AbortSignal): Promise<WriteStatus<{ mailId: string }>> {
    const params = buildMailCustomerParams(preview)
    if (!params.ok || this.gate.blockers(preview.sendMode).length > 0) {
      return { status: 'failed', requestSent: false, message: '创建条件还没满足。' }
    }
    const response = await this.transport.post('mailCustomer', params.params, signal)
    if (!response.ok) return unconfirmedWrite(response) ?? { status: 'unknown', requestSent: true, message: '创建响应无法确认，不能再次创建。' }
    return readMailCustomer(response.data)
  }
}
