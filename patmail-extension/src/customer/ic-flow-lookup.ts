import type { ApiResult } from '../api/types'
import { buildIcSearchParams, icCasesFromBody, type IcCaseHit, type IcSearchField } from '../api/ic-search'
import { isRecord } from '../api/response-guards'
import { caseBusFlowParams, finishedWithoutFlow, gateForProcLabel, mailedWithoutFinishDate, procHasSubflow, suffixVariant, type IcFlowAsk, type IcFlowHit } from './pct-flow-status'

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

type FoundCase = { caseId: string; libraryVolume: string }
type Seek = FoundCase | 'miss' | 'unread' | 'login'

/** 用案件查询找案子，再按处理事项名称读发文流程。有我方文号先查我方，库里没有或这项没有子流程时再查客户文号。 */
export async function lookupIcFlow(
  rows: IcFlowAsk[],
  post: (operation: 'icSearch' | 'caseBusFlow', params: URLSearchParams) => Promise<ApiResult<unknown>>
): Promise<ApiResult<{ items: IcFlowHit[] }>> {
  const bodies = new Map<string, unknown>()
  const flowFailed = new Set<string>()
  const flowJobs = new Map<string, Promise<void>>()
  const cache = new Map<string, Seek>()
  let failure: ApiResult<never> | null = null

  function pickHit(hits: IcCaseHit[], volume: string, field: IcSearchField, prefer: string): IcCaseHit | undefined {
    if (field === 'case_volume') return hits.find(item => volumeKey(item.caseVolume) === volumeKey(volume))
    const keyed = volumeKey(volume)
    const named = hits.filter(item => item.customerVolume && volumeKey(item.customerVolume) === keyed)
    const candidates = named.length ? named : hits.some(item => item.customerVolume) ? [] : hits
    if (candidates.length === 1) return candidates[0]
    const preferKey = volumeKey(prefer)
    if (!preferKey || candidates.length < 2) return undefined
    const exact = candidates.filter(item => volumeKey(item.caseVolume) === preferKey)
    if (exact.length === 1) return exact[0]
    const variants = candidates.filter(item => suffixVariant(prefer, item.caseVolume))
    return variants.length === 1 ? variants[0] : undefined
  }

  async function searchOnce(volume: string, field: IcSearchField, prefer: string): Promise<Seek> {
    const params = buildIcSearchParams(volume, Date.now, field)
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
    const hit = pickHit(icCasesFromBody(response.data), volume, field, prefer)
    if (!hit) return 'miss'
    return { caseId: hit.caseId, libraryVolume: hit.caseVolume }
  }

  async function seek(volume: string, field: IcSearchField = 'case_volume', prefer = ''): Promise<Seek> {
    const key = `${field}\n${volumeKey(volume)}\n${field === 'case_volume_customer' ? volumeKey(prefer) : ''}`
    if (!volumeKey(volume)) return 'miss'
    const cached = cache.get(key)
    if (cached && cached !== 'unread') return cached
    let searched = await searchOnce(volume, field, prefer)
    if (searched === 'login' || failure) return 'login'
    if (searched === 'unread') searched = await searchOnce(volume, field, prefer)
    if (searched !== 'unread') cache.set(key, searched)
    return searched
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

  const choices: Array<FoundCase | 'miss' | 'unread'> = rows.map(() => 'miss')

  await pool(rows.map((row, index) => ({ row, index })), IC_LOOKUP_SOCKETS, async ({ row, index }) => {
    if (failure) return
    const primary = row.caseVolume.trim()
    const alt = (row.customerVolume ?? '').trim()
    const customerOnly = Boolean(alt) && volumeKey(alt) === volumeKey(primary)
    const altOk = Boolean(alt) && !customerOnly
    if (customerOnly) {
      const only = await seek(primary, 'case_volume_customer')
      if (only === 'login' || failure) return
      if (typeof only === 'object') {
        await readFlow(only.caseId)
        if (failure) return
        choices[index] = only
        return
      }
      choices[index] = only === 'unread' ? 'unread' : 'miss'
      return
    }
    const first = await seek(primary)
    if (first === 'login' || failure) return
    if (typeof first === 'object') {
      await readFlow(first.caseId)
      if (failure) return
      const body = bodies.get(first.caseId)
      const noFlow = Boolean(body) && !flowFailed.has(first.caseId) && !procHasSubflow(body, row.procLabel)
      if (noFlow && altOk) {
        const second = await seek(alt, 'case_volume_customer', primary)
        if (second === 'login' || failure) return
        if (typeof second === 'object') {
          await readFlow(second.caseId)
          if (failure) return
          const other = bodies.get(second.caseId)
          if (other && !flowFailed.has(second.caseId) && procHasSubflow(other, row.procLabel)) {
            choices[index] = second
            return
          }
        }
      }
      choices[index] = first
      return
    }
    if (altOk && (first === 'miss' || first === 'unread')) {
      const second = await seek(alt, 'case_volume_customer', primary)
      if (second === 'login' || failure) return
      if (typeof second === 'object') {
        await readFlow(second.caseId)
        if (failure) return
        choices[index] = second
        return
      }
      choices[index] = first === 'unread' || second === 'unread' ? 'unread' : 'miss'
      return
    }
    choices[index] = first === 'unread' ? 'unread' : 'miss'
  })
  if (failure) return failure

  const items = rows.map((row, index) => {
    const choice = choices[index]
    if (choice === 'unread') {
      return { caseVolume: row.caseVolume, procLabel: row.procLabel, found: false, gate: '' as const, unread: true as const }
    }
    if (!choice || choice === 'miss') return { caseVolume: row.caseVolume, procLabel: row.procLabel, found: false, gate: '' as const }
    if (flowFailed.has(choice.caseId)) {
      return { caseVolume: row.caseVolume, procLabel: row.procLabel, found: true, gate: '' as const, statusUnread: true as const }
    }
    const body = bodies.get(choice.caseId)
    const gate = gateForProcLabel(body, row.procLabel)
    const sent = gate === 'missing' ? '' as const : gate
    const uncontrolled = sent === 'done' && mailedWithoutFinishDate(body, row.procLabel) ? true as const : undefined
    const skipSend = sent === 'open' && finishedWithoutFlow(body, row.procLabel) ? true as const : undefined
    const customer = (row.customerVolume ?? '').trim()
    const correctedOur = customer && suffixVariant(row.caseVolume, choice.libraryVolume) ? choice.libraryVolume : undefined
    const correctedCustomer = customer && suffixVariant(customer, choice.libraryVolume) ? choice.libraryVolume : undefined
    return {
      caseVolume: row.caseVolume,
      procLabel: row.procLabel,
      found: true,
      gate: sent,
      ...(uncontrolled ? { uncontrolled } : {}),
      ...(skipSend ? { skipSend } : {}),
      ...(correctedOur ? { correctedOur } : {}),
      ...(correctedCustomer ? { correctedCustomer } : {})
    }
  })
  return { ok: true, data: { items } }
}
