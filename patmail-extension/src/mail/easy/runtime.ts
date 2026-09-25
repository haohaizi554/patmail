import type { EasyTransport } from '../../api/transport'
import type { MailDraftPreview } from '../types'
import { filesMatch } from './contracts'
import { assessCreate, EasyMailCreateService } from './create-service'
import { adaptMailDraft, diffDigest } from './adapter'
import { selectionFingerprint } from '../fingerprint'
import type { SelectedPatentFile } from '../types'
import type { MailWriteGate } from './gate'
import { EasyMailReadService } from './read-service'
import { EasyMailSaveService } from './save-service'
import { applyEvent, blocksAnotherCreate } from './state'
import { ExecutionStore } from './store'
import type { FieldDiff, MailExecutionEvent, MailExecutionRecord, MailExecutionView } from './types'

function now(): string {
  return new Date().toISOString()
}

export interface SelectionClaim {
  files: SelectedPatentFile[]
  revision: number
}

function fileIdentity(file: SelectedPatentFile): string {
  return [
    file.fileId.trim(), file.fileName, file.fileDescription.trim(), file.fileDescriptionId ?? '',
    file.customerName.trim(), file.customerProfileId ?? '',
    file.customerBinding?.confirmed ? '1' : '0', file.customerBinding?.profileId ?? '',
    file.customerBinding?.sourceCustomerName.trim() ?? ''
  ].join('\u001f')
}

/** 用当前用户、站点和调用方给出的选择集重新计算，不采信调用方自带的指纹字符串。 */
export function matchesClaim(origin: string, userId: string, preview: MailDraftPreview, claim: SelectionClaim): boolean {
  if (!Number.isSafeInteger(claim.revision) || claim.revision < 0 || preview.files.length === 0) return false
  const claimed = selectionFingerprint({ files: claim.files, revision: claim.revision, userId, origin })
  if (claimed !== preview.fingerprint) return false
  const keys = new Set(claim.files.map(fileIdentity))
  return preview.files.every(file => keys.has(fileIdentity(file)))
}

function move(record: MailExecutionRecord, event: MailExecutionEvent, patch: Partial<MailExecutionRecord> = {}): MailExecutionRecord | null {
  const next = applyEvent(record, event, patch)
  return next.state === record.state ? null : next
}

export class MailExecutionRuntime {
  private readonly reader: EasyMailReadService
  private readonly creator: EasyMailCreateService
  private readonly saver: EasyMailSaveService
  private readonly details = new Map<string, { diffs: FieldDiff[]; linkedFileIds: string[] }>()

  constructor(
    transport: EasyTransport,
    private readonly store: ExecutionStore,
    private readonly gate: MailWriteGate,
    private readonly origin: string
  ) {
    this.reader = new EasyMailReadService(transport)
    this.creator = new EasyMailCreateService(transport, gate)
    this.saver = new EasyMailSaveService(transport, gate)
  }

  async find(userId: string, fingerprint: string): Promise<MailExecutionView | null> {
    const records = await this.store.load(this.origin, userId)
    const matches = records.filter(item => item.fingerprint === fingerprint)
    const found = matches.find(blocksAnotherCreate) ?? matches.at(-1)
    return found ? this.view(found) : null
  }

  async create(userId: string, preview: MailDraftPreview, claim: SelectionClaim): Promise<MailExecutionView> {
    if (!matchesClaim(this.origin, userId, preview, claim)) {
      return this.refused(userId, preview, '按当前选择、规则、用户和站点重算后，预览已失效。')
    }
    return this.store.exclusive(this.origin, userId, preview.fingerprint, () => this.createLocked(userId, preview))
  }

  private async createLocked(userId: string, preview: MailDraftPreview): Promise<MailExecutionView> {
    const records = await this.store.load(this.origin, userId)
    const blocking = records.find(item => item.fingerprint === preview.fingerprint && blocksAnotherCreate(item))
    if (blocking) return this.view(blocking, ['已有创建记录，不能再次创建同一预览。'])
    const assessment = assessCreate(preview, this.gate)
    let record = this.blank(userId, preview)
    record = move(record, 'REQUEST_CONFIRM') ?? record
    if (!assessment.ok) {
      record = { ...record, lastError: assessment.message, updatedAt: now() }
      await this.persist(userId, records, record)
      return this.view(record, [assessment.message])
    }
    const creating = move(record, 'CONFIRM_CREATE', { requestSent: true })
    if (!creating) return this.refused(userId, preview, '当前阶段不能创建。')
    record = creating
    await this.persist(userId, records, record)
    const created = await this.creator.create(preview)
    if (created.status !== 'ok') {
      const sent = created.status === 'unknown' || created.requestSent
      record = move(record, sent ? 'CREATE_UNKNOWN' : 'CREATE_FAILED', { lastError: created.message, requestSent: sent }) ?? record
      await this.persist(userId, records, record)
      return this.view(record, [created.message])
    }
    record = move(record, 'CREATE_SUCCEEDED', { mailId: created.data.mailId, lastError: '' }) ?? record
    await this.persist(userId, records, record)
    return this.loadInto(userId, records, record, preview)
  }

