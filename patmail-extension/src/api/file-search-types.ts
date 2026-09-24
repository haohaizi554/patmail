import type { FileSearchQuery } from './file-search-params'

export type { FileSearchQuery }

export interface PatentFile {
  fileId: string
  fileNo?: string
  fileName: string
  fileDescription?: string
  fileStatus?: string
  fileType?: string
  caseId?: string
  caseName?: string
  caseVolume?: string
  applicationNo?: string
  applicationType?: string
  customerName?: string
  uploadTime?: string
  officialPostDate?: string
}

export interface FileSearchResult {
  items: PatentFile[]
  total: number
  pageIndex: number
  pageSize: number
  totalPages: number
}
