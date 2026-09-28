import { isQueryGuid } from '../../query/query-validator'
import type { MailDraftPreview } from '../types'
import { SAVE_KEYS, appendRecipientField, filesMatch, formatRecipientList } from './contracts'
import type { EasyMailDraft, EasyMailSnapshot, FieldDiff, KnownValue } from './types'

export function diffDigest(diffs: FieldDiff[]): string {
  return diffs.map(item => [item.field, item.easyValue, item.planValue, item.saveValue, item.source, item.blocksSave ? '1' : '0'].join('\u001f')).join('\u001e')
}

function text(value: KnownValue): string {
  return value.state === 'known' ? value.value ?? '' : ''
}

function preserved(label: string, field: string, value: KnownValue, diffs: FieldDiff[], blockers: string[]): string {
  if (value.state !== 'known') {
    diffs.push({ field, label, easyValue: '未知', planValue: '', saveValue: '不写入', source: 'unknown', blocksSave: true })
    blockers.push(`${label}在 EASY 邮件里还没有核对，不能用空字符串代替。`)
    return ''
  }
  const saveValue = value.value ?? ''
  diffs.push({ field, label, easyValue: saveValue || '空', planValue: '沿用 EASY', saveValue: saveValue || '空', source: 'easy', blocksSave: false })
  return saveValue
}

