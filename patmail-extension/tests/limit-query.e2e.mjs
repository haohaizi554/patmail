import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.resolve(process.env.PATMAIL_TEST_DIST || path.join(root, 'dist'))
const fixture = await readFile(path.join(root, 'tests/fixtures/page.html'))
const easyUrl = 'http://183.36.43.66:88/fixture'
const operatorId = '11111111-1111-1111-1111-111111111111'
const caseTypeId = '31D1A147-2931-43B5-94AE-B72B1525BA8A'
const apiCalls = []
let limitMode = 'success'

function json(response) {
  return JSON.stringify({ ClientInfo: { IsLogin: true, Status: true, Result: true }, ...response })
}

function authenticated(headers) {
  return headers.cookie?.includes('pm_fixture_session=active') === true
}

function limitRow(customerName) {
  return {
    proc_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    case_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    case_volume: 'GAC-TY-001',
    case_name: '广汽丰田案件',
    ctrl_proc: '官方期限事项',
    customer_name: customerName,
    app_no: 'CN20260001',
    legal_due_date: '2026-12-31',
    cus_due_date: '2026-11-30',
    int_due_date: '2026-10-31'
  }
}

let context
try {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`]
  })
} catch (error) {
  throw error
}

// Intercept the complete EASY origin so this test never contacts the live service.
await context.route('http://183.36.43.66:88/**', async route => {
  const request = route.request()
  const pathName = new URL(request.url()).pathname
  if (pathName === '/favicon.ico') {
    await route.fulfill({ status: 204 })
    return
  }
  if (pathName === '/fixture') {
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture })
    return
  }

  const params = new URLSearchParams(request.postData() ?? '')
  const headers = await request.allHeaders()
  const isAuthenticated = authenticated(headers)
  apiCalls.push({ path: pathName, method: request.method(), params, authenticated: isAuthenticated })

  if (pathName === '/AjaxServers/Login.ashx' && params.get('Call') === 'GetUserModel') {
    if (!isAuthenticated) {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: '<div style="width:100%;text-align: center;font-size:40px;">出错了!</div>'
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: JSON.stringify({
        UserModel: { user_id: operatorId, user_name: 'tester', Name: '测试员', SessionId: 'fixture-only' },
        ClientInfo: { IsLogin: true, Status: true, Result: false, Message: null }
      })
    })
    return
  }

  if (pathName === '/AjaxServers/CaseInfo.ashx' && params.get('Call') === 'SearchQueryHisList') {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: json({ Options: null, QueryXml: null })
    })
    return
  }

  if (pathName === '/AjaxServers/CaseInfo.ashx' && params.get('Call') === 'GetApplyTags') {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: json({ ApplyTags: null })
    })
    return
  }

  if (pathName === '/AjaxServers/Report.ashx' && params.get('Call') === 'LimitMonitorInit') {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: json({
        CountryInfo: [], CaseType: [], ProcStatus: [], CustomerStatus: [], procType: [],
        Case_direction: [], apply_type: [], case_status: [], BussType: []
      })
    })
    return
  }

  if (pathName === '/AjaxServers/Report.ashx' && params.get('Call') === 'LimitMonitorGetCtrlproc') {
    await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: json({ CtrlProc: [] }) })
    return
  }

  if (pathName === '/AjaxServers/Report.ashx' && params.get('Call') === 'GetLimitMonitorCaseList') {
    if (!isAuthenticated) {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: JSON.stringify({ ClientInfo: { IsLogin: false, Status: false, Result: false }, TableRows: null, TableRowsCount: '0' })
      })
      return
    }
    if (limitMode === 'expired') {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: JSON.stringify({ ClientInfo: { IsLogin: false, Status: false, Result: false }, TableRows: null, TableRowsCount: '0' })
      })
      return
    }
    if (limitMode === 'http-error') {
      await route.fulfill({ status: 503, contentType: 'text/plain; charset=utf-8', body: 'fixture unavailable' })
      return
    }
    const customerName = params.get('customer_name') || ''
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: json({ TableRows: [limitRow(customerName)], TableRowsCount: '1' })
    })
    return
  }

  // The picker load fans out across these read-only endpoints. Empty valid bodies
  // are enough for the page to become queryable while keeping the fixture small.
  if (pathName === '/AjaxServers/BaseInfo.ashx' || pathName === '/AjaxServers/Common.ashx') {
    await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: json({}) })
    return
  }
  await route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'fixture route not found' })
})

const errors = []
const requestFailures = []
const watch = page => {
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (/responded with a status of 503/.test(message.text())) return
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('requestfailed', request => {
    if (request.url().includes('/AjaxServers/')) requestFailures.push({ url: request.url(), failure: request.failure()?.errorText })
  })
}
context.on('page', watch)
for (const page of context.pages()) watch(page)

async function tabFor(worker, targetPage) {
  const targetUrl = targetPage.url()
  for (let attempt = 0; attempt < 30; attempt++) {
    const tab = (await worker.evaluate(() => chrome.tabs.query({}))).find(item => item.url === targetUrl)
    if (tab?.id) {
      try {
        const pong = await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: 'PING' }, { frameId: 0 }), tab.id)
        if (pong?.type === 'PONG') return tab
      } catch {
        // Content script can take one or two frames to attach after navigation.
      }
    }
    await targetPage.waitForTimeout(100)
  }
  throw new Error(`content script did not answer ${targetUrl}`)
}

try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  const extensionId = new URL(worker.url()).host
  assert.match(extensionId, /^[a-p]{32}$/)

  await context.addCookies([{ name: 'pm_fixture_session', value: 'active', url: easyUrl, httpOnly: true, sameSite: 'Lax' }])
  const easyPage = await context.newPage()
  await easyPage.goto(easyUrl)
  await tabFor(worker, easyPage)

  const app = await context.newPage()
  await app.goto(`chrome-extension://${extensionId}/app.html#/limits`)
  await app.getByText('测试员', { exact: true }).waitFor({ timeout: 15_000 })
  await app.getByRole('heading', { name: '期限监控', exact: true }).waitFor()
  await app.getByText('当前账号还没有期限监控模板。', { exact: true }).waitFor({ timeout: 15_000 })

  const customer = app.getByLabel('客户名称', { exact: true })
  await customer.fill('广汽丰田')
  const queryButton = app.getByRole('button', { name: '查询', exact: true })
  assert.equal(await queryButton.isEnabled(), true)
  const requestPromise = easyPage.waitForRequest(request => {
    if (request.url() !== `${new URL(easyUrl).origin}/AjaxServers/Report.ashx`) return false
    const params = new URLSearchParams(request.postData() ?? '')
    return params.get('Call') === 'GetLimitMonitorCaseList' && params.get('customer_name') === '广汽丰田'
  }, { timeout: 15_000 })
  await queryButton.click()
  const request = await requestPromise
  const params = new URLSearchParams(request.postData() ?? '')
  assert.equal(request.method(), 'POST')
  assert.equal(params.get('Call'), 'GetLimitMonitorCaseList')
  assert.equal(params.get('customer_name'), '广汽丰田')
  assert.equal(params.get('is_first'), 'false')
  assert.equal(params.get('pageIndex'), '1')
  assert.equal(params.get('pageSize'), '10')
  assert.equal(params.get('case_type'), caseTypeId)
  assert.equal(params.get('type'), 'all')
  assert.equal(params.get('log_pagename'), 'LimitMonitor.aspx')
  // The documented 115 field order includes one extra business_type_other field
  // used by the current page script, so the current request has 116 keys.
  assert.equal([...params.keys()].length, 116)
  for (const field of ['country', 'case_volume', 'case_volume_customer', 'app_no', 'ctrl_proc', 'customer_code', 'colsel', '_t']) {
    assert.equal(params.has(field), true, `missing GetLimitMonitorCaseList field: ${field}`)
  }
  await app.getByText('广汽丰田案件', { exact: true }).waitFor({ timeout: 15_000 })
  await app.getByText('广汽丰田', { exact: true }).last().waitFor()
  await app.getByText('共 1 条', { exact: true }).waitFor()
  console.log('✓ limits query sends Report.ashx/GetLimitMonitorCaseList and renders the returned row')

  limitMode = 'expired'
  await customer.fill('会话失效')
  const expiredRequest = easyPage.waitForRequest(request => {
    if (request.url() !== `${new URL(easyUrl).origin}/AjaxServers/Report.ashx`) return false
    const params = new URLSearchParams(request.postData() ?? '')
    return params.get('Call') === 'GetLimitMonitorCaseList' && params.get('customer_name') === '会话失效'
  }, { timeout: 15_000 })
  await queryButton.click()
  await expiredRequest
  await app.getByText('EASY 登录已失效，请在原网站重新登录后检测。', { exact: true }).waitFor({ timeout: 15_000 })
  console.log('✓ limits query surfaces a direct session-expiry response')

  limitMode = 'http-error'
  await customer.fill('网关错误')
  const errorRequest = easyPage.waitForRequest(request => {
    if (request.url() !== `${new URL(easyUrl).origin}/AjaxServers/Report.ashx`) return false
    const params = new URLSearchParams(request.postData() ?? '')
    return params.get('Call') === 'GetLimitMonitorCaseList' && params.get('customer_name') === '网关错误'
  }, { timeout: 15_000 })
  await queryButton.click()
  await errorRequest
  await app.getByText('EASY 暂时没有返回列表，可以再查一次。', { exact: true }).waitFor({ timeout: 15_000 })
  assert.equal(apiCalls.filter(call => call.path === '/AjaxServers/Report.ashx' && call.params.get('Call') === 'GetLimitMonitorCaseList' && call.params.get('customer_name') === '网关错误').length, 3)
  console.log('✓ limits query surfaces a direct HTTP error response after read-only retries')

  assert(apiCalls.some(call => call.path === '/AjaxServers/Login.ashx' && call.params.get('Call') === 'GetUserModel' && call.authenticated))
  assert.equal(requestFailures.length, 0, `unexpected EASY request failures: ${JSON.stringify(requestFailures)}`)
  assert.deepEqual(errors, [], `browser errors: ${errors.join('\n')}`)
  console.log('limit-query e2e passed; all EASY requests were fixture-intercepted')
} finally {
  await context.close()
}
