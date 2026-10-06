import type { App as VueApp } from 'vue'
import cssText from '../floating/style.css?inline'
import themeSelectCss from '../shell/components/theme-select.css?inline'
import { mountFloating } from '../floating/main'
import type { MessageBridge } from '../shared/message'

const HOST_TAG = 'patmail-root'
const HOST_ID = 'patmail-extension-root'
const DISPOSE_EVENT = 'patmail:dispose'
let activeHost: HTMLElement | null = null

/** 页面仅增加一个零尺寸宿主；应用节点和样式封装在 Shadow DOM 内。 */
export function injectPanel(bridge: MessageBridge): void {
  if (activeHost?.isConnected) {
    if (!activeHost.matches(':popover-open')) activeHost.showPopover()
    return
  }

  // 新版脚本再次执行或扩展重新加载时，清理旧实例后再挂载。
  activeHost?.dispatchEvent(new Event(DISPOSE_EVENT))
  const previous = document.querySelector<HTMLElement>(HOST_TAG)
  previous?.dispatchEvent(new Event(DISPOSE_EVENT))
  previous?.remove()

  const host = document.createElement(HOST_TAG)
  host.id = HOST_ID
  // 手动 popover 进入浏览器 top layer，避免 body 的 transform/filter 改变固定定位。
  // manual 不锁定页面，也不会点击外部就关闭或关闭网页原有 popover。
  host.popover = 'manual'
  // 宿主脱离页面布局。important 防止站点的通用 CSS 覆盖这个边界节点。
  host.style.cssText = 'all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; display: block !important; z-index: 2147483647 !important; pointer-events: none !important;'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `${cssText}\n${themeSelectCss}`
  const mountPoint = document.createElement('div')
  mountPoint.id = 'patmail-app'
  shadow.append(style, mountPoint)

  const parent = document.body ?? document.documentElement
  parent.appendChild(host)
  // 在挂载交互控件前显示空宿主，避免显示 popover 时移动网页现有输入焦点。
  host.showPopover()
  activeHost = host

  let app: VueApp | null = null
  let dismissed = false
  let observedBody: HTMLElement | null = null
  let observedHtml: HTMLElement | null = null
  const bodyObserver = new MutationObserver(restoreIfDetached)
  const htmlObserver = new MutationObserver(restoreIfDetached)
  const documentObserver = new MutationObserver(restoreIfDetached)

  function watchHtml(): void {
    const html = document.documentElement
    if (!html || html === observedHtml) return
    htmlObserver.disconnect()
    htmlObserver.observe(html, { childList: true })
    observedHtml = html
  }

  function watchBody(): void {
    const body = document.body
    if (!body || body === observedBody) return
    bodyObserver.disconnect()
    bodyObserver.observe(body, { childList: true })
    observedBody = body
  }

  function restoreIfDetached(): void {
    if (dismissed) return
    watchHtml()
    watchBody()
    if (!host.isConnected) (document.body ?? document.documentElement).appendChild(host)
    // document.write 等旧页面刷新可能保留宿主节点，却把它移出 top layer。
    if (!host.matches(':popover-open')) host.showPopover()
  }

  function dispose(): void {
    if (dismissed) return
    dismissed = true
    bodyObserver.disconnect()
    htmlObserver.disconnect()
    documentObserver.disconnect()
    host.removeEventListener(DISPOSE_EVENT, dispose)
    app?.unmount()
    host.remove()
    if (activeHost === host) activeHost = null
  }

  host.addEventListener(DISPOSE_EVENT, dispose)
  watchHtml()
  watchBody()
  // 旧式 document.write 会整体替换 html；只观察 Document 的直接子节点以重新绑定。
  documentObserver.observe(document, { childList: true })
  app = mountFloating(mountPoint, bridge, dispose)
}
