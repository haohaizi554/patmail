import { isFileSearchBusinessField } from '../api/file-search-params'
import { isFileDownloadSelection } from '../mail/download-name'
import { isForbiddenFieldName } from '../query/field-registry'
import { isQueryGuid } from '../query/query-validator'
import { isBoundQuery, isFileMailStyle, isLimitMailStyle, isQuerySurface, isWorkflowId } from './mail-flow'
import { isCustomerSkill } from './skills'
import type { CustomerQueryProfile, PctTaskDraft, PctTaskRow } from './types'

export function isCustomerProfile(value: unknown): value is CustomerQueryProfile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const profile = value as Record<string, unknown>
  if (typeof profile.id !== 'string' || !profile.id.trim()) return false
  if (typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 200) return false
  if (profile.easyCustomerId !== undefined && (typeof profile.easyCustomerId !== 'string' || !isQueryGuid(profile.easyCustomerId))) return false
  if (typeof profile.baseTemplateId !== 'string' || !profile.baseTemplateId.trim()) return false
  if (typeof profile.enabled !== 'boolean') return false
  if (profile.revision !== undefined && (!Number.isSafeInteger(profile.revision) || Number(profile.revision) < 1)) return false
  if (typeof profile.createdAt !== 'string' || typeof profile.updatedAt !== 'string') return false
  if (profile.querySurface !== undefined && !isQuerySurface(profile.querySurface)) return false
  if (profile.workflowId !== undefined && !isWorkflowId(profile.workflowId)) return false
  if (profile.workflowRemark !== undefined && (typeof profile.workflowRemark !== 'string' || profile.workflowRemark.length > 40)) return false
  if (profile.limitMailStyle !== undefined && !isLimitMailStyle(profile.limitMailStyle)) return false
  if (profile.fileMailStyle !== undefined && !isFileMailStyle(profile.fileMailStyle)) return false
  if (profile.reviewTarget !== undefined && profile.reviewTarget !== 'self') return false
  if (profile.reviewerId !== undefined && (typeof profile.reviewerId !== 'string' || !isQueryGuid(profile.reviewerId))) return false
  if (profile.reviewerName !== undefined && (typeof profile.reviewerName !== 'string' || !profile.reviewerName.trim() || profile.reviewerName.length > 80)) return false
  if (profile.mailsetId !== undefined && (typeof profile.mailsetId !== 'string' || !isQueryGuid(profile.mailsetId))) return false
  if (profile.mailsetLabel !== undefined && (typeof profile.mailsetLabel !== 'string' || profile.mailsetLabel.length > 160)) return false
  if (profile.boundQuery !== undefined && !isBoundQuery(profile.boundQuery)) return false
  if (profile.fileDownloadName !== undefined && !isFileDownloadSelection(profile.fileDownloadName)) return false
  if (profile.pctTask !== undefined && !isPctTask(profile.pctTask)) return false
  if (profile.skills !== undefined && (!Array.isArray(profile.skills) || profile.skills.length > 4 || !profile.skills.every(isCustomerSkill))) return false
  if (profile.overrides === null || typeof profile.overrides !== 'object' || Array.isArray(profile.overrides)) return false
  for (const key of Object.keys(profile.overrides as object)) {
    const raw = (profile.overrides as Record<string, unknown>)[key]
    if (isForbiddenFieldName(key) || !isFileSearchBusinessField(key) || typeof raw !== 'string') return false
  }
  return true
}

function shortText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max
}

function isTaskWorkflowId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(value)
}

function isPctRow(value: unknown): value is PctTaskRow {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (!shortText(row.ourVolume, 80) || !row.ourVolume.trim()) return false
  if (!shortText(row.customerVolume, 80) || !shortText(row.customerName, 80)) return false
  if (row.ourVolumeCorrected !== undefined && row.ourVolumeCorrected !== true) return false
  if (row.customerVolumeCorrected !== undefined && row.customerVolumeCorrected !== true) return false
  if (!shortText(row.contactName, 80) || !shortText(row.iprName, 80) || !shortText(row.procLabel, 80)) return false
  if (row.contactCarried !== undefined && row.contactCarried !== true) return false
  if (row.iprCarried !== undefined && row.iprCarried !== true) return false
  if (row.iprArbitrated !== undefined && row.iprArbitrated !== true) return false
  if (row.leadName !== undefined && !shortText(row.leadName, 80)) return false
  if (row.leadCarried !== undefined && row.leadCarried !== true) return false
  if (row.letterKind !== undefined && row.letterKind !== 'remind' && row.letterKind !== 'national' && row.letterKind !== 'design') return false
  if (row.iprNote !== undefined && !shortText(row.iprNote, 200)) return false
  if (!shortText(row.mailTypeLabel, 80) || !row.mailTypeLabel.trim()) return false
  if (row.mailTypeId !== undefined && (typeof row.mailTypeId !== 'string' || !isQueryGuid(row.mailTypeId))) return false
  if (row.mailTypeRadioIndex !== undefined && row.mailTypeRadioIndex !== 1 && row.mailTypeRadioIndex !== 3) return false
  if (row.mailTo !== undefined && (typeof row.mailTo !== 'string' || row.mailTo.length > 4000)) return false
  if (row.mailCc !== undefined && (typeof row.mailCc !== 'string' || row.mailCc.length > 4000)) return false
  return true
}

export function isPctTask(value: unknown): value is PctTaskDraft {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const task = value as Record<string, unknown>
  if (!isTaskWorkflowId(task.workflowId)) return false
  if (task.recipientMode !== undefined && task.recipientMode !== 'ipr' && task.recipientMode !== 'lead') return false
  if (typeof task.ctrlProcId !== 'string' || !isQueryGuid(task.ctrlProcId)) return false
  if (!Array.isArray(task.rows) || task.rows.length < 1 || task.rows.length > 5000 || !task.rows.every(isPctRow)) return false
  if (!Array.isArray(task.confirmedProcIds) || task.confirmedProcIds.length > 5000) return false
  if (!task.confirmedProcIds.every(item => typeof item === 'string' && isQueryGuid(item))) return false
  if (task.mailsetId !== undefined && (typeof task.mailsetId !== 'string' || !isQueryGuid(task.mailsetId))) return false
  if (task.mailsetLabel !== undefined && (typeof task.mailsetLabel !== 'string' || task.mailsetLabel.length > 160)) return false
  if (task.mailTo !== undefined && (typeof task.mailTo !== 'string' || task.mailTo.length > 4000)) return false
  if (task.mailCc !== undefined && (typeof task.mailCc !== 'string' || task.mailCc.length > 4000)) return false
  return typeof task.createdAt === 'string' && task.createdAt.length <= 40
}
