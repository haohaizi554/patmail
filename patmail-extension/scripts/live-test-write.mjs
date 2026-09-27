import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const origin = 'http://183.36.43.66:88'
const profileDir = join(root, 'test-results', 'live-chrome-profile-v2')
const evidencePath = join(root, 'test-results', 'live-test-write.json')
const caseVolume = process.env.PATMAIL_LIVE_CASE_VOLUME || 'PA2622582CND-YS'
const reviewerName = '吴晨晨'
const writes = new Set(['MailCustomer', 'SaveMailInfo', 'SaveMailRalteCaseFile', 'FlowSubmit', 'EndEmailFlowd', 'DeleteMail', 'DelMail'])
const observed = []

function redact(text) {
  const password = process.env.PATMAIL_LIVE_PASSWORD || ''
  let value = String(text || '').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
  if (password) value = value.split(password).join('[redacted]')
  return value.replace(/\s+/g, ' ').slice(0, 240)
}

const evidence = {
  mode: 'TEST_WRITE_AUTHORIZED',
  reviewer: reviewerName,
  caseVolume,
  steps: [],
  calls: [],
  cancelled: false,
  mailId: ''
}
function step(name, detail = '') {
  evidence.steps.push({ name, detail: redact(detail), at: new Date().toISOString() })
  console.log(name, redact(detail))
}
function save() {
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
}

async function login(page) {
  if (!/Login\.aspx/i.test(page.url())) return
  const remember = page.locator('#chk_password')
  if (await remember.count() && await remember.isChecked()) await remember.uncheck()
  await page.locator('#txtUser').fill(process.env.PATMAIL_LIVE_USER || '')
  await page.locator('#txtPwd').fill(process.env.PATMAIL_LIVE_PASSWORD || '')
  await page.locator('#btnLogin').click({ force: true })
  await page.waitForURL(url => !/Login\.aspx/i.test(url.pathname), { timeout: 25000 })
}

async function openFileSearch(page) {
  await page.getByText('案件管理', { exact: true }).first().click()
  await page.waitForTimeout(400)
  await page.getByText('案件查询', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(400)
  await page.locator('a').filter({ hasText: '文件管理' }).last().click({ force: true })
  await page.waitForTimeout(1500)
  const frame = page.frames().find(item => /FileSearch\.aspx/i.test(item.url()))
  if (!frame) throw new Error('没有打开文件查询')
  return frame
}

async function confirmBox(page) {
  const button = page.locator('.layui-layer-btn0, .dialog-btn, input[value="确定"], button:has-text("确定")').first()
  if (await button.count() && await button.isVisible().catch(() => false)) {
    await button.click({ force: true })
    return true
  }
  return false
}

const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chromium',
  headless: false,
  viewport: { width: 1400, height: 900 }
})
context.on('request', request => {
  if (!request.url().startsWith(origin)) return
  const params = new URLSearchParams(request.postData() || '')
  const call = params.get('Call')
  if (!call) return
  observed.push(call)
  if (writes.has(call) || /delete|delmail|cancel/i.test(call)) evidence.calls.push({ call, at: new Date().toISOString() })
})
const page = context.pages()[0] || await context.newPage()
try {
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await login(page)
  step('logged-in', page.url())
  const search = await openFileSearch(page)
  await search.locator('#case_volume').fill(caseVolume)
  await search.locator('#btn_Search').click()
  await search.getByText('实用新型专利证书', { exact: false }).first().waitFor({ timeout: 20000 })
  const selected = await search.evaluate(() => {
    const main = document.querySelector('.layui-table-main') || document
    const row = [...main.querySelectorAll('tr')].find(item => item.innerText.includes('实用新型专利证书'))
    if (!row) return 'missing-row'
    const index = row.getAttribute('data-index')
    const fixed = index == null ? null : document.querySelector(`.layui-table-fixed tr[data-index="${index}"] .layui-form-checkbox`)
    const skin = fixed || row.querySelector('.layui-form-checkbox')
    if (skin) {
      skin.click()
      return `skin:${index}`
    }
    return `no-skin:${index}`
  })
  step('row-click', selected)
  step('file-selected', caseVolume)
  await search.locator('#a_mailcm').click({ force: true })
  await page.waitForTimeout(1500)
  await page.waitForTimeout(2000)
  const alertText = await page.locator('.layui-layer-content').allInnerTexts().catch(() => [])
  step('alert', alertText.join(' | '))
  const frames = page.frames().map(item => item.url())
  evidence.dialogFrames = frames
  const names = []
  for (const frame of page.frames()) {
    const texts = await frame.locator('.layui-layer, .ztree a, li').evaluateAll(nodes =>
      nodes.map(node => (node.innerText || '').replace(/\s+/g, ' ').trim()).filter(text => text && text.length < 40)
    ).catch(() => [])
    names.push(...texts)
  }
  evidence.typeNames = [...new Set(names)].slice(0, 80)
  step('mail-types', evidence.typeNames.slice(0, 20).join(' | '))
  throw new Error('先确认发文类型列表，尚未创建发文')
  await page.waitForTimeout(2500)
  const mail = page.frames().find(item => /mail\.aspx/i.test(item.url()))
  if (!mail) throw new Error('发文页面没有打开，未继续提交')
  const mailUrl = new URL(mail.url())
  evidence.mailId = mailUrl.searchParams.get('objid') || mailUrl.searchParams.get('guid') || ''
  step('mail-opened', evidence.mailId)
  await mail.locator('#submit').click({ force: true })
  await page.waitForTimeout(1500)
  const flow = page.frames().find(item => /IhgFlow|flow/i.test(item.url())) || mail
  const self = flow.getByText(reviewerName, { exact: false }).last()
  if (await self.count()) await self.click({ force: true })
  step('reviewer-click', reviewerName)
  await confirmBox(page)
  await page.waitForTimeout(2000)
  const deleted = await mail.locator('#delete').click({ force: true }).then(() => true).catch(() => false)
  await page.waitForTimeout(800)
  const deleteConfirmed = await confirmBox(page)
  evidence.cancelled = deleted && deleteConfirmed
  step('delete', `clicked=${deleted} confirmed=${deleteConfirmed}`)
  save()
} catch (error) {
  step('stopped', error instanceof Error ? error.message : 'failed')
  const mail = page.frames().find(item => /mail\.aspx/i.test(item.url()))
  if (mail) {
    await mail.locator('#delete').click({ force: true }).catch(() => {})
    await page.waitForTimeout(800)
    evidence.cancelled = await confirmBox(page)
    step('delete-after-error', String(evidence.cancelled))
  }
  save()
  process.exitCode = 1
} finally {
  evidence.calls = evidence.calls.filter(item => item.call)
  save()
  await Promise.race([context.close(), new Promise(resolve => setTimeout(resolve, 8000))])
}
