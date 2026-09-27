export interface LimitMonitorRow {
  procId: string
  caseId: string
  caseVolume: string
  caseName: string
  ctrlProc: string
  customerName: string
  appNo: string
  docDate: string
  intDueDate: string
  cusDueDate: string
  legalDueDate: string
}

export interface LimitMonitorResult {
  items: LimitMonitorRow[]
  total: number
  pageIndex: number
  pageSize: number
  totalPages: number
}
