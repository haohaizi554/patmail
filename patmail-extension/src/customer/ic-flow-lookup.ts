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
/** 这个站点的浏览器大约同时只放 6 条连接。再多的会在队列里把 60 秒耗掉，被记成没查成。 */
const IC_LOOKUP_SOCKETS = 6

/** 用案件查询按我方文号找案子，再按处理事项名称读发文流程。结束的事项不会因为不在期限监控里就被当成没有。 */
export async function lookupIcFlow(
  rows: IcFlowAsk[],
  post: (operation: 'icSearch' | 'caseBusFlow', params: URLSearchParams) => Promise<ApiResult<unknown>>
): Promise<ApiResult<{ items: IcFlowHit[] }>> {
  const volumes = [...new Set(rows.map(row => row.caseVolume.trim()).filter(Boolean))]
  const cases = new Map<string, string>()
  const missing = new Set<string>()
  const unread = new Set<string>()
  const bodies = new Map<string, unknown>()
  const flowFailed = new Set<string>()
  const flowJobs = new Map<string, Promise<void>>()
  let failure: ApiResult<never> | null = null

  async function searchOnce(volume: string): Promise<'found' | 'miss' | 'unread' | 'login'> {
    const key = volumeKey(volume)
    const params = buildIcSearchParams(volume)
    if (!params.ok) return 'unread'
    const response = await post('icSearch', params.data)
    if (!response.ok) {
      if (/登录/.test(response.error.message)) {
        failure = response
        return 'login'
      }
      return 'unread'
    }
    if (!isRecord(response.data) || (response.data.TableRows != null && !Array.isArray(response.data.TableRows))) return 'unread'
    const hit = icCasesFromBody(response.data).find(item => volumeKey(item.caseVolume) === key)
    if (!hit) return 'miss'
    cases.set(key, hit.caseId)
    return 'found'
  }

  async function readFlow(caseId: string): Promise<void> {
    const running = flowJobs.get(caseId)
    if (running) return running
    const job = (async () => {
      for (let attempt = 0; attempt < 2 && !failure && !bodies.has(caseId); attempt += 1) {
        const response = await post('caseBusFlow', caseBusFlowParams(caseId))
        if (response.ok) {
          flowFailed.delete(caseId)
          bodies.set(caseId, response.data)
          return
        }
        if (/登录/.test(response.error.message)) {
          failure = response
          return
        }
        flowFailed.add(caseId)
      }
    })()
    flowJobs.set(caseId, job)
    return job
  }

  await pool(volumes, IC_LOOKUP_SOCKETS, async volume => {
    if (failure) return
    const key = volumeKey(volume)
    let searched = await searchOnce(volume)
    if (searched === 'login' || failure) return
    if (searched === 'unread') searched = await searchOnce(volume)
    if (searched === 'login' || failure) return
    if (searched === 'unread') {
      unread.add(key)
      return
    }
    if (searched !== 'found') {
      missing.add(key)
      return
    }
    const caseId = cases.get(key)
    if (!caseId) {
      missing.add(key)
      return
    }
    await readFlow(caseId)
  })
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
