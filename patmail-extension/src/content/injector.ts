import type { App as VueApp } from 'vue'
import cssText from '../floating/style.css?inline'
import { mountFloating } from '../floating/main'
import type { MessageBridge } from '../shared/message'

const HOST_TAG = 'patmail-root'
let activeHost: HTMLElement | null = null

/** 页面仅增加一个零尺寸宿主；应用节点和样式封装在 Shadow DOM 内。 */
export function injectPanel(bridge: MessageBridge): void {
  if (activeHost?.isConnected) return

  const host = document.createElement(HOST_TAG)
  // 手动 popover 进入浏览器 top layer，避免 body 的 transform/filter 改变固定定位。
  // manual 不锁定页面，也不会点击外部就关闭或关闭网页原有 popover。
  host.popover = 'manual'
  // 宿主脱离页面布局。important 防止站点的通用 CSS 覆盖这个边界节点。
  host.style.cssText = 'all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; display: block !important; z-index: 2147483647 !important; pointer-events: none !important;'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = cssText
  const mountPoint = document.createElement('div')
  mountPoint.id = 'patmail-app'
  shadow.append(style, mountPoint)

  const parent = document.body ?? document.documentElement
  parent.appendChild(host)
  // 在挂载交互控件前显示空宿主，避免显示 popover 时移动网页现有输入焦点。
  host.showPopover()
  activeHost = host

  let app: VueApp | null = null
  app = mountFloating(mountPoint, bridge, () => {
    app?.unmount()
    host.remove()
    activeHost = null
  })
}
