import { EASY_ORIGIN, isEasyOrigin } from '../api/config'
import { isConfirmedOperator } from '../automation/operator'
import { isRecord } from './guards'

export type EasySessionStatus = 'disconnected' | 'pending' | 'authenticated' | 'unauthenticated' | 'expired' | 'error'

export interface EasyConnectionContext {
  easyOrigin: string
  easyTabId: number | null
  operatorId: string
  lastOperatorId: string
  sessionStatus: EasySessionStatus
  lastCheckedAt: string
  displayName: string
  /** 最近一次确认过的姓名。掉线后顶栏会变成未登录，询问切换时还要用这个名字。 */
  lastDisplayName: string
  /** 站点上已经是另一位登录人，但还没决定要不要丢掉当前现场。 */
  accountOffer: AccountOffer | null
  message: string
  connectionVersion: number
}

/** 检测到的另一位登录人。页面确认后才真正切过去。 */
export interface AccountOffer {
  operatorId: string
  displayName: string
  tabId: number
}

/** 一次读取或保存开始时冻结的账号。后续异步不能再改用当时的连接对象。 */
export interface AccountContextSnapshot {
  easyOrigin: string
  operatorId: string
  easyTabId: number
  connectionVersion: number
}

/** 调用方声称自己当时看到的账号。Background 只把它当预期，不把它当身份。 */
export interface ExpectedAccountScope {
  easyOrigin: string
  operatorId: string
  easyTabId: number
  connectionVersion: number
}

