export interface HomeReportCustomer {
  workflowId?: string
  pctTask?: { workflowId?: string }
}

export interface HomeReportTask {
  status: string
  fileCount: number
  mailCount: number
}

export interface HomeReportMark {
  state: 'created' | 'submitted' | 'unknown'
}

export interface ReportSlice {
  label: string
  count: number
  tone: 'pink' | 'blue' | 'orange' | 'green' | 'muted'
}

export interface HomeReport {
  submitted: number
  pendingTasks: number
  unknownTasks: number
  customers: number
  files: number
  letters: number
  tasks: ReportSlice[]
  workflows: ReportSlice[]
  ledger: ReportSlice[]
}

const BLOCKED = new Set(['BLOCKED', 'STALE', 'FAILED', 'CANCELLED', 'PARTIAL_FAILURE', 'BINDING_BLOCKED'])

function workflowOf(customer: HomeReportCustomer): 'pct-reminder' | 'pct-pengcheng' | '' {
  const id = customer.workflowId || customer.pctTask?.workflowId || ''
  if (id === 'pct-reminder' || id === 'pct-pengcheng') return id
  return ''
}

export function homeReport(input: {
  customers: HomeReportCustomer[]
  tasks: HomeReportTask[]
  ledger: HomeReportMark[]
}): HomeReport {
  let pendingTasks = 0
  let unknownTasks = 0
  let blocked = 0
  let done = 0
  let files = 0
  let letters = 0
  for (const task of input.tasks) {
    files += Math.max(0, task.fileCount)
    letters += Math.max(0, task.mailCount)
    if (task.status === 'UNKNOWN') unknownTasks += 1
    else if (task.status === 'COMPLETED') done += 1
    else if (BLOCKED.has(task.status)) blocked += 1
    else pendingTasks += 1
  }
  let pct = 0
  let pengcheng = 0
  let unbound = 0
  for (const customer of input.customers) {
    const workflow = workflowOf(customer)
    if (workflow === 'pct-reminder') pct += 1
    else if (workflow === 'pct-pengcheng') pengcheng += 1
    else unbound += 1
  }
  let submitted = 0
  let created = 0
  let unknownMarks = 0
  for (const mark of input.ledger) {
    if (mark.state === 'submitted') submitted += 1
    else if (mark.state === 'created') created += 1
    else unknownMarks += 1
  }
  return {
    submitted,
    pendingTasks,
    unknownTasks,
    customers: input.customers.length,
    files,
    letters,
    tasks: [
      { label: '待发', count: pendingTasks, tone: 'pink' },
      { label: '还不能发', count: blocked, tone: 'orange' },
      { label: '结果未知', count: unknownTasks, tone: 'blue' },
      { label: '已完成', count: done, tone: 'green' }
    ],
    workflows: [
      { label: 'PCT提醒', count: pct, tone: 'pink' },
      { label: '鹏城专案', count: pengcheng, tone: 'blue' },
      { label: '未绑工作流', count: unbound, tone: 'muted' }
    ],
    ledger: [
      { label: '已交审核', count: submitted, tone: 'green' },
      { label: '已创建未交', count: created, tone: 'pink' },
      { label: '结果未知', count: unknownMarks, tone: 'orange' }
    ]
  }
}

export function barWidth(count: number, items: ReportSlice[]): number {
  const total = items.reduce((sum, item) => sum + item.count, 0)
  if (count <= 0 || total <= 0) return 0
  return Math.max(4, Math.round((count / total) * 100))
}
