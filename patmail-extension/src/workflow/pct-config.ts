/** PCT 提醒真正拿去读表、对发文类型的参数。空值回到默认，避免把匹配条件配空。 */
export interface PctRuntimeConfig {
  columns: {
    ourVolume: string
    customerVolume: string
    customerName: string
    contactName: string
    iprName: string
    leadName: string
    procLabel: string
  }
  procLabel: string
  reminderKeyword: string
  customerKeyword: string
  ourKeyword: string
  cityKeyword: string
  otherCityKeyword: string
  customerRadio: 1 | 3
  ourRadio: 1 | 3
  /** 点名选定的发文类型。空着就仍按名字里的词来对。 */
  customerTypeId: string
  customerTypeName: string
  ourTypeId: string
  ourTypeName: string
}

export const DEFAULT_PCT_RUNTIME: PctRuntimeConfig = {
  columns: {
    ourVolume: '我方文号',
    customerVolume: '客户文号',
    customerName: '客户名称',
    contactName: '第一客户联系人',
    iprName: '客户联系人(IPR)',
    leadName: '',
    procLabel: '处理事项'
  },
  procLabel: '提醒申请PCT',
  reminderKeyword: '提醒申请PCT',
  customerKeyword: '贵方案号',
  ourKeyword: '我方案号',
  cityKeyword: '深圳市',
  otherCityKeyword: '非深圳市',
  customerRadio: 1,
  ourRadio: 3,
  customerTypeId: '',
  customerTypeName: '',
  ourTypeId: '',
  ourTypeName: ''
}

export interface PctRuntimeInput {
  columns?: Partial<PctRuntimeConfig['columns']>
  procLabel?: unknown
  reminderKeyword?: unknown
  customerKeyword?: unknown
  ourKeyword?: unknown
  cityKeyword?: unknown
  otherCityKeyword?: unknown
  customerRadio?: unknown
  ourRadio?: unknown
  customerTypeId?: unknown
  customerTypeName?: unknown
  ourTypeId?: unknown
  ourTypeName?: unknown
}

function filled(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function radio(value: unknown, fallback: 1 | 3): 1 | 3 {
  if (value === 1 || value === '1') return 1
  if (value === 3 || value === '3') return 3
  return fallback
}

export function resolvePctRuntime(input?: PctRuntimeInput | null): PctRuntimeConfig {
  const source = input ?? {}
  const columns = source.columns ?? {}
  const base = DEFAULT_PCT_RUNTIME
  return {
    columns: {
      ourVolume: filled(columns.ourVolume, base.columns.ourVolume),
      customerVolume: filled(columns.customerVolume, base.columns.customerVolume),
      customerName: filled(columns.customerName, base.columns.customerName),
      contactName: filled(columns.contactName, base.columns.contactName),
      iprName: filled(columns.iprName, base.columns.iprName),
      leadName: asText(columns.leadName),
      procLabel: filled(columns.procLabel, base.columns.procLabel)
    },
    procLabel: filled(source.procLabel, base.procLabel),
    reminderKeyword: filled(source.reminderKeyword, base.reminderKeyword),
    customerKeyword: filled(source.customerKeyword, base.customerKeyword),
    ourKeyword: filled(source.ourKeyword, base.ourKeyword),
    cityKeyword: filled(source.cityKeyword, base.cityKeyword),
    otherCityKeyword: filled(source.otherCityKeyword, base.otherCityKeyword),
    customerRadio: radio(source.customerRadio, base.customerRadio),
    ourRadio: radio(source.ourRadio, base.ourRadio),
    customerTypeId: asText(source.customerTypeId),
    customerTypeName: asText(source.customerTypeName),
    ourTypeId: asText(source.ourTypeId),
    ourTypeName: asText(source.ourTypeName)
  }
}
