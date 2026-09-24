import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageType, type MessageBridge } from '../src/shared/message'

const mounts = vi.hoisted(() => ({ close: [] as Array<() => void>, unmounts: 0 }))
vi.mock('../src/floating/main', () => ({
  mountFloating: (_container: HTMLElement, _bridge: unknown, close: () => void) => {
    mounts.close.push(close)
    return { unmount: () => { mounts.unmounts++ } }
  }
}))

beforeEach(() => {
  document.body.innerHTML = ''
  mounts.close.length = 0
  mounts.unmounts = 0
  Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value() {} })
  vi.resetModules()
})

describe('document-scoped floating host', () => {
  const bridge: MessageBridge = { request: async () => ({ type: MessageType.Pong, payload: { ok: true } }) }

  it('keeps one instance when the content module executes twice', async () => {
    const first = await import('../src/content/injector')
    first.injectPanel(bridge)
    expect(document.querySelectorAll('patmail-root')).toHaveLength(1)
    vi.resetModules()
    const second = await import('../src/content/injector')
    second.injectPanel(bridge)
    expect(document.querySelectorAll('patmail-root')).toHaveLength(1)
    expect(document.querySelector('patmail-root')?.id).toBe('patmail-extension-root')
    expect(mounts.unmounts).toBe(1)
  })

  it('reattaches after a local body refresh but respects user close', async () => {
    const { injectPanel } = await import('../src/content/injector')
    injectPanel(bridge)
    history.pushState({}, '', '/spa-route')
    injectPanel(bridge)
    expect(document.querySelectorAll('patmail-root')).toHaveLength(1)
    document.body.innerHTML = '<main>页面局部刷新</main>'
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(document.querySelectorAll('patmail-root')).toHaveLength(1)
    mounts.close.at(-1)!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(document.querySelectorAll('patmail-root')).toHaveLength(0)
    expect(document.querySelector('main')?.textContent).toBe('页面局部刷新')
  })
})
