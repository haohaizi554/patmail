import { createApp, type App as VueApp } from 'vue'
import { hintDirective } from '../../../src/components/hint'
import App from './App.vue'
import type { MessageBridge } from '../shared/message'

/** 把浮窗挂到 Shadow DOM 里的节点上。 */
export function mountFloating(container: HTMLElement, bridge: MessageBridge, close: () => void): VueApp {
  const app = createApp(App)
  app.directive('hint', hintDirective)
  app.provide('bridge', bridge)
  app.provide('closePanel', close)
  app.mount(container)
  return app
}