/** PatMail 预览和 EASY 已读快照合成待保存字段。未知值不会被写成空字符串。 */
export function adaptMailDraft(preview: MailDraftPreview, snapshot: EasyMailSnapshot): EasyMailDraft {
  const diffs: FieldDiff[] = []
  const blockers: string[] = []
  const fields: Record<(typeof SAVE_KEYS)[number], string> = {
    mail_id: snapshot.mailId,
    mail_type: '', customer_id: '', mailset_id: '', mail_to: '', mail_cc: '', mail_bcc: '',
    mail_subject: '', mail_body: '', is_zip: '', zip_pwd: '', renamezip: '', reply_date: '',
    proc_ids: '', express_id: '', message_id: '', subject_desc: '', mail_tags: '', finish_ctrl_proc: ''
  }
  if (!isQueryGuid(snapshot.mailId)) blockers.push('没有已确认的 EASY mail_id。')
  fields.mail_id = isQueryGuid(snapshot.mailId) ? snapshot.mailId : ''

  const mailType = isQueryGuid(preview.mailTypeId) ? preview.mailTypeId : ''
  if (!mailType) blockers.push('发文类型不是 EASY GUID。')
  fields.mail_type = mailType
  diffs.push({
    field: 'mail_type', label: '发文类型', easyValue: text(snapshot.mailTypeId) || '未知',
    planValue: preview.mailTypeName || preview.mailTypeId, saveValue: mailType || '不写入',
    source: 'patmail', blocksSave: !mailType
  })

  const customerId = snapshot.customerId.state === 'known' && snapshot.customerId.value && isQueryGuid(snapshot.customerId.value)
    ? snapshot.customerId.value : ''
  if (!customerId) blockers.push('EASY 客户 ID 尚未从邮件里读到，不能使用本地客户配置 ID。')
  fields.customer_id = customerId
  diffs.push({
    field: 'customer_id', label: '客户', easyValue: customerId || (snapshot.customerId.state === 'known' ? '空' : '未知'),
    planValue: `本地配置 ${preview.customerProfileId}`, saveValue: customerId || '不写入',
    source: customerId ? 'easy' : 'unknown', blocksSave: !customerId
  })

  fields.mailset_id = preserved('发件邮箱', 'mailset_id', snapshot.mailsetId, diffs, blockers)
  const to = formatRecipientList(preview.to, snapshot.contacts)
  const cc = formatRecipientList(preview.cc, snapshot.contacts)
  if (to.blocked) blockers.push(to.reason)
  if (cc.blocked) blockers.push(cc.reason)
  const existingTo = snapshot.to.state === 'known' ? snapshot.to.value ?? '' : null
  const existingCc = snapshot.cc.state === 'known' ? snapshot.cc.value ?? '' : null
  if (existingTo === null) blockers.push('收件人在 EASY 邮件里还没有核对，不能覆盖。')
  if (existingCc === null) blockers.push('抄送在 EASY 邮件里还没有核对，不能覆盖。')
  fields.mail_to = to.blocked || existingTo === null ? '' : appendRecipientField(existingTo, to.value)
  fields.mail_cc = cc.blocked || existingCc === null ? '' : appendRecipientField(existingCc, cc.value)
  const toEmpty = !fields.mail_to.trim()
  diffs.push({
    field: 'mail_to', label: '收件人', easyValue: text(snapshot.to) || (snapshot.to.state === 'known' ? '空' : '未知'),
    planValue: preview.to.join('、') || '空', saveValue: fields.mail_to || (to.blocked || existingTo === null ? '不写入' : '空'),
    source: to.blocked || existingTo === null ? 'unknown' : 'patmail', blocksSave: to.blocked || existingTo === null || toEmpty
  })
  if (toEmpty && !to.blocked && existingTo !== null) blockers.push('收件人为空。')
  diffs.push({
    field: 'mail_cc', label: '抄送', easyValue: text(snapshot.cc) || (snapshot.cc.state === 'known' ? '空' : '未知'),
    planValue: preview.cc.join('、') || '空', saveValue: fields.mail_cc || (cc.blocked || existingCc === null ? '不写入' : '空'),
    source: cc.blocked || existingCc === null ? 'unknown' : 'patmail', blocksSave: cc.blocked || existingCc === null
  })
  fields.mail_bcc = preserved('密送', 'mail_bcc', snapshot.bcc, diffs, blockers)
  fields.mail_subject = preview.subject
  diffs.push({
    field: 'mail_subject', label: '主题', easyValue: text(snapshot.subject) || (snapshot.subject.state === 'known' ? '空' : '未知'),
    planValue: preview.subject, saveValue: preview.subject, source: 'patmail', blocksSave: !preview.subject.trim()
  })
  if (!preview.subject.trim()) blockers.push('主题为空。')
  fields.mail_body = preview.body
  diffs.push({
    field: 'mail_body', label: '正文', easyValue: text(snapshot.body) || (snapshot.body.state === 'known' ? '空' : '未知'),
    planValue: preview.body, saveValue: preview.body, source: 'patmail', blocksSave: false
  })
  diffs.push({
    field: 'signature', label: '签名', easyValue: text(snapshot.signature) || (snapshot.signature.state === 'known' ? '空' : '未知'),
    planValue: preview.signature || '空', saveValue: '随正文保存', source: preview.signature ? 'patmail' : 'easy', blocksSave: false
  })
  fields.is_zip = preserved('是否压缩', 'is_zip', snapshot.isZip, diffs, blockers)
  fields.zip_pwd = preserved('压缩密码', 'zip_pwd', snapshot.zipPwd, diffs, blockers)
  fields.renamezip = preserved('压缩包重命名', 'renamezip', snapshot.renameZip, diffs, blockers)
  fields.reply_date = preserved('答复期限', 'reply_date', snapshot.replyDate, diffs, blockers)
  fields.proc_ids = preserved('处理事项', 'proc_ids', snapshot.procIds, diffs, blockers)
  fields.express_id = preserved('快递', 'express_id', snapshot.expressId, diffs, blockers)
  fields.message_id = preserved('消息 ID', 'message_id', snapshot.messageId, diffs, blockers)
  fields.subject_desc = preserved('主题描述', 'subject_desc', snapshot.subjectDesc, diffs, blockers)
  fields.mail_tags = preserved('邮件标签', 'mail_tags', snapshot.mailTags, diffs, blockers)
  fields.finish_ctrl_proc = preserved('完成处理事项', 'finish_ctrl_proc', snapshot.finishCtrlProc, diffs, blockers)

  const filesKnown = snapshot.fileListState === 'known'
  const filesSame = filesKnown && filesMatch(preview.fileIds, snapshot.files)
  if (!filesKnown) blockers.push('EASY 已关联文件还没读全，不能保存。')
  if (filesKnown && !filesSame) blockers.push('EASY 已关联文件与发文计划不一致，不能静默保存。')
  diffs.push({
    field: 'files', label: '附件',
    easyValue: filesKnown ? snapshot.files.map(file => file.fileName || file.fileId).join('、') || '空' : '未知',
    planValue: preview.files.map(file => file.fileName).join('、'),
    saveValue: filesSame ? '保持已关联文件' : '不保存',
    source: filesKnown ? 'easy' : 'unknown', blocksSave: !filesSame
  })
  diffs.push({
    field: 'cases', label: '案件',
    easyValue: snapshot.caseListState === 'known' ? snapshot.cases.map(item => item.caseVolume || item.caseId).join('、') || '空' : '未知',
    planValue: preview.files.map(file => file.caseVolume || '').filter(Boolean).join('、') || '未从查询行取得',
    saveValue: '不单独改写案件', source: snapshot.caseListState === 'known' ? 'easy' : 'unknown', blocksSave: false
  })

  return { mailId: fields.mail_id, fields, diffs, canSave: blockers.length === 0, blockers }
}
