import type { EasyTransport } from '../../api/transport'
import { readRelatedFiles, readSaveMailInfo, relatedFileParams, saveParams, unconfirmedWrite } from './contracts'
import type { MailWriteGate } from './gate'
import type { EasyMailDraft, WriteStatus } from './types'

export class EasyMailSaveService {
  constructor(private readonly transport: EasyTransport, private readonly gate: MailWriteGate) {}

  async save(draft: EasyMailDraft, signal?: AbortSignal): Promise<WriteStatus<{ saved: true }>> {
    if (!draft.canSave) return { status: 'failed', requestSent: false, message: draft.blockers[0] ?? '保存字段还不完整。' }
    const response = await this.transport.post('saveMailInfo', saveParams(draft.fields as Parameters<typeof saveParams>[0]), signal)
    if (!response.ok) return unconfirmedWrite(response) ?? { status: 'unknown', requestSent: true, message: '保存响应无法确认，不能重试。' }
    return readSaveMailInfo(response.data)
  }

  async bind(mailId: string, fileIds: string[], signal?: AbortSignal): Promise<WriteStatus<{ accepted: true }> | { status: 'blocked'; requestSent: false; message: string }> {
    const encoded = this.gate.relatedFileIds(fileIds)
    if (encoded === null) {
      return { status: 'blocked', requestSent: false, message: 'SaveMailRalteCaseFile 的 file_ids 格式还没有核对，没有发送关联请求。' }
    }
    const response = await this.transport.post('saveMailRelatedFiles', relatedFileParams(mailId, encoded), signal)
    if (!response.ok) return unconfirmedWrite(response) ?? { status: 'unknown', requestSent: true, message: '文件关联响应无法确认。' }
    return readRelatedFiles(response.data)
  }
}
