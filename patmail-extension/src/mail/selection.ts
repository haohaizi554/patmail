import type { PatentFile } from '../api/file-search-types'
import type { SelectedPatentFile } from './types'

export function toSelectedFile(file: PatentFile, customerProfileId?: string): SelectedPatentFile {
  return {
    fileId: file.fileId,
    fileName: file.fileName,
    fileDescription: file.fileDescription?.trim() ?? '',
    customerName: file.customerName?.trim() ?? '',
    ...(customerProfileId ? { customerProfileId } : {}),
    ...(file.caseId ? { caseId: file.caseId } : {}),
    ...(file.caseVolume ? { caseVolume: file.caseVolume } : {}),
    ...(file.applicationNo ? { applicationNo: file.applicationNo } : {})
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
    if (file) next[fileId] = { ...file, customerProfileId }
  }
  return next
}
