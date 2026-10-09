import type { ApiResult } from '../api/types'
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

/** 查状态一次放开的件数。鹏城专案和 PCT 提醒走同一条。 */
export const IC_LOOKUP_WIDTH = 100
/** 同一站点实际同时能发出去的连接。一次塞 100 个会在队列里等到超时，被记成没查成。 */
const IC_LOOKUP_SOCKETS = 8

/** 用案件查询按我方文号找案子，再按处理事项名称读发文流程。结束的事项不会因为不在期限监控里就被当成没有。 */
export async function lookupIcFlow(
  rows: IcFlowAsk[],
  post: (operation: 'icSearch' | 'caseBusFlow', params: URLSearchParams) => Promise<ApiResult<unknown>>
): Promise<ApiResult<{ items: IcFlowHit[] }>> {
  const volumes = [...new Set(rows.map(row => row.caseVolume.trim()).filter(Boolean))]
  const cases = new Map<string, string>()
  const missing = new Set<string>()
  const unread = new Set<string>()
  let failure: ApiResult<never> | null = null

  async function search(list: string[]): Promise<void> {
    await pool(list, IC_LOOKUP_SOCKETS, async volume => {
      if (failure) return
      const key = volumeKey(volume)
      const params = buildIcSearchParams(volume)
      if (!params.ok) {
        unread.add(key)
        return
      }
      const response = await post('icSearch', params.data)
      if (!response.ok) {
        if (/登录/.test(response.error.message)) failure = response
        else unread.add(key)
        return
      }
      if (!isRecord(response.data) || (response.data.TableRows != null && !Array.isArray(response.data.TableRows))) {
        unread.add(key)
        return
      }
      const hit = icCasesFromBody(response.data).find(item => volumeKey(item.caseVolume) === key)
      if (hit) {
        unread.delete(key)
        missing.delete(key)
        cases.set(key, hit.caseId)
      } else missing.add(key)
    })
  }

  await search(volumes)
  if (failure) return failure
  const retryVolumes = volumes.filter(volume => unread.has(volumeKey(volume)))
  if (retryVolumes.length) {
    for (const volume of retryVolumes) unread.delete(volumeKey(volume))
    await search(retryVolumes)
  }
  if (failure) return failure

  const bodies = new Map<string, unknown>()
  const flowFailed = new Set<string>()
  async function readFlow(ids: string[]): Promise<void> {
    await pool(ids, IC_LOOKUP_SOCKETS, async caseId => {
      if (failure) return
      const response = await post('caseBusFlow', caseBusFlowParams(caseId))
      if (!response.ok) {
        if (/登录/.test(response.error.message)) failure = response
        else flowFailed.add(caseId)
        return
      }
      flowFailed.delete(caseId)
      bodies.set(caseId, response.data)
    })
  }

  const caseIds = [...new Set(cases.values())]
  await readFlow(caseIds)
  if (failure) return failure
  const retryFlows = caseIds.filter(caseId => flowFailed.has(caseId))
  if (retryFlows.length) {
    for (const caseId of retryFlows) flowFailed.delete(caseId)
    await readFlow(retryFlows)
  }
  if (failure) return failure

  const items = rows.map(row => {
    const key = volumeKey(row.caseVolume)
    const caseId = cases.get(key)
    if (unread.has(key)) {
      return { caseVolume: row.caseVolume, procLabel: row.procLabel, found: false, gate: '' as const, unread: true as const }
    }
    if (!caseId || missing.has(key)) return { caseVolume: row.caseVolume, procLabel: row.procLabel, found: false, gate: '' as const }
    if (flowFailed.has(caseId)) {
      return { caseVolume: row.caseVolume, procLabel: row.procLabel, found: true, gate: '' as const, statusUnread: true as const }
    }
    const gate = gateForProcLabel(bodies.get(caseId), row.procLabel)
    return { caseVolume: row.caseVolume, procLabel: row.procLabel, found: true, gate: gate === 'missing' ? '' as const : gate }
  })
  return { ok: true, data: { items } }
}
