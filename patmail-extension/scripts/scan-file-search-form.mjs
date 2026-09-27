import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { scanFileSearchForm, warmFileSearchTrees } from '../src/query/scan-file-search-form.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const profileDir = join(root, 'test-results', 'live-chrome-profile-v2')
const snapshotPath = join(root, 'src', 'query', 'file-search-form.snapshot.json')
const origin = 'http://183.36.43.66:88'
const pageUrl = `${origin}/Forms/Patent/FileSearch.aspx`

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[key]

mkdirSync(profileDir, { recursive: true })
const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1440, height: 900 }
})

try {
  const page = context.pages()[0] || await context.newPage()
  const calls = []
  const errors = []
  page.on('pageerror', error => errors.push(String(error).slice(0, 180)))
  page.on('response', response => {
    const call = new URLSearchParams(response.request().postData() || '').get('Call')
    if (call) calls.push(`${response.status()} ${call}`)
  })
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  if (/Login\.aspx/i.test(page.url())) {
    const user = process.env.PATMAIL_LIVE_USER || ''
    const password = process.env.PATMAIL_LIVE_PASSWORD || ''
    if (!user || !password) throw new Error('登录页已打开，但没有可用的登录环境变量。')
    const remember = page.locator('#chk_password')
    if (await remember.count() && await remember.isChecked()) await remember.uncheck()
    await page.locator('#txtUser').fill(user)
    await page.locator('#txtPwd').fill(password)
    await page.locator('#btnLogin').click({ force: true })
    await page.waitForURL(url => !/Login\.aspx/i.test(url.pathname), { timeout: 25000 })
  }
  const shell = await page.evaluate(() => ({
    url: location.pathname,
    frames: [...document.querySelectorAll('iframe,frame')].map(el => ({ id: el.id, name: el.name, src: el.getAttribute('src') || '' })).slice(0, 12),
    links: [...document.querySelectorAll('a')].map(el => el.getAttribute('href') || '').filter(href => /FileSearch|Case/i.test(href)).slice(0, 12)
  }))
  console.log(JSON.stringify(shell))
  await page.locator('#mframe').evaluate(frame => { frame.src = '/Forms/Patent/FileSearch.aspx' })
  const search = await page.waitForEvent('framenavigated', { timeout: 20000 }).catch(() => null)
  const frame = page.frame({ url: /FileSearch\.aspx/i }) || search
  if (!frame) throw new Error('没有在主框架里打开文件查询页。')
  await frame.waitForSelector('#table_element', { timeout: 20000 })
  await frame.waitForFunction(() => (document.querySelector('#case_type')?.querySelectorAll('option').length ?? 0) > 1, { timeout: 20000 }).catch(() => {})
  console.log(errors.slice(0, 4).join('\n'))
  await frame.evaluate(warmFileSearchTrees)
  const scanned = await frame.evaluate(scanFileSearchForm)
  const snapshot = {
    page: 'FileSearch.aspx',
    capturedAt: new Date().toISOString(),
    source: frame.url().split('?')[0],
    fields: scanned.fields
  }
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2))
  const visible = snapshot.fields.filter(item => item.visible)
  const hidden = snapshot.fields.filter(item => !item.visible)
  const withOptions = snapshot.fields.filter(item => item.options.length)
  console.log(`visible ${visible.length}, hidden ${hidden.length}, with options ${withOptions.length}`)
  for (const id of ['flow_direction', 'agency_id', 'apply_type', 'filetemp', 'sales', 'case_type', 'p_case_info__charge_dept_id']) {
    const field = snapshot.fields.find(item => item.id === id)
    const parents = field ? field.options.filter(item => item.parent).length : 0
    console.log(id, field ? `${field.control} ${field.options.length} parents ${parents} ${JSON.stringify(field.options.slice(0, 3))}` : 'missing')
  }
  console.log(hidden.map(item => `${item.label} ${item.id} <= ${item.hiddenBy.join(' / ') || 'computed'}`).join('\n'))
} finally {
  await context.close()
}
