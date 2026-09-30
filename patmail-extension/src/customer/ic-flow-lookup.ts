import { apiError, type ApiResult } from '../api/types'
import { buildIcSearchParams, icCasesFromBody } from '../api/ic-search'
import { isRecord } from '../api/response-guards'
import { caseBusFlowParams, gateForProcLabel, type IcFlowAsk, type IcFlowHit } from './pct-flow-status'

function volumeKey(value: string): string {
  return value.replace(/\s/g, '').toUpperCase()
}

async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = items.slice()
  async function run(): Promise<void> {
    while (queue.length) {
      const item = queue.shift()
      if (item === undefined) return
      await worker(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, Math.max(items.length, 1)) }, () => run()))
}

/** 用案件查询按我方文号找案子，再按处理事项名称读发文流程。结束的事项不会因为不在期限监控里就被当成没有。 */
export async function lookupIcFlow(
  rows: IcFlowAsk[],
  post: (operation: 'icSearch' | 'caseBusFlow', params: URLSearchParams) => Promise<ApiResult<unknown>>
): Promise<ApiResult<{ items: IcFlowHit[] }>> {
  const volumes = [...new Set(rows.map(row => row.caseVolume.trim()).filter(Boolean))]
  const cases = new Map<string, string>()
  const missing = new Set<string>()
  let failure: ApiResult<never> | null = null
  await pool(volumes, 4, async volume => {
    if (failure) return
    const params = buildIcSearchParams(volume)
    if (!params.ok) {
      failure = params
      return
    }
    const response = await post('icSearch', params.data)
    if (!response.ok) {
      failure = response
      return
    }
    if (!isRecord(response.data) || (response.data.TableRows != null && !Array.isArray(response.data.TableRows))) {
      failure = apiError('INVALID_RESPONSE', '案件查询没有返回列表。')
      return
    }
    const key = volumeKey(volume)
    const hit = icCasesFromBody(response.data).find(item => volumeKey(item.caseVolume) === key)
    if (hit) cases.set(key, hit.caseId)
    else missing.add(key)
  })
  if (failure) return failure
  const bodies = new Map<string, unknown>()
  await pool([...new Set(cases.values())], 4, async caseId => {
    if (failure) return
    const response = await post('caseBusFlow', caseBusFlowParams(caseId))
    if (!response.ok) {
      failure = response
      return
    }
    bodies.set(caseId, response.data)
  })
  if (failure) return failure
  const items = rows.map(row => {
    const key = volumeKey(row.caseVolume)
    const caseId = cases.get(key)
    if (!caseId || missing.has(key)) return { caseVolume: row.caseVolume, procLabel: row.procLabel, found: false, gate: '' as const }
    const gate = gateForProcLabel(bodies.get(caseId), row.procLabel)
    return { caseVolume: row.caseVolume, procLabel: row.procLabel, found: true, gate: gate === 'missing' ? '' as const : gate }
  })
  return { ok: true, data: { items } }
}
