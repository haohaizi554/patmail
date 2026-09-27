import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const origin = 'http://183.36.43.66:88'
const profileDir = join(root, 'test-results', 'live-chrome-profile-v2')
const outPath = join(root, 'test-results', 'live-mail-ui.json')

async function login(page) {
  const user = process.env.PATMAIL_LIVE_USER || ''
  const password = process.env.PATMAIL_LIVE_PASSWORD || ''
  if (!/Login\.aspx/i.test(page.url())) return
  const collapse = page.getByRole('button', { name: '收起面板' })
  if (await collapse.count()) await collapse.click().catch(() => {})
  const remember = page.locator('#chk_password')
  if (await remember.count() && await remember.isChecked()) await remember.uncheck()
  await page.locator('#txtUser').fill(user)
  await page.locator('#txtPwd').fill(password)
  await page.locator('#btnLogin').click({ force: true })
  await page.waitForURL(url => !/Login\.aspx/i.test(url.pathname), { timeout: 25000 })
}

const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chromium',
  headless: false,
  viewport: { width: 1400, height: 900 }
})
const page = context.pages()[0] || await context.newPage()
const notes = { url: '', buttons: [], frames: [] }
try {
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await login(page)
  notes.menus = {}
  for (const name of ['案件管理', '发文管理']) {
    await page.getByText(name, { exact: true }).first().click()
    await page.waitForTimeout(800)
    notes.menus[name] = await page.locator('a').evaluateAll(nodes =>
      nodes.map(node => (node.innerText || '').replace(/\s+/g, ' ').trim()).filter(text => text && text.length < 40).slice(0, 80)
    )
  }
  await page.getByText('案件管理', { exact: true }).first().click()
  await page.waitForTimeout(400)
  await page.getByText('案件查询', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(400)
  const fileLinks = page.locator('a').filter({ hasText: '文件管理' })
  notes.fileLinks = []
  const count = await fileLinks.count()
  for (let index = 0; index < count; index += 1) {
    const link = fileLinks.nth(index)
    notes.fileLinks.push({
      href: await link.getAttribute('href'),
      text: ((await link.innerText()) || '').replace(/\s+/g, ' ').trim(),
      visible: await link.isVisible()
    })
  }
  if (count > 0) {
    await fileLinks.last().click({ force: true })
    await page.waitForTimeout(4000)
  }
  notes.form = await page.locator('input,select,textarea,button,a').evaluateAll(nodes =>
    nodes.map(node => ({
      tag: node.tagName,
      id: node.id,
      name: node.name || '',
      type: node.type || '',
      text: ((node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') && node.type !== 'button' && node.type !== 'submit' ? '' : (node.innerText || node.value || '')).replace(/\s+/g, ' ').trim().slice(0, 40)
    })).filter(item => item.id || item.text).slice(0, 80)
  )
  notes.url = page.url()
  notes.buttons = await page.locator('a,button,input[type="button"],input[type="submit"]').evaluateAll(nodes =>
    nodes.map(node => (node.innerText || node.value || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 80)
  )
  notes.frameUrls = page.frames().map(frame => frame.url()).filter(url => url && url !== 'about:blank')
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    const url = frame.url()
    if (!/FileSearch|mail|Patent/i.test(url)) continue
    const buttons = await frame.locator('a,button,input[type="button"],input[type="submit"]').evaluateAll(nodes =>
      nodes.map(node => ({ id: node.id, text: (node.innerText || node.value || '').replace(/\s+/g, ' ').trim() })).filter(item => item.text).slice(0, 60)
    ).catch(() => [])
    const fields = await frame.locator('input,select,textarea').evaluateAll(nodes =>
      nodes.map(node => {
        const label = node.id ? (node.ownerDocument.querySelector(`label[for="${node.id}"]`)?.innerText || '') : ''
        const previous = node.previousElementSibling ? (node.previousElementSibling.innerText || '') : ''
        return {
          id: node.id,
          name: node.name || '',
          type: node.type || node.tagName,
          label: (label || previous).replace(/\s+/g, ' ').trim().slice(0, 40)
        }
      }).filter(item => item.id).slice(0, 80)
    ).catch(() => [])
    notes.frames.push({ url, buttons, fields })
  }
  writeFileSync(outPath, JSON.stringify(notes, null, 2))
  console.log(`ui map frames ${notes.frames.length} buttons ${notes.buttons.length}`)
} catch (error) {
  notes.error = error instanceof Error ? error.message : 'failed'
  writeFileSync(outPath, JSON.stringify(notes, null, 2))
  console.error(notes.error)
  process.exitCode = 1
} finally {
  await context.close()
}
