import { EASY_ORIGIN } from '../api/config'
import { isConfirmedOperator } from '../automation/operator'
import { isRecord } from './guards'

export type EasySessionStatus = 'disconnected' | 'pending' | 'authenticated' | 'unauthenticated' | 'expired' | 'error'

export interface EasyConnectionContext {
  easyOrigin: string
  easyTabId: number | null
  operatorId: string
  sessionStatus: EasySessionStatus
  lastCheckedAt: string
  displayName: string
  message: string
}

export interface BrowserTabRef {
  id?: number
  url?: string
  title?: string
  windowId?: number
}

export interface EasyTabCandidate {
  id: number
  title: string
  url: string
  origin: string
}

export function emptyConnection(): EasyConnectionContext {
  return {
    easyOrigin: EASY_ORIGIN,
    easyTabId: null,
    operatorId: '',
    sessionStatus: 'disconnected',
    lastCheckedAt: '',
    displayName: '',
    message: '尚未连接 EASY。'
  }
}

export function isEasyConnection(value: unknown): value is EasyConnectionContext {
  if (!isRecord(value)) return false
  const status = value.sessionStatus
  return value.easyOrigin === EASY_ORIGIN &&
    (value.easyTabId === null || (typeof value.easyTabId === 'number' && Number.isInteger(value.easyTabId))) &&
    typeof value.operatorId === 'string' && value.operatorId.length <= 80 &&
    (status === 'disconnected' || status === 'pending' || status === 'authenticated' || status === 'unauthenticated' || status === 'expired' || status === 'error') &&
    typeof value.lastCheckedAt === 'string' && typeof value.displayName === 'string' && typeof value.message === 'string'
}

export function tabOrigin(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin === EASY_ORIGIN ? EASY_ORIGIN : null
  } catch {
    return null
  }
}

export function isAppUrl(url: string, appUrl: string): boolean {
  return url.split('#')[0] === appUrl.split('#')[0]
}

/** 已打开的工作台只激活，不重复创建。 */
export function chooseAppTab(tabs: BrowserTabRef[], appUrl: string): { action: 'focus'; id: number } | { action: 'create' } {
  const found = tabs.find(tab => typeof tab.id === 'number' && typeof tab.url === 'string' && isAppUrl(tab.url, appUrl))
  return found?.id != null ? { action: 'focus', id: found.id } : { action: 'create' }
}

/** 多个 EASY 标签页全部返回，调用方必须明确选择。 */
export function easyTabCandidates(tabs: BrowserTabRef[]): EasyTabCandidate[] {
  const rows: EasyTabCandidate[] = []
  for (const tab of tabs) {
    if (typeof tab.id !== 'number' || typeof tab.url !== 'string') continue
    const origin = tabOrigin(tab.url)
    if (!origin) continue
    rows.push({ id: tab.id, title: (tab.title ?? '').slice(0, 120), url: tab.url, origin })
  }
  return rows
}

export interface SessionObservation {
  ok: boolean
  status?: string
  userId?: string
  displayName?: string
  checkedAt?: string
  message?: string
}

/** 身份只来自绑定标签页上的会话检测。 */
export class EasyConnectionController {
  context: EasyConnectionContext = emptyConnection()

  list(tabs: BrowserTabRef[]): EasyTabCandidate[] {
    return easyTabCandidates(tabs)
  }

  beginBind(tab: BrowserTabRef): { ok: true } | { ok: false; message: string } {
    const origin = tabOrigin(tab.url)
    if (typeof tab.id !== 'number' || !origin) {
      this.context = { ...emptyConnection(), sessionStatus: 'error', message: '这个标签页不是已确认的 EASY 站点。' }
      return { ok: false, message: this.context.message }
    }
    this.context = {
      ...emptyConnection(),
      easyTabId: tab.id,
      sessionStatus: 'pending',
      message: '正在读取该标签页的登录身份。'
    }
    return { ok: true }
  }

  applySession(observation: SessionObservation): void {
    if (this.context.easyTabId == null) return
    const checkedAt = observation.checkedAt ?? new Date().toISOString()
    if (!observation.ok || observation.status !== 'authenticated' || !observation.userId || !isConfirmedOperator(observation.userId)) {
      const status: EasySessionStatus = observation.status === 'expired' ? 'expired' : observation.status === 'unauthenticated' ? 'unauthenticated' : 'error'
      this.context = {
        ...this.context,
        operatorId: '',
        displayName: '',
        sessionStatus: status,
        lastCheckedAt: checkedAt,
        message: observation.message || (status === 'expired' ? '登录已失效。' : '该标签页没有可靠的登录身份。')
      }
      return
    }
    this.context = {
      ...this.context,
      operatorId: observation.userId,
      displayName: (observation.displayName ?? '').slice(0, 80),
      sessionStatus: 'authenticated',
      lastCheckedAt: checkedAt,
      message: ''
    }
  }

  detach(tabId: number): void {
    if (this.context.easyTabId !== tabId) return
    this.context = { ...emptyConnection(), message: '绑定的 EASY 标签页已关闭。' }
  }

  observeNavigation(tabId: number, url: string | undefined): void {
    if (this.context.easyTabId !== tabId || !url) return
    if (!tabOrigin(url)) {
      this.context = { ...emptyConnection(), sessionStatus: 'error', message: '绑定页面已经离开 EASY 站点。' }
      return
    }
    if (this.context.sessionStatus === 'authenticated' || this.context.sessionStatus === 'pending') {
      this.context = {
        ...this.context,
        operatorId: '',
        displayName: '',
        sessionStatus: 'pending',
        message: '标签页已刷新，请重新检测会话。'
      }
    }
  }
}