/** 只保存可恢复的候选绑定。不含 Cookie、Token 或完整用户模型。 */
export interface ConnectionSnapshot {
  easyOrigin: string
  easyTabId: number | null
  lastOperatorId: string
  connectionVersion: number
  /** 登录状态变了也要通知页面。只靠文号和版本，同一位重新登录时页面收不到。 */
  sessionStatus?: EasySessionStatus
  lastDisplayName?: string
  offerOperatorId?: string
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

export function emptyConnection(origin: string = EASY_ORIGIN): EasyConnectionContext {
  return {
    easyOrigin: isEasyOrigin(origin) ? origin : EASY_ORIGIN,
    easyTabId: null,
    operatorId: '',
    lastOperatorId: '',
    sessionStatus: 'disconnected',
    lastCheckedAt: '',
    displayName: '',
    lastDisplayName: '',
    accountOffer: null,
    message: '尚未连接 EASY。',
    connectionVersion: 0
  }
}

function isAccountOffer(value: unknown): value is AccountOffer {
  return isRecord(value) &&
    typeof value.operatorId === 'string' && value.operatorId.length > 0 && value.operatorId.length <= 80 &&
    typeof value.displayName === 'string' && value.displayName.length <= 80 &&
    typeof value.tabId === 'number' && Number.isInteger(value.tabId)
}

/** 两位登录人是不是同一个 GUID。空的不算同一位。 */
export function sameOperatorId(left: string, right: string): boolean {
  const former = left.trim().toLowerCase()
  const latter = right.trim().toLowerCase()
  return former.length > 0 && former === latter
}

/**
 * 掉线后再检测到登录人时怎么处理。
 * 没有上一位，或还是同一位，原样接回。换成另一位，先问过再丢掉现场。
 */
export function resumeLoginChoice(previousOperatorId: string, nextOperatorId: string): 'resume' | 'ask' {
  const next = nextOperatorId.trim()
  if (!next) return 'resume'
  const previous = previousOperatorId.trim()
  if (!previous || sameOperatorId(previous, next)) return 'resume'
  return 'ask'
}

/** 现场主人变成另一位已登录的人才算切换。掉线变成空账号不算。 */
export function sceneOwnerChanged(sceneOwner: string, nextOperatorId: string): boolean {
  return resumeLoginChoice(sceneOwner, nextOperatorId) === 'ask'
}

export function isEasyConnection(value: unknown): value is EasyConnectionContext {
  if (!isRecord(value)) return false
  const status = value.sessionStatus
  return typeof value.easyOrigin === 'string' && isEasyOrigin(value.easyOrigin) &&
    (value.easyTabId === null || (typeof value.easyTabId === 'number' && Number.isInteger(value.easyTabId))) &&
    typeof value.operatorId === 'string' && value.operatorId.length <= 80 &&
    typeof value.lastOperatorId === 'string' && value.lastOperatorId.length <= 80 &&
    (status === 'disconnected' || status === 'pending' || status === 'authenticated' || status === 'unauthenticated' || status === 'expired' || status === 'error') &&
    typeof value.lastCheckedAt === 'string' && typeof value.displayName === 'string' && typeof value.message === 'string' &&
    (value.lastDisplayName === undefined || typeof value.lastDisplayName === 'string') &&
    (value.accountOffer == null || isAccountOffer(value.accountOffer)) &&
    typeof value.connectionVersion === 'number' && Number.isInteger(value.connectionVersion)
}

export function tabOrigin(url: string | undefined): string | null {
  if (!url) return null
  try {
    const origin = new URL(url).origin
    return isEasyOrigin(origin) ? origin : null
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
  /** 用户选择留在当前现场后，同一位登录人不再反复询问。 */
  declinedOperatorId = ''
  /** 当前客户模式的主站。断开绑定后空连接仍指向这里。 */
  homeOrigin = EASY_ORIGIN

  /** 只改主站。已经绑着标签页时，不把登录身份换成另一个站点。 */
  retarget(origin: string): void {
    if (!isEasyOrigin(origin)) return
    this.homeOrigin = origin
    if (this.context.easyTabId != null) return
    this.context = {
      ...emptyConnection(origin),
      lastOperatorId: this.context.lastOperatorId,
      lastDisplayName: this.context.lastDisplayName,
      connectionVersion: this.context.connectionVersion,
      message: this.context.message
    }
  }

  private cleared(patch: Partial<EasyConnectionContext>): EasyConnectionContext {
    return {
      ...emptyConnection(this.homeOrigin),
      lastOperatorId: this.context.lastOperatorId,
      lastDisplayName: this.context.lastDisplayName,
      connectionVersion: this.context.connectionVersion + 1,
      ...patch
    }
  }

  list(tabs: BrowserTabRef[]): EasyTabCandidate[] {
    return easyTabCandidates(tabs)
  }

  beginBind(tab: BrowserTabRef): { ok: true } | { ok: false; message: string } {
    const origin = tabOrigin(tab.url)
    if (typeof tab.id !== 'number' || !origin) {
      this.context = this.cleared({
        sessionStatus: 'error',
        message: '这个标签页不是已确认的 EASY 站点。'
      })
      return { ok: false, message: this.context.message }
    }
    const connectionVersion = this.context.connectionVersion + 1
    this.context = {
      ...emptyConnection(origin),
      easyOrigin: origin,
      easyTabId: tab.id,
      lastOperatorId: this.context.lastOperatorId,
      lastDisplayName: this.context.lastDisplayName,
      connectionVersion,
      sessionStatus: 'pending',
      message: '正在读取该标签页的登录身份。'
    }
    return { ok: true }
  }

  /** 过期的 GetUserModel 结果不能覆盖更新的绑定。 */
  applySession(observation: SessionObservation, version: number): void {
    if (version !== this.context.connectionVersion || this.context.easyTabId == null) return
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
      lastOperatorId: observation.userId,
      displayName: (observation.displayName ?? '').slice(0, 80),
      lastDisplayName: (observation.displayName ?? '').trim().slice(0, 80) || this.context.lastDisplayName,
      accountOffer: null,
      sessionStatus: 'authenticated',
      lastCheckedAt: checkedAt,
      message: ''
    }
  }

  detach(tabId: number): void {
    if (this.context.easyTabId !== tabId) return
    this.context = this.cleared({ message: '绑定的 EASY 标签页已关闭。' })
  }

  observeNavigation(tabId: number, url: string | undefined): void {
    if (this.context.easyTabId !== tabId || !url) return
    const connectionVersion = this.context.connectionVersion + 1
    const origin = tabOrigin(url)
    if (!origin) {
      this.context = this.cleared({
        sessionStatus: 'error',
        message: '绑定页面已经离开 EASY 站点。'
      })
      return
    }
    if (origin !== this.context.easyOrigin) {
      this.context = {
        ...this.context,
        easyOrigin: origin,
        operatorId: '',
        displayName: '',
        connectionVersion,
        sessionStatus: 'pending',
        message: '标签页已换到另一个 EASY 站点，请重新检测会话。'
      }
      return
    }
    if (this.context.sessionStatus === 'authenticated' || this.context.sessionStatus === 'pending') {
      this.context = {
        ...this.context,
        operatorId: '',
        displayName: '',
        connectionVersion,
        sessionStatus: 'pending',
        message: '标签页已刷新，请重新检测会话。'
      }
    }
  }

  /** 重启后只恢复候选标签页。authenticated 必须等重新检测会话后才成立。 */
  restoreCandidate(raw: unknown): void {
    if (this.context.connectionVersion > 0 || this.context.easyTabId != null) return
    if (!isRecord(raw) || typeof raw.easyOrigin !== 'string' || !isEasyOrigin(raw.easyOrigin)) return
    const tabId = raw.easyTabId
    if (tabId != null && (typeof tabId !== 'number' || !Number.isInteger(tabId))) return
    const lastOperatorId = typeof raw.lastOperatorId === 'string' ? raw.lastOperatorId : ''
    const lastDisplayName = typeof raw.lastDisplayName === 'string' ? raw.lastDisplayName.slice(0, 80) : ''
    const connectionVersion = typeof raw.connectionVersion === 'number' && Number.isInteger(raw.connectionVersion) ? raw.connectionVersion : 0
    this.context = {
      ...emptyConnection(),
      easyOrigin: raw.easyOrigin,
      easyTabId: tabId ?? null,
      lastOperatorId,
      lastDisplayName,
      connectionVersion,
      sessionStatus: tabId == null ? 'disconnected' : 'pending',
      message: tabId == null ? '尚未连接 EASY。' : '已恢复候选连接，需要重新检测会话。'
    }
  }

  snapshot(): ConnectionSnapshot {
    return {
      easyOrigin: this.context.easyOrigin,
      easyTabId: this.context.easyTabId,
      lastOperatorId: this.context.operatorId || this.context.lastOperatorId,
      connectionVersion: this.context.connectionVersion,
      sessionStatus: this.context.sessionStatus,
      lastDisplayName: this.context.lastDisplayName,
      offerOperatorId: this.context.accountOffer?.operatorId ?? ''
    }
  }
}

export function sameConnectionSnapshot(left: ConnectionSnapshot | null, right: ConnectionSnapshot): boolean {
  if (!left) return false
  return left.easyOrigin === right.easyOrigin && left.easyTabId === right.easyTabId &&
    left.lastOperatorId === right.lastOperatorId && left.connectionVersion === right.connectionVersion &&
    (left.sessionStatus ?? '') === (right.sessionStatus ?? '') &&
    (left.lastDisplayName ?? '') === (right.lastDisplayName ?? '') &&
    (left.offerOperatorId ?? '') === (right.offerOperatorId ?? '')
}

export function freezeAccount(context: EasyConnectionContext): AccountContextSnapshot | null {
  if (context.sessionStatus !== 'authenticated' || context.easyTabId == null || !context.operatorId) return null
  return {
    easyOrigin: context.easyOrigin,
    operatorId: context.operatorId,
    easyTabId: context.easyTabId,
    connectionVersion: context.connectionVersion
  }
}

export function sameAccountContext(context: EasyConnectionContext, frozen: AccountContextSnapshot): boolean {
  return context.sessionStatus === 'authenticated' &&
    context.easyOrigin === frozen.easyOrigin &&
    context.operatorId === frozen.operatorId &&
    context.easyTabId === frozen.easyTabId &&
    context.connectionVersion === frozen.connectionVersion
}

export function accountScopeMatches(context: EasyConnectionContext, scope: ExpectedAccountScope): boolean {
  return context.sessionStatus === 'authenticated' &&
    context.easyOrigin === scope.easyOrigin &&
    context.operatorId === scope.operatorId &&
    context.easyTabId === scope.easyTabId &&
    context.connectionVersion === scope.connectionVersion
}

export function scopeFromConnection(context: EasyConnectionContext): ExpectedAccountScope | null {
  if (context.sessionStatus !== 'authenticated' || context.easyTabId == null || !context.operatorId) return null
  return {
    easyOrigin: context.easyOrigin,
    operatorId: context.operatorId,
    easyTabId: context.easyTabId,
    connectionVersion: context.connectionVersion
  }
}
