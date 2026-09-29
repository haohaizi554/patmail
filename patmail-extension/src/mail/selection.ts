import type { PatentFile } from '../api/file-search-types'
import type { CustomerBinding, SelectedPatentFile } from './types'

export interface BindReviewGroup {
  sourceCustomerName: string
  profileId: string
  profileName: string
  fileIds: string[]
  nameMatches: boolean
}

export function toSelectedFile(file: PatentFile, customerProfileId?: string, querySessionId?: string): SelectedPatentFile {
  return {
    fileId: file.fileId,
    fileName: file.fileName,
    fileDescription: file.fileDescription?.trim() ?? '',
    customerName: file.customerName?.trim() ?? '',
    ...(customerProfileId ? { customerProfileId } : {}),
    ...(file.caseName ? { caseName: file.caseName } : {}),
    ...(file.caseVolume ? { caseVolume: file.caseVolume } : {}),
    ...(file.customerVolume ? { customerVolume: file.customerVolume } : {}),
    ...(file.applicationNo ? { applicationNo: file.applicationNo } : {}),
    ...(file.officialPostDate ? { officialPostDate: file.officialPostDate } : {}),
    ...(querySessionId ? { querySessionId } : {})
  }
}

export function toggleSelected(current: Record<string, SelectedPatentFile>, file: SelectedPatentFile): Record<string, SelectedPatentFile> {
  const next = { ...current }
  if (next[file.fileId]) delete next[file.fileId]
  else next[file.fileId] = file
  return next
}

export function selectPage(current: Record<string, SelectedPatentFile>, files: SelectedPatentFile[], selected: boolean): Record<string, SelectedPatentFile> {
  const next = { ...current }
  for (const file of files) {
    if (!file.fileId) continue
    if (selected) next[file.fileId] = { ...next[file.fileId], ...file, customerProfileId: next[file.fileId]?.customerProfileId ?? file.customerProfileId }
    else delete next[file.fileId]
  }
  return next
}

export function bindCustomer(current: Record<string, SelectedPatentFile>, fileIds: string[], customerProfileId: string): Record<string, SelectedPatentFile> {
  const next = { ...current }
  for (const fileId of fileIds) {
    const file = next[fileId]
    if (file) next[fileId] = { ...file, customerProfileId, customerBinding: undefined }
  }
  return next
}

export function reviewCustomerBind(files: SelectedPatentFile[], profileId: string, profileName: string): BindReviewGroup[] {
  const groups = new Map<string, BindReviewGroup>()
  for (const file of files) {
    const source = file.customerName.trim()
    const current = groups.get(source) ?? {
      sourceCustomerName: source, profileId, profileName, fileIds: [], nameMatches: source === profileName.trim()
    }
    current.fileIds.push(file.fileId)
    groups.set(source, current)
  }
  return [...groups.values()]
}

export function applyConfirmedBind(current: Record<string, SelectedPatentFile>, profileId: string, profileName: string, acceptedSources: string[]): Record<string, SelectedPatentFile> {
  const accepted = new Set(acceptedSources)
  const next = { ...current }
  for (const [fileId, file] of Object.entries(current)) {
    const source = file.customerName.trim()
    if (!accepted.has(source)) continue
    const binding: CustomerBinding = {
      profileId, profileName, sourceCustomerName: source, confirmed: true, source: 'explicit'
    }
    next[fileId] = { ...file, customerProfileId: profileId, customerBinding: binding }
  }
  return next
}