  async save(userId: string, executionId: string, preview: MailDraftPreview, claim: SelectionClaim, acknowledgedDigest: string): Promise<MailExecutionView> {
    if (!matchesClaim(this.origin, userId, preview, claim)) {
      return this.refused(userId, preview, '按当前选择、规则、用户和站点重算后，预览已失效。')
    }
    return this.store.exclusive(this.origin, userId, preview.fingerprint, () => this.saveLocked(userId, executionId, preview, acknowledgedDigest))
  }

  private async saveLocked(userId: string, executionId: string, preview: MailDraftPreview, acknowledgedDigest: string): Promise<MailExecutionView> {
    const records = await this.store.load(this.origin, userId)
    const current = records.find(item => item.executionId === executionId && item.userId === userId && item.origin === this.origin)
    if (!current) return this.refused(userId, preview, '没有可保存的邮件执行记录。')
    if (current.fingerprint !== preview.fingerprint) {
      return this.view({ ...current, lastError: '预览已失效，不能保存。' }, ['预览已失效，不能保存。'])
    }
    if (!current.diffDigest || current.diffDigest !== acknowledgedDigest) {
      return this.view({ ...current, lastError: '还没有确认当前这份差异，不能保存。' }, ['还没有确认当前这份差异，不能保存。'])
    }
    if (this.gate.blockers(preview.sendMode).length > 0) {
      const message = this.gate.blockers(preview.sendMode).join('')
      const held = { ...current, lastError: message, updatedAt: now() }
      await this.persist(userId, records, held)
      return this.view(held, [message])
    }
    let record = current.state === 'MAIL_LOADED' ? move(current, 'REQUEST_SAVE') ?? current : current
    if (record.state !== 'SAVE_CONFIRM_REQUIRED') {
      return this.view({ ...record, lastError: '当前阶段不能保存。' }, ['当前阶段不能保存。'])
    }
    const loaded = await this.reader.load(record.mailId)
    if (!loaded.ok) {
      record = { ...record, lastError: loaded.message, updatedAt: now() }
      await this.persist(userId, records, record)
      return this.view(record, [loaded.message])
    }
    const draft = adaptMailDraft(preview, loaded.snapshot)
    const digest = diffDigest(draft.diffs)
    this.details.set(record.executionId, { diffs: draft.diffs, linkedFileIds: loaded.snapshot.files.map(file => file.fileId) })
    if (digest !== acknowledgedDigest) {
      record = { ...record, diffDigest: digest, lastError: '重新读取后差异已变化，请再次查看后再保存。', updatedAt: now() }
      if (record.state === 'SAVE_CONFIRM_REQUIRED') record = move(record, 'REVIEW_DIFFS', { diffDigest: digest, lastError: record.lastError }) ?? record
      await this.persist(userId, records, record)
      return this.view(record, ['重新读取后差异已变化，请再次查看后再保存。'])
    }
    if (!draft.canSave) {
      record = { ...record, lastError: draft.blockers.join(''), updatedAt: now() }
      await this.persist(userId, records, record)
      return this.view(record, draft.blockers)
    }
    const saving = move(record, 'CONFIRM_SAVE', { requestSent: true, lastError: '' })
    if (!saving) return this.view(record, ['当前阶段不能保存。'])
    record = saving
    await this.persist(userId, records, record)
    const saved = await this.saver.save(draft)
    if (saved.status !== 'ok') {
      const unknown = saved.status === 'unknown'
      record = move(record, unknown ? 'SAVE_UNKNOWN' : 'SAVE_FAILED', { lastError: saved.message, requestSent: unknown || saved.requestSent }) ?? record
      await this.persist(userId, records, record)
      return this.view(record, [saved.message])
    }
    record = move(record, 'SAVE_SUCCEEDED', { lastError: '' }) ?? record
    await this.persist(userId, records, record)
    return this.bindAndVerify(userId, records, record, preview.fileIds)
  }

  async hasVerifiedMail(userId: string, mailId: string): Promise<boolean> {
    const records = await this.store.load(this.origin, userId)
    return records.some(item => item.mailId.toLowerCase() === mailId.toLowerCase() && item.state === 'COMPLETED')
  }

  async inspect(userId: string, executionId: string): Promise<MailExecutionView | null> {
    const records = await this.store.load(this.origin, userId)
    const record = records.find(item => item.executionId === executionId)
    if (!record?.mailId) return record ? this.view(record) : null
    const loaded = await this.reader.load(record.mailId)
    if (!loaded.ok) return this.view({ ...record, lastError: loaded.message })
    this.details.set(record.executionId, {
      diffs: this.details.get(record.executionId)?.diffs ?? [],
      linkedFileIds: loaded.snapshot.files.map(file => file.fileId)
    })
    return this.view(record)
  }

