import type { ApiResult } from '../api/types'
import { buildIcSearchParams, icCasesFromBody, type IcCaseHit, type IcSearchField } from '../api/ic-search'
import { isRecord } from '../api/response-guards'
import { caseBusFlowParams, finishedWithoutFlow, gateForProcLabel, mailedWithoutFinishDate, suffixVariant, type IcFlowAsk, type IcFlowHit } from './pct-flow-status'

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
/** 一次案件查询最多并 8 个文号。20 个会直接回空，真案子会被记成库里没有。 */
const IC_SEARCH_GROUP = 8

type FoundCase = { caseId: string; libraryVolume: string }
type Seek = FoundCase | 'miss' | 'unread' | 'login'

/** 用案件查询找案子，再按处理事项名称读发文流程。我方文号对上就不再查客户文号；只有库里没有时才补查。 */
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
    if (field === 'case_volume') {
      const exact = hits.find(item => volumeKey(item.caseVolume) === volumeKey(volume))
      if (exact || !prefer) return exact
      const named = hits.filter(item => item.customerVolume && volumeKey(item.customerVolume) === volumeKey(prefer))
      return named.length === 1 ? named[0] : undefined
    }
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

  function cacheKey(field: IcSearchField, volume: string, prefer: string): string {
    return `${field}\n${volumeKey(volume)}\n${volumeKey(prefer)}`
  }

  async function seek(volume: string, field: IcSearchField = 'case_volume', prefer = ''): Promise<Seek> {
    const key = cacheKey(field, volume, prefer)
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
  type Job = { index: number; volume: string; prefer: string }

  function remember(index: number, found: Seek, keepUnread: boolean): void {
    if (found === 'login') return
    if (found === 'miss' && keepUnread && choices[index] === 'unread') return
    choices[index] = found
  }

  async function loadHits(volume: string, field: IcSearchField, pageSize: number): Promise<IcCaseHit[] | 'unread' | 'login'> {
    const params = buildIcSearchParams(volume, Date.now, field, pageSize)
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
    return icCasesFromBody(response.data)
  }

  async function fill(group: Job[], field: IcSearchField, keepUnread: boolean, siblings: Map<number, number[]>, allowSplit: boolean): Promise<void> {
    if (failure || !group.length) return
    if (group.length === 1) {
      const job = group[0]
      if (!job) return
      const found = await seek(job.volume, field, job.prefer)
      if (found === 'login' || failure) return
      remember(job.index, found, keepUnread)
      for (const index of siblings.get(job.index) ?? []) remember(index, found, keepUnread)
      return
    }
    const seen = new Set<string>()
    const volumes: string[] = []
    for (const job of group) {
      const key = volumeKey(job.volume)
      if (!key || seen.has(key)) continue
      seen.add(key)
      volumes.push(job.volume)
    }
    let hits = await loadHits(volumes.join(';'), field, 50)
    if (hits === 'unread') hits = await loadHits(volumes.join(';'), field, 50)
    if (hits === 'login' || failure) return
    const split = allowSplit && group.length > 4 && (hits === 'unread' || (Array.isArray(hits) && hits.length === 0))
    const clipped = Array.isArray(hits) && hits.length >= 50
    if (hits === 'unread' || split || clipped) {
      if (split && hits !== 'unread') {
        const mid = Math.ceil(group.length / 2)
        await fill(group.slice(0, mid), field, keepUnread, siblings, false)
        await fill(group.slice(mid), field, keepUnread, siblings, false)
        return
      }
      for (const job of group) {
        if (failure) return
        const found = await seek(job.volume, field, job.prefer)
        if (found === 'login' || failure) return
        remember(job.index, found, keepUnread)
        for (const index of siblings.get(job.index) ?? []) remember(index, found, keepUnread)
      }
      return
    }
    for (const job of group) {
      const hit = pickHit(hits, job.volume, field, job.prefer)
      const found: Seek = hit ? { caseId: hit.caseId, libraryVolume: hit.caseVolume } : 'miss'
      cache.set(cacheKey(field, job.volume, job.prefer), found)
      remember(job.index, found, keepUnread)
      for (const index of siblings.get(job.index) ?? []) remember(index, found, keepUnread)
    }
  }

  async function searchJobs(jobs: Job[], field: IcSearchField, keepUnread: boolean): Promise<void> {
    if (failure || !jobs.length) return
    const leaders: Job[] = []
    const siblings = new Map<number, number[]>()
    const seen = new Map<string, number>()
    for (const job of jobs) {
      if (!volumeKey(job.volume)) {
        remember(job.index, 'miss', keepUnread)
        continue
      }
      const key = cacheKey(field, job.volume, job.prefer)
      const cached = cache.get(key)
      if (cached && cached !== 'unread') {
        remember(job.index, cached, keepUnread)
        continue
      }
      const leader = seen.get(key)
      if (leader !== undefined) {
        const list = siblings.get(leader) ?? []
        list.push(job.index)
        siblings.set(leader, list)
        continue
      }
      seen.set(key, job.index)
      leaders.push(job)
    }
    const groups: Job[][] = []
    for (let index = 0; index < leaders.length; index += IC_SEARCH_GROUP) groups.push(leaders.slice(index, index + IC_SEARCH_GROUP))
    await pool(groups, IC_LOOKUP_SOCKETS, async group => {
      await fill(group, field, keepUnread, siblings, true)
    })
  }

  const ourJobs: Job[] = []
  const customerJobs: Job[] = []
  rows.forEach((row, index) => {
    const primary = row.caseVolume.trim()
    const alt = (row.customerVolume ?? '').trim()
    if (alt && volumeKey(alt) === volumeKey(primary)) customerJobs.push({ index, volume: primary, prefer: '' })
    else ourJobs.push({ index, volume: primary, prefer: alt })
  })
  await searchJobs(ourJobs, 'case_volume', false)
  if (!failure) {
    for (const job of ourJobs) {
      const choice = choices[job.index]
      if (!job.prefer || volumeKey(job.prefer) === volumeKey(job.volume) || typeof choice === 'object') continue
      if (choice === 'miss' || choice === 'unread') customerJobs.push({ index: job.index, volume: job.prefer, prefer: job.volume })
    }
    await searchJobs(customerJobs, 'case_volume_customer', true)
  }
  if (!failure) {
    const caseIds: string[] = []
    const seenCase = new Set<string>()
    for (const choice of choices) {
      if (!choice || typeof choice !== 'object' || seenCase.has(choice.caseId)) continue
      seenCase.add(choice.caseId)
      caseIds.push(choice.caseId)
    }
    await pool(caseIds, IC_LOOKUP_SOCKETS, async caseId => {
      if (!failure) await readFlow(caseId)
    })
  }
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
