import type { SelectedPatentFile } from './types'

/** 选择、绑定、规则版本、用户和站点变化都会改变指纹。 */
export function selectionFingerprint(input: {
  files: SelectedPatentFile[]
  revision: number
  userId: string
  origin: string
}): string {
  const files = [...input.files].sort((left, right) => left.fileId < right.fileId ? -1 : left.fileId > right.fileId ? 1 : 0)
    .map(file => [
      file.fileId.trim(),
      file.fileName,
      file.fileDescription.trim(),
      file.fileDescriptionId ?? '',
      file.customerName.trim(),
      file.customerProfileId ?? '',
      file.customerBinding?.confirmed ? '1' : '0',
      file.customerBinding?.profileId ?? '',
      file.customerBinding?.sourceCustomerName.trim() ?? ''
    ].join('\u001f'))
  return [input.origin, input.userId, String(input.revision), ...files].join('\u001e')
}