  private async loadInto(userId: string, records: MailExecutionRecord[], record: MailExecutionRecord, preview: MailDraftPreview): Promise<MailExecutionView> {
    const loading = move(record, 'LOAD_STARTED')
    if (!loading) return this.view(record)
    record = loading
    await this.persist(userId, records, record)
    const loaded = await this.reader.load(record.mailId)
    if (!loaded.ok) {
      record = move(record, 'LOAD_FAILED', { lastError: loaded.message }) ?? record
      await this.persist(userId, records, record)
      return this.view(record, [loaded.message])
    }
    const draft = adaptMailDraft(preview, loaded.snapshot)
    record = move(record, 'MAIL_LOADED', { lastError: '', diffDigest: diffDigest(draft.diffs) }) ?? record
    this.details.set(record.executionId, { diffs: draft.diffs, linkedFileIds: loaded.snapshot.files.map(file => file.fileId) })
    await this.persist(userId, records, record)
    return this.view(record)
  }

  private async bindAndVerify(userId: string, records: MailExecutionRecord[], record: MailExecutionRecord, fileIds: string[]): Promise<MailExecutionView> {
    if (this.gate.relatedFileIds(fileIds) === null) {
      const message = '邮件已保存，但文件关联格式还没核对，没有调用 SaveMailRalteCaseFile。这不是完整成功。'
      const blocked = move(record, 'BIND_BLOCKED', { lastError: message })
      record = blocked ?? { ...record, lastError: message, updatedAt: now() }
      await this.persist(userId, records, record)
      return this.view(record, [message])
    }
    const binding = move(record, 'BIND_STARTED')
    if (!binding) return this.view(record, ['当前阶段不能关联文件。'])
    record = binding
    await this.persist(userId, records, record)
    const bound = await this.saver.bind(record.mailId, fileIds)
    if (bound.status === 'blocked') {
      record = { ...record, lastError: bound.message, updatedAt: now() }
      await this.persist(userId, records, record)
      return this.view(record, [bound.message])
    }
    if (bound.status === 'failed' && !bound.requestSent) {
      record = move(record, 'BIND_FAILED', { lastError: bound.message }) ?? record
      await this.persist(userId, records, record)
      return this.view(record, [bound.message])
    }
    const verifying = move(record, 'BIND_SUCCEEDED', { lastError: bound.status === 'ok' ? '' : bound.message })
    if (!verifying) return this.view(record)
    record = verifying
    await this.persist(userId, records, record)
    const loaded = await this.reader.load(record.mailId)
    if (!loaded.ok) {
      record = move(record, 'VERIFY_MISMATCH', { lastError: loaded.message }) ?? record
      await this.persist(userId, records, record)
      return this.view(record, [loaded.message])
    }
    const linkedFileIds = loaded.snapshot.files.map(file => file.fileId)
    this.details.set(record.executionId, { diffs: this.details.get(record.executionId)?.diffs ?? [], linkedFileIds })
    const matched = loaded.snapshot.fileListState === 'known' && filesMatch(fileIds, loaded.snapshot.files)
    record = move(record, matched ? 'VERIFIED' : 'VERIFY_MISMATCH', {
      lastError: matched ? '' : '重新读取的文件和发文计划不一致。'
    }) ?? record
    await this.persist(userId, records, record)
    return this.view(record, matched ? [] : ['重新读取的文件和发文计划不一致。'])
  }

  private blank(userId: string, preview: MailDraftPreview): MailExecutionRecord {
    return {
      executionId: globalThis.crypto.randomUUID(),
      userId, origin: this.origin, customerProfileId: preview.customerProfileId,
      fileIds: [...preview.fileIds], mailTypeId: preview.mailTypeId,
      ruleRevision: preview.ruleVersions.policy ?? 0, fingerprint: preview.fingerprint,
      state: 'PREVIEW_READY', mailId: '', stage: 'PREVIEW_READY', lastError: '',
      requestSent: false, diffDigest: '', updatedAt: now()
    }
  }

  private async persist(userId: string, records: MailExecutionRecord[], record: MailExecutionRecord): Promise<void> {
    const next = records.filter(item => item.executionId !== record.executionId).concat(record)
    await this.store.save(this.origin, userId, next)
    const index = records.findIndex(item => item.executionId === record.executionId)
    if (index >= 0) records[index] = record
    else records.push(record)
  }

  private refused(userId: string, preview: MailDraftPreview, message: string): MailExecutionView {
    return this.view({ ...this.blank(userId, preview), state: 'FAILED', stage: 'FAILED', lastError: message }, [message])
  }

  private view(record: MailExecutionRecord, blockers: string[] = []): MailExecutionView {
    const detail = this.details.get(record.executionId)
    return { record, diffs: detail?.diffs ?? [], linkedFileIds: detail?.linkedFileIds ?? [], blockers }
  }
}
