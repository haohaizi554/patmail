import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const fixture = await readFile(path.join(root, 'tests/fixtures/page.html'))
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204).end(); return }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fixture)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
server.unref()
const address = server.address()
assert(address && typeof address !== 'string')
const url = `http://127.0.0.1:${address.port}/fixture`
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
const errors = []
const watch = (page) => {
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
}
context.on('page', watch)
for (const page of context.pages()) watch(page)
let checks = 0
const check = (name, action) => Promise.resolve().then(action).then(() => {
  checks++; console.log(`✓ ${name}`)
})
const visible = async (panel, width, height) => {
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
  const page = await context.newPage()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto(url)
  const host = page.locator('patmail-root')
  const panel = host.locator('.panel')
  await panel.waitFor()
  await check('auto injection and isolated 360×600 panel', async () => {
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
    assert.deepEqual(counts, ['4', '1', '3'])
    await panel.getByRole('button', { name: '查看 DOM' }).click()
    const snapshot = JSON.parse(await panel.locator('.dom pre').textContent())
    assert.equal(snapshot.url, url)
    assert.equal(snapshot.title, 'PatMail 验收页面')
    assert.equal(snapshot.hostname, '127.0.0.1')
    assert.deepEqual(snapshot.inputs.map((item) => item.id), ['name', 'password', 'attachment', 'memo'])
    assert.equal(snapshot.inputs.find((item) => item.id === 'password').value, '')
    assert.equal(snapshot.inputs.find((item) => item.id === 'attachment').value, '')
    assert.equal(snapshot.inputs.find((item) => item.id === 'memo').value, '备注内容')
    assert.deepEqual(snapshot.selects[0].options, ['甲', '乙'])
    assert.deepEqual(snapshot.buttons.map((item) => item.id), ['page-button', 'image-button', 'submit-button'])
    assert.equal(snapshot.buttons.find((item) => item.id === 'image-button').text, '图片提交')
    assert(!JSON.stringify(snapshot).includes('hidden-in-site-shadow'))
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
    assert.deepEqual(await panel.locator('.counts strong').allTextContents(), ['5', '1', '3'])
    const snapshot = JSON.parse(await panel.locator('.dom pre').textContent())
    assert(snapshot.inputs.some((item) => item.id === 'dynamic-input'))
    assert.equal(await page.evaluate(() => window.submitCount), 0)
    await mkdir(path.join(root, 'test-results'), { recursive: true })
    await panel.screenshot({ path: path.join(root, 'test-results/patmail-panel.png') })
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
  await check('close, SHOW_PANEL twice, and refresh preserve one host', async () => {
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
    assert.match(await popup.getByLabel('扫描结果').textContent(), /input：4[\s\S]*select：1[\s\S]*button：3/)
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
    await popup.getByText('此页面不允许插件注入，请切换到普通网页。').waitFor()
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
  assert.deepEqual(errors, [], `browser errors: ${errors.join('\n')}`)
  await writeFile(path.join(root, 'test-results/patmail-e2e.txt'), `${checks} checks passed; browser errors: 0\n`)
  console.log(`${checks} browser checks passed; screenshot: test-results/patmail-panel.png`)
} finally {
  await context.close()
  await new Promise((resolve) => server.close(resolve))
}
