import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const fixture = await readFile(path.join(root, 'tests/fixtures/page.html'))
const apiCalls = []
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204).end(); return }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fixture)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
server.unref()
const address = server.address()
assert(address && typeof address !== 'string')
const url = `http://127.0.0.1:${address.port}/fixture`
const easyUrl = 'http://183.36.43.66:88/fixture'
let context
try {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`]
  })
} catch (error) {
  server.close()
  throw error
}
// 整个 EASY Origin 由测试路由拦截；绝不触达真实服务器。
await context.route('http://183.36.43.66:88/**', async route => {
  const request = route.request()
  const pathName = new URL(request.url()).pathname
  if (pathName === '/favicon.ico') { await route.fulfill({ status: 204 }); return }
  if (pathName === '/fixture') {
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture })
    return
  }
  const params = new URLSearchParams(request.postData() ?? '')
  const authenticated = (await request.allHeaders()).cookie?.includes('pm_fixture_session=active') === true
  apiCalls.push({ path: pathName, method: request.method(), params, authenticated })
  if (pathName === '/AjaxServers/Login.ashx' && params.get('Call') === 'GetUserModel') {
    if (!authenticated) {
      await route.fulfill({
        status: 200, contentType: 'text/plain; charset=utf-8',
        body: '<div style="width:100%;text-align: center;font-size:40px;">出错了!</div>'
      })
      return
    }
    const userB = (await request.allHeaders()).cookie?.includes('pm_fixture_user=b') === true
    await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8',
      body: JSON.stringify({
        UserModel: userB
          ? { user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_name: 'user-b', Name: '用户乙', SessionId: 'hidden' }
          : { user_id: '11111111-1111-1111-1111-111111111111', user_name: 'tester', Name: '测试员', SessionId: 'hidden' },
        ClientInfo: { IsLogin: true, Status: true, Result: false, Message: null }
      }) })
    return
  }
  if (pathName === '/AjaxServers/Mail.ashx' && params.get('Call') === 'GetMailInfo') {
    if (params.get('mail_id') === '50250250-5025-4025-8025-502502502502') {
      await route.fulfill({ status: 502, contentType: 'text/plain; charset=utf-8', body: 'bad gateway' })
      return
    }
    await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: JSON.stringify({ ClientInfo: { IsLogin: true, Status: true, Result: true }, mail_id: params.get('mail_id') }) })
    return
  }
  if (pathName === '/AjaxServers/Common.ashx' && params.get('Call') === 'GetFlowInfo') {
    await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: JSON.stringify({ ClientInfo: { IsLogin: true, Status: false, Result: false, Message: '流程类型不匹配' } }) })
    return
  }
  if (pathName === '/AjaxServers/CaseInfo.ashx' && params.get('Call') === 'GetSearchFiles') {
    const empty = params.get('file_name') === 'empty'
    const failed = params.get('file_name') === 'error'
    const pageIndex = Number(params.get('pageIndex'))
    const body = !authenticated
      ? { ClientInfo: { IsLogin: false, Status: false, Result: false }, TableRows: null, TableRowsCount: '0' }
      : failed
        ? { ClientInfo: { IsLogin: true, Status: false, Result: false, Message: '模拟业务失败' }, TableRows: null, TableRowsCount: '0' }
        : {
            ClientInfo: { IsLogin: true, Status: true, Result: true },
            TableRowsCount: empty ? '0' : '21',
            TableRows: empty ? null : [{
              file_id: `file-${pageIndex}`, file_name: `通知书-${pageIndex}.pdf`,
              file_desc: '审查意见通知书', case_volume: params.get('case_volume'),
              app_no: 'CN123', customer_name: '测试客户', post_date: '2026-09-24', file_status: '已发文'
            }]
          }
    await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: JSON.stringify(body) })
    return
  }
  await route.fulfill({ status: 404 })
})
const errors = []
const requestFailures = []
const watch = (page) => {
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('502')) return
    if (message.type() === 'error' || message.text().includes('PatMail transport diagnostic:')) errors.push(message.text())
  })
  page.on('requestfailed', request => { if (request.url().includes('/AjaxServers/')) requestFailures.push({ url: request.url(), failure: request.failure()?.errorText }) })
}
context.on('page', watch)
for (const page of context.pages()) watch(page)
let checks = 0
let workspace
const profile = []
const check = (name, action) => Promise.resolve().then(action).then(() => {
  checks++; console.log(`✓ ${name}`)
})
const visible = async (panel, width, height) => {
  // resize 和 Vue 响应式位置更新跨帧发生；等待最终稳定位置。
  await panel.page().waitForFunction(() => {
    const element = document.querySelector('patmail-root')?.shadowRoot?.querySelector('.panel')
    if (!element) return false
    const box = element.getBoundingClientRect()
    return box.x >= 0 && box.y >= 0 && box.x + box.width <= innerWidth + 1 && box.y + box.height <= innerHeight + 1
  }, null, { timeout: 3000 })
  const box = await panel.boundingBox()
  assert(box, 'panel bounding box missing')
  const viewport = panel.page().viewportSize()
  assert(viewport, 'viewport missing')
  assert(box.x >= 0 && box.y >= 0, `negative panel coordinates: ${JSON.stringify(box)}`)
  assert(box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    `panel beyond viewport: ${JSON.stringify(box)} / ${JSON.stringify(viewport)}`)
  if (width) assert.equal(Math.round(box.width), width)
  if (height) assert.equal(Math.round(box.height), height)
  return box
}

try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  const extensionId = new URL(worker.url()).host
  assert.match(extensionId, /^[a-p]{32}$/)
  async function tabFor(targetPage) {
    const targetUrl = targetPage.url()
    for (let attempt = 0; attempt < 25; attempt++) {
      const tab = (await worker.evaluate(() => chrome.tabs.query({}))).find((item) => item.url === targetUrl)
      if (tab?.id) {
        try {
          const pong = await worker.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: 'PING' }, { frameId: 0 }), tab.id)
          if (pong?.type === 'PONG') return tab
        } catch { /* 内容脚本仍在启动 */ }
      }
      await targetPage.waitForTimeout(200)
    }
    throw new Error(`content script did not answer ${targetUrl}`)
  }
  async function showPanel(targetPage) {
    const tab = await tabFor(targetPage)
    const response = await worker.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: 'SHOW_PANEL' }), tab.id)
    assert.deepEqual(response, { type: 'PANEL_SHOWN', payload: { ok: true } })
  }
  const page = await context.newPage()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto(url)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin })
  const host = page.locator('patmail-root')
  const panel = host.locator('.panel')
  await tabFor(page)
  assert.equal(await host.count(), 0)
  await showPanel(page)
  await panel.waitFor()
  await check('explicit SHOW_PANEL opens one isolated 360×600 panel', async () => {
    assert.equal(await host.count(), 1)
    assert.equal(await host.evaluate((node) => node.shadowRoot?.querySelectorAll('.panel').length), 1)
    await visible(panel, 360, 600)
    assert.equal(await host.evaluate((node) => getComputedStyle(node).width), '0px')
    assert.equal(await panel.evaluate((node) => getComputedStyle(node).pointerEvents), 'auto')
    assert.equal(await host.evaluate((node) => getComputedStyle(node, '::backdrop').display), 'none')
  })
  await check('page info and service worker PING', async () => {
    await panel.getByText('插件运行中').waitFor()
    assert.equal(await panel.locator('.page-card .url').textContent(), url)
    assert.equal(await panel.locator('.page-card .value').last().textContent(), 'PatMail 验收页面')
    const tab = (await worker.evaluate(() => chrome.tabs.query({}))).find((item) => item.url === url)
    assert(tab?.id)
    const pong = await worker.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: 'PING' }, { frameId: 0 }), tab.id)
    assert.deepEqual(pong, { type: 'PONG', payload: { ok: true } })
  })
  await check('scan counts and complete JSON exclude extension and page Shadow DOM', async () => {
    await panel.getByRole('button', { name: '扫描页面' }).click()
    await panel.getByLabel('扫描结果').waitFor()
    const counts = await panel.locator('.counts strong').allTextContents()
    assert.deepEqual(counts, ['3', '1', '3'])
    await panel.getByRole('button', { name: '查看 DOM' }).click()
    const snapshot = JSON.parse(await panel.locator('.dom pre').textContent())
    assert.equal(snapshot.version, 2)
    assert.equal(snapshot.page.url, url)
    assert.equal(snapshot.page.title, 'PatMail 验收页面')
    assert.equal(snapshot.page.hostname, '127.0.0.1')
    assert.deepEqual(snapshot.controls.filter(item => item.kind === 'input' || item.kind === 'textarea').map(item => item.id),
      ['name', 'password', 'attachment', 'memo', 'image-button', 'submit-button'])
    assert.equal(snapshot.controls.find(item => item.id === 'password').value, '[REDACTED]')
    assert.equal(snapshot.controls.find(item => item.id === 'attachment').value, '[REDACTED]')
    assert.equal(snapshot.controls.find(item => item.id === 'memo').value, '备注内容')
    assert.deepEqual(snapshot.controls.find(item => item.id === 'kind').options.map(option => option.text), ['甲', '乙'])
    assert.equal(snapshot.controls.find(item => item.id === 'image-button').displayValue, '图片提交')
    profile.push(`fixture ${snapshot.stats.totalControls} controls: ${snapshot.stats.durationMs} ms`)
    assert.deepEqual(snapshot.iframes, [{ src: '', sameOrigin: true }])
    const nested = page.frames().find(frame => frame !== page.mainFrame())
    assert(nested)
    assert.equal(await nested.evaluate(() => document.querySelectorAll('patmail-root').length), 0)
    assert(!JSON.stringify(snapshot).includes('hidden-in-site-shadow'))
    await panel.getByRole('button', { name: '复制 JSON' }).click()
    await panel.getByText('完整 JSON 已复制').waitFor()
    const full = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))
    assert.equal(full.version, 2)
    assert.equal(full.controls.length, 8)
    assert.equal(typeof full.scannedAt, 'string')
  })
  await check('page controls remain interactive; scan never submits', async () => {
    await page.locator('#name').fill('新值')
    await page.locator('#page-button').click()
    assert.equal(await page.locator('#page-state').textContent(), '已点击')
    assert.equal(await page.locator('#name').inputValue(), '新值')
    assert.equal(await page.evaluate(() => window.submitCount), 0)
  })
  await check('dynamic DOM is rescanned without extension self counting', async () => {
    await page.evaluate(() => {
      const input = document.createElement('input')
      input.id = 'dynamic-input'
      document.querySelector('#sample-form').append(input)
    })
    await panel.getByRole('button', { name: '扫描页面' }).click()
    assert.deepEqual(await panel.locator('.counts strong').allTextContents(), ['4', '1', '3'])
    const snapshot = JSON.parse(await panel.locator('.dom pre').textContent())
    assert(snapshot.controls.some((item) => item.id === 'dynamic-input'))
    assert.equal(await page.evaluate(() => window.submitCount), 0)
    await mkdir(path.join(root, 'test-results'), { recursive: true })
    await panel.screenshot({ path: path.join(root, 'test-results/patmail-panel.png') })
  })
  await check('file search reuses same-origin browser session and supports pagination, refresh, empty, expiry', async () => {
    const easyPage = await context.newPage()
    await easyPage.setViewportSize({ width: 1200, height: 800 })
    await easyPage.goto(easyUrl)
    await tabFor(easyPage)
    assert.equal(await easyPage.locator('patmail-root').count(), 0)
    await showPanel(easyPage)
    const easyPanel = easyPage.locator('patmail-root').locator('.panel')
    await easyPanel.getByText('未登录', { exact: true }).waitFor()
    assert(apiCalls.some(call => call.path === '/AjaxServers/Login.ashx' && !call.authenticated))
    await context.addCookies([{ name: 'pm_fixture_session', value: 'active', url: easyUrl,
      httpOnly: true, sameSite: 'Lax' }])
    await easyPanel.getByRole('button', { name: '重新检测' }).click()
    await easyPanel.getByText('已登录', { exact: true }).waitFor()
    await easyPanel.getByText('测试员', { exact: true }).waitFor()
    assert(apiCalls.some(call => call.path === '/AjaxServers/Login.ashx' && call.authenticated))
    await easyPanel.getByLabel('我方文号').fill('A+123')
    await easyPanel.getByRole('button', { name: '查询文件' }).click()
    await easyPanel.getByText('共 21 个文件').waitFor()
    await easyPanel.getByText('通知书-1.pdf').waitFor()
    await easyPanel.screenshot({ path: path.join(root, 'test-results/patmail-file-search.png') })
    const first = apiCalls.filter(call => call.path === '/AjaxServers/CaseInfo.ashx').at(-1)
    assert(first)
    assert.equal(first.method, 'POST')
    assert.equal(first.authenticated, true)
    assert.equal(first.params.get('case_volume'), 'A+123')
    assert.equal(first.params.get('Call'), 'GetSearchFiles')
    assert.equal(first.params.get('_doneCallback'), null)
    assert.equal([...first.params.keys()].length, 116)
    const pageSize = easyPanel.getByLabel('每页数量')
    await pageSize.waitFor({ timeout: 1000 })
    assert.deepEqual(await pageSize.locator('option').allTextContents(), ['20', '50', '100'])
    await pageSize.selectOption('50')
    await easyPanel.getByText('第 1 / 1 页').waitFor()
    assert.equal(apiCalls.filter(call => call.path === '/AjaxServers/CaseInfo.ashx').at(-1)?.params.get('pageSize'), '50')
    await pageSize.selectOption('20')
    await easyPanel.getByText('第 1 / 2 页').waitFor()
    await easyPanel.getByRole('button', { name: '下一页' }).click()
    await easyPanel.getByText('通知书-2.pdf').waitFor()
    assert.equal(apiCalls.filter(call => call.path === '/AjaxServers/CaseInfo.ashx').at(-1)?.params.get('pageIndex'), '2')
    await easyPanel.getByRole('button', { name: '刷新' }).click()
    await easyPanel.getByText('通知书-2.pdf').waitFor()
    await easyPanel.getByLabel('附件名称').fill('error')
    await easyPanel.getByRole('button', { name: '查询文件' }).click()
    await easyPanel.getByText('模拟业务失败').waitFor()
    const countBeforeRetry = apiCalls.length
    await easyPanel.getByRole('button', { name: '刷新' }).click()
    await easyPanel.getByText('模拟业务失败').waitFor()
    assert.equal(apiCalls.length, countBeforeRetry + 1)
    assert.equal(apiCalls.at(-1)?.params.get('file_name'), 'error')
    await easyPanel.getByLabel('我方文号').fill('')
    await easyPanel.getByLabel('附件名称').fill('empty')
    await easyPanel.getByRole('button', { name: '查询文件' }).click()
    await easyPanel.getByText('没有符合条件的文件。').waitFor()
    await easyPanel.getByLabel('附件名称').fill('')
    const countBeforeBlank = apiCalls.length
    await easyPanel.getByRole('button', { name: '查询文件' }).click()
    await easyPanel.getByText('请输入查询条件。').waitFor()
    assert.equal(apiCalls.length, countBeforeBlank)
    await context.clearCookies()
    await easyPanel.getByLabel('我方文号').fill('A-123')
    await easyPanel.getByRole('button', { name: '查询文件' }).click()
    await easyPanel.getByText('登录已失效', { exact: true }).waitFor()
    await easyPanel.getByText('EASY 登录已失效，请在原网站重新登录后检测。').waitFor()
    await easyPanel.getByRole('button', { name: '页面扫描' }).click()
    await easyPanel.getByRole('button', { name: '扫描页面' }).click()
    await easyPanel.getByLabel('扫描结果').waitFor()
    await easyPage.close()
  })
  await check('collapse, expand, drag, pointer cancel, and resize stay in viewport', async () => {
    await panel.getByRole('button', { name: '收起面板' }).click()
    await visible(panel, 220, 48)
    await panel.getByRole('button', { name: '展开面板' }).click()
    await visible(panel, 360, 600)
    const bar = panel.locator('.bar')
    const start = await bar.boundingBox()
    assert(start)
    await page.mouse.move(start.x + 70, start.y + 20)
    await page.mouse.down()
    await page.mouse.move(-100, -100)
    await page.mouse.up()
    await visible(panel)
    const after = await panel.boundingBox()
    assert(after && after.x <= 10 && after.y <= 10)
    const next = await bar.boundingBox()
    assert(next)
    await page.mouse.move(next.x + 70, next.y + 20)
    await page.mouse.down()
    await page.mouse.move(180, 180)
    await page.waitForFunction(() => document.querySelector('patmail-root')?.shadowRoot?.querySelector('.panel.dragging'))
    await bar.evaluate((node) => node.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })))
    await page.mouse.up()
    assert.equal(await panel.evaluate((node) => node.classList.contains('dragging')), false)
    await page.setViewportSize({ width: 310, height: 270 })
    await visible(panel, 294, 254)
    await panel.getByRole('button', { name: '收起面板' }).click()
    await visible(panel, 220, 48)
    await panel.getByRole('button', { name: '展开面板' }).click()
    await visible(panel, 294, 254)
    await page.setViewportSize({ width: 1200, height: 800 })
  })
  await check('close and SHOW_PANEL keep one host; reload does not restore it', async () => {
    await panel.getByRole('button', { name: '关闭面板' }).click()
    await host.waitFor({ state: 'detached' })
    const tab = (await worker.evaluate((target) => chrome.tabs.query({}), url)).find((item) => item.url === url)
    assert(tab?.id)
    for (let index = 0; index < 2; index++) {
      const response = await worker.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: 'SHOW_PANEL' }), tab.id)
      assert.deepEqual(response, { type: 'PANEL_SHOWN', payload: { ok: true } })
      await panel.waitFor()
      assert.equal(await host.count(), 1)
    }
    await page.reload()
    await tabFor(page)
    assert.equal(await host.count(), 0)
    await showPanel(page)
    await panel.waitFor()
    assert.equal(await host.count(), 1)
  })
  await check('popup renders, scans real active page, and explains restricted tab', async () => {
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
    await popup.getByText('插件运行中').waitFor()
    const tab = (await worker.evaluate((target) => chrome.tabs.query({}), url)).find((item) => item.url === url)
    assert(tab?.id)
    await popup.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), tab.id)
    await popup.getByRole('button', { name: '扫描当前页面' }).click()
    await popup.getByText('已扫描当前页面。').waitFor()
    assert.match(await popup.getByLabel('扫描结果').textContent(), /input：3[\s\S]*select：1[\s\S]*button：3/)
    await panel.getByRole('button', { name: '关闭面板' }).click()
    await host.waitFor({ state: 'detached' })
    await popup.getByRole('button', { name: '打开浮窗' }).click()
    await popup.getByText('浮窗已在当前页面打开。').waitFor()
    await panel.waitFor()
    assert.equal(await host.count(), 1)
    const restricted = await context.newPage()
    await restricted.goto('about:blank')
    const restrictedTab = (await worker.evaluate(() => chrome.tabs.query({}))).find((item) => item.url === 'about:blank')
    assert(restrictedTab?.id)
    await popup.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), restrictedTab.id)
    await popup.getByRole('button', { name: '扫描当前页面' }).click()
    await popup.getByText('此页面不在插件授权范围，请切换到 EASY 或本地验收页。').waitFor()
    await restricted.close()
    await popup.close()
  })
  await check('transformed, scrolling body keeps panel usable and reopenable', async () => {
    await page.evaluate(() => {
      document.body.style.transform = 'translateZ(0)'
      document.body.style.minHeight = '1600px'
      window.scrollTo(0, 500)
    })
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await visible(panel, 360, 600)
    const bar = await panel.locator('.bar').boundingBox()
    assert(bar)
    await page.mouse.move(bar.x + 70, bar.y + 20)
    await page.mouse.down()
    await page.mouse.move(520, 80)
    await page.mouse.up()
    await visible(panel)
    await panel.getByRole('button', { name: '关闭面板' }).click()
    await host.waitFor({ state: 'detached' })
    const tab = (await worker.evaluate(() => chrome.tabs.query({}))).find((item) => item.url === url)
    assert(tab?.id)
    await worker.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: 'SHOW_PANEL' }), tab.id)
    await panel.waitFor()
    await visible(panel, 360, 600)
  })
  await check('local body replacement restores one panel; close stays closed', async () => {
    await page.evaluate(() => {
      document.body.innerHTML = '<button id="replacement-button">网页正常工作</button>'
    })
    await panel.waitFor()
    assert.equal(await host.count(), 1)
    await page.locator('#replacement-button').click()
    await panel.getByRole('button', { name: '关闭面板' }).click()
    await host.waitFor({ state: 'detached' })
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<span>局部更新</span>'))
    assert.equal(await host.count(), 0)
  })
  await check('document.write replacement restores one panel', async () => {
    await page.reload()
    await tabFor(page)
    assert.equal(await host.count(), 0)
    await showPanel(page)
    await panel.waitFor()
    await page.evaluate(() => {
      document.open()
      document.write('<!doctype html><html><head><title>重写页面</title></head><body><button id="rewrite-button">网页按钮</button></body></html>')
      document.close()
    })
    await panel.waitFor({ timeout: 5000 })
    assert.equal(await host.count(), 1)
    await page.locator('#rewrite-button').click()
  })
  await check('large form scan reports profiling without observing the page', async () => {
    await page.reload()
    await tabFor(page)
    await showPanel(page)
    await panel.waitFor()
    await page.evaluate(() => {
      const batch = document.createDocumentFragment()
      for (let index = 0; index < 1000; index++) {
        const input = document.createElement('input')
        input.name = `field_${index}`
        batch.append(input)
      }
      document.body.append(batch)
    })
    await panel.getByRole('button', { name: '扫描页面' }).click()
    await panel.getByRole('button', { name: '查看 DOM' }).click()
    const snapshot = JSON.parse(await panel.locator('.dom pre').textContent())
    assert.equal(snapshot.stats.totalControls, 1008)
    assert(Number.isFinite(snapshot.stats.durationMs))
    profile.push(`large ${snapshot.stats.totalControls} controls: ${snapshot.stats.durationMs} ms`)
  })
  await check('icon action opens one full-page workspace and the next call focuses it', async () => {
    const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'))
    assert.equal(manifest.action.default_popup, undefined)
    assert.equal((await readFile(path.join(dist, 'app.html'), 'utf8')).includes('./app.js'), true)
    const launcher = await context.newPage()
    await launcher.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
    const opened = context.waitForEvent('page')
    const first = await launcher.evaluate(() => chrome.runtime.sendMessage({ type: 'WORKSPACE', payload: { action: 'focus' } }))
    assert.equal(first.payload.appTab.created, true)
    const app = await opened
    const second = await launcher.evaluate(() => chrome.runtime.sendMessage({ type: 'WORKSPACE', payload: { action: 'focus' } }))
    assert.equal(second.payload.appTab.created, false)
    assert.equal(first.payload.appTab.tabId, second.payload.appTab.tabId)
    const tabs = await worker.evaluate(() => chrome.tabs.query({}))
    assert.equal(tabs.filter((item) => item.url?.includes('/app.html')).length, 1)
    await app.getByRole('navigation', { name: '工作台导航' }).getByRole('link', { name: '客户管理' }).click()
    await app.waitForURL(/#\/customers$/)
    await app.reload()
    await app.waitForURL(/#\/customers$/)
    await app.getByRole('heading', { name: '尚未连接 EASY' }).waitFor()
    await app.getByText('尚未确认 EASY 用户，不能读取客户配置。').waitFor()
    assert.equal(await app.getByText('华为').count(), 0)
    assert.equal(await app.getByText('DEMO').count(), 0)
    assert.equal(await app.getByText('已成功发送').count(), 0)
    await context.addCookies([{ name: 'pm_fixture_session', value: 'active', url: easyUrl, httpOnly: true, sameSite: 'Lax' }])
    const easyPage = await context.newPage()
    await easyPage.goto(easyUrl)
    await tabFor(easyPage)
    assert.equal(await easyPage.locator('patmail-root').count(), 0)
    await app.bringToFront()
    await app.getByRole('button', { name: '刷新标签页' }).click()
    await app.getByText('发现一个 EASY 标签页，请确认后连接。').waitFor()
    await app.getByRole('button', { name: '连接所选标签页' }).click()
    await app.getByText('测试员').waitFor()
    await app.getByRole('link', { name: '文件查询' }).click()
    await app.getByText('已登录', { exact: true }).waitFor()
    await app.getByLabel('我方文号').fill('A+123')
    await app.getByRole('button', { name: '查询文件' }).click()
    await app.getByText('通知书-1.pdf').waitFor()
    await app.getByRole('link', { name: '系统设置' }).click()
    await app.getByText('Production Write：关闭').waitFor()
    await easyPage.close()
    workspace = app
  })
  await check('FullPageBusinessFlow saves a task from the full page and restores it', async () => {
    const app = workspace
    await context.addCookies([{ name: 'pm_fixture_session', value: 'active', url: easyUrl, httpOnly: true, sameSite: 'Lax' }])
    const easyPage = await context.newPage()
    await easyPage.goto(easyUrl)
    await tabFor(easyPage)
    assert.equal(await easyPage.locator('patmail-root').count(), 0)
    await app.bringToFront()
    await app.getByRole('button', { name: '刷新标签页' }).click()
    await app.getByText('发现一个 EASY 标签页，请确认后连接。').waitFor()
    await app.getByRole('button', { name: '连接所选标签页' }).click()
    await app.getByText('测试员').waitFor()
    await app.getByRole('link', { name: '客户管理' }).click()
    await app.getByLabel('名称').fill('测试客户')
    await app.getByLabel('查询覆盖').fill('case_volume=ABC')
    await app.getByRole('button', { name: '保存到当前账号' }).click()
    await app.getByText('客户配置已保存。', { exact: true }).waitFor()
    await app.getByText('case_volume=ABC').waitFor()
    await app.getByRole('button', { name: '编辑' }).click()
    await app.getByLabel('名称').fill('测试客户甲')
    await app.getByRole('button', { name: '保存到当前账号' }).click()
    await app.getByText('客户配置已保存。', { exact: true }).waitFor()
    await app.reload()
    await app.getByText('case_volume=ABC').waitFor()
    await app.getByText('测试客户甲').waitFor()
    await app.getByRole('button', { name: '编辑' }).click()
    await app.getByLabel('名称').fill('测试客户')
    await app.getByRole('button', { name: '保存到当前账号' }).click()
    await app.getByText('客户配置已保存。', { exact: true }).waitFor()
    await app.getByRole('link', { name: '文件查询' }).click()
    await app.getByLabel('我方文号').fill('A+123')
    await app.getByRole('button', { name: '查询文件' }).click()
    await app.getByRole('checkbox', { name: '通知书-1.pdf' }).check()
    await app.getByRole('button', { name: '下一页' }).click()
    await app.getByRole('checkbox', { name: '通知书-2.pdf' }).check()
    await app.getByRole('button', { name: '查看已选' }).click()
    await app.getByLabel('绑定到已有客户配置').focus()
    await app.waitForFunction(() => [...document.querySelectorAll('option')].some(item => item.textContent === '测试客户'))
    await app.getByLabel('绑定到已有客户配置').selectOption({ label: '测试客户' })
    await app.getByRole('button', { name: '绑定已选文件' }).click()
    await app.getByRole('button', { name: '生成发文计划' }).click()
    await app.getByRole('button', { name: '生成计划' }).click()
    await app.getByText(/已保存 · 任务 /).waitFor()
    await app.getByRole('link', { name: '发文任务' }).click()
    await app.getByText('测试客户').waitFor()
    await app.getByRole('button', { name: '详情' }).click()
    await app.getByText('Origin http://183.36.43.66:88').waitFor()
    await app.getByText('文件 2').waitFor()
    const taskUrl = app.url()
    await app.reload()
    await app.getByText('测试客户').waitFor()
    await app.getByRole('button', { name: '详情' }).click()
    await app.getByText('Origin http://183.36.43.66:88').waitFor()
    await app.getByRole('link', { name: '发文规则' }).click()
    await app.getByLabel('标题模板').fill('阶段三标题{文件名称}')
    await app.getByRole('button', { name: '保存标题和正文' }).click()
    await app.getByText('发文规则已保存。内容变化的旧任务会标记为过期。').first().waitFor()
    await app.getByRole('link', { name: '发文任务' }).click()
    await app.getByText('计划已过期').waitFor()
    const mailCalls = () => apiCalls.filter(item => item.path === '/AjaxServers/Mail.ashx').length
    const beforeMail = mailCalls()
    await app.getByRole('link', { name: '接口验收' }).click()
    await app.getByLabel('接口').selectOption('GetMailInfo')
    await app.getByRole('button', { name: '执行只读验收' }).click()
    await app.getByText('GetMailInfo BLOCKED').waitFor()
    assert.equal(mailCalls(), beforeMail)
    await app.getByLabel('邮件 ID').fill('50250250-5025-4025-8025-502502502502')
    await app.getByRole('button', { name: '执行只读验收' }).click()
    await app.getByText(/GetMailInfo FAIL/).first().waitFor()
    await app.getByLabel('接口').selectOption('GetFlowInfo')
    await app.getByLabel('邮件 ID').fill('11111111-1111-4111-8111-111111111111')
    await app.getByLabel('流程类型').fill('NO')
    await app.getByRole('button', { name: '执行只读验收' }).click()
    await app.getByText(/GetFlowInfo (BLOCKED|FAIL)/).first().waitFor()
    await app.getByLabel('接口').selectOption('GetUserModel')
    await app.getByLabel('邮件 ID').fill('')
    await app.getByLabel('流程类型').fill('')
    await app.getByRole('button', { name: '执行只读验收' }).click()
    await app.getByText('GetUserModel PASS').first().waitFor()
    await app.getByText('未与原网页对照').first().waitFor()
    const storedKey = 'patmail.mail.v1:http://183.36.43.66:88:11111111-1111-1111-1111-111111111111'
    const stale = await app.evaluate(async (key) => {
      const stored = await chrome.storage.local.get(key)
      const bundle = stored[key]
      bundle.revision -= 1
      bundle.subject.template = '过期标题'
      const loaded = await chrome.runtime.sendMessage({ type: 'WORKSPACE', payload: { action: 'load' } })
      const connection = loaded.payload.connection
      return chrome.runtime.sendMessage({
        type: 'WORKSPACE',
        payload: {
          action: 'saveRules',
          bundle,
          expectedScope: {
            easyOrigin: connection.easyOrigin,
            operatorId: connection.operatorId,
            easyTabId: connection.easyTabId,
            connectionVersion: connection.connectionVersion
          }
        }
      })
    }, storedKey)
    assert.equal(stale.payload.ok, false)
    assert.match(stale.payload.message, /其他页面/)
    await showPanel(easyPage)
    assert.equal(await easyPage.locator('patmail-root').count(), 1)
    await context.addCookies([{ name: 'pm_fixture_user', value: 'b', url: easyUrl, httpOnly: true, sameSite: 'Lax' }])
    await easyPage.reload()
    await tabFor(easyPage)
    await app.bringToFront()
    await app.getByRole('button', { name: '重新检测会话' }).click()
    await app.getByText('用户乙').waitFor()
    await app.getByRole('link', { name: '客户管理' }).click()
    assert.equal(await app.getByText('测试客户').count(), 0)
    const userCalls = apiCalls.filter(item => item.path === '/AjaxServers/Login.ashx').length
    const liveWorker = context.serviceWorkers().find(item => item.url().includes(extensionId))
    assert.ok(liveWorker)
    await liveWorker.evaluate(() => { globalThis.__patmailBoot = 1 })
    const browser = context.browser()
    assert.ok(browser)
    const cdp = await browser.newBrowserCDPSession()
    const { targetInfos } = await cdp.send('Target.getTargets')
    const target = targetInfos.find(item => item.type === 'service_worker' && item.url.includes(extensionId))
    assert.ok(target)
    await cdp.send('Target.closeTarget', { targetId: target.targetId })
    const again = await context.newPage()
    await again.goto(`chrome-extension://${extensionId}/app.html`)
    const nextWorker = context.serviceWorkers().find(item => item.url().includes(extensionId))
    assert.ok(nextWorker)
    assert.notEqual(await nextWorker.evaluate(() => globalThis.__patmailBoot ?? 0), 1)
    await again.getByRole('button', { name: '重新检测会话' }).click()
    await again.getByText('用户乙').waitFor()
    assert.equal(await again.getByText('测试客户').count(), 0)
    assert.ok(apiCalls.filter(item => item.path === '/AjaxServers/Login.ashx').length > userCalls)
    assert.equal(taskUrl.includes('#/tasks') || taskUrl.includes('app.html'), true)
    await easyPage.close()
  })
  assert.deepEqual(errors, [], `browser errors: ${errors.join('\n')}`)
  await writeFile(path.join(root, 'test-results/patmail-e2e.txt'), `${checks} checks passed; browser errors: 0\n${profile.join('\n')}\n`)
  profile.forEach(line => console.log(line))
  console.log(`${checks} browser checks passed; screenshot: test-results/patmail-panel.png`)
} finally {
  await context.close()
  await new Promise((resolve) => server.close(resolve))
}
