import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const profileDir = join(root, 'test-results', 'live-chrome-profile-v2')
const evidencePath = join(root, 'test-results', 'live-readonly-evidence.json')
const origin = 'http://183.36.43.66:88'
const writes = new Set(['MailCustomer', 'SaveMailInfo', 'SaveMailRalteCaseFile', 'FlowSubmit', 'EndEmailFlowd'])
const secret = /cookie|authorization|password|token|session/i

function redact(value) {
  const password = process.env.PATMAIL_LIVE_PASSWORD || ''
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value
    let text = value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    if (password) text = text.split(password).join('[redacted]')
    return text
  }
  const output = {}
  for (const [key, item] of Object.entries(value)) output[key] = secret.test(key) ? '[redacted]' : redact(item)
  return output
}

async function loginWithEnv(page) {
  const user = process.env.PATMAIL_LIVE_USER || ''
  const password = process.env.PATMAIL_LIVE_PASSWORD || ''
  if (!user || !password || !/Login\.aspx/i.test(page.url())) return { attempted: false, stayedOnLogin: false, notice: '' }
  const collapse = page.getByRole('button', { name: '收起面板' })
  if (await collapse.count()) await collapse.click().catch(() => {})
  const remember = page.locator('#chk_password')
  if (await remember.count() && await remember.isChecked()) await remember.uncheck()
  await page.locator('#txtUser').fill(user)
  await page.locator('#txtPwd').fill(password)
  await page.locator('#btnLogin').click({ force: true })
  await page.waitForURL(url => !/Login\.aspx/i.test(url.pathname), { timeout: 25000 }).catch(() => {})
  const stayedOnLogin = /Login\.aspx/i.test(page.url())
  const notice = stayedOnLogin
    ? await page.locator('body').innerText().then(text => text.replace(/\s+/g, ' ').slice(0, 180)).catch(() => '')
    : ''
  return { attempted: true, stayedOnLogin, notice }
}

function row(call, extra) {
  const now = new Date().toISOString()
  return redact({
    call,
    startedAt: now,
    finishedAt: now,
    httpStatus: 0,
    businessStatus: 'PENDING',
    requestSummary: '',
    fields: {},
    uiCompared: false,
    error: '',
    ...extra
  })
}

mkdirSync(profileDir, { recursive: true })
const evidence = {
  mode: 'READ_ONLY_AUTO',
  origin,
  executedAt: new Date().toISOString(),
  session: 'PENDING',
  writesObserved: [],
  checks: [],
  testWrite: {
    mode: 'TEST_WRITE_STEP',
    execute: false,
    customer: '未从原站响应确认',
    file: '未从原站响应确认',
    mailType: '未从原站响应确认',
    guids: { customer: '未确认', file: '未确认', mailType: '未确认', description: 'descriptionSelectability=pending' },
    plannedWrites: [...writes],
    readback: ['GetMailInfo', 'GetMailFile', 'GetMailCase', 'GetFlowInfo', 'GetFlowHistory'],
    rollback: '没有发送写请求，不需要回滚。'
  }
}

function save() {
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
}

const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chromium',
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`]
})
const observedWrites = []
const httpByCall = []
context.on('request', request => {
  const url = request.url()
  if (!url.startsWith(origin)) return
  const params = new URLSearchParams(request.postData() || '')
  const call = params.get('Call')
  if (call && writes.has(call)) observedWrites.push(call)
})
context.on('response', response => {
  const url = response.url()
  if (!url.startsWith(origin) || !url.includes('/AjaxServers/')) return
  const call = new URLSearchParams(response.request().postData() || '').get('Call')
  if (!call || writes.has(call)) return
  httpByCall.push({ call, status: response.status() })
})
function httpStatusFor(call, fallback = 0) {
  const found = [...httpByCall].reverse().find(item => item.call === call)
  return found ? found.status : fallback
}
try {
  let worker = context.serviceWorkers()[0]
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 })
  const extensionId = new URL(worker.url()).host
  const easy = await context.newPage()
  await easy.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  const login = await loginWithEnv(easy)
  if (login.attempted && login.stayedOnLogin) {
    evidence.session = 'PENDING'
    evidence.checks.push(row('GetUserModel', { error: `登录表单已提交，页面仍停在登录页。${login.notice}` }))
    for (const call of ['GetSearchFiles', 'IPGetBasicData', 'LoadFileTypeByCaseType', 'LoadMailType', 'GetMailInfo', 'GetMailFile', 'GetMailCase', 'GetFlowInfo', 'GetFlowHistory']) {
      evidence.checks.push(row(call, { error: '登录未完成，未发送只读请求。' }))
    }
    save()
    console.log('live readonly: login form stayed on Login.aspx')
    process.exitCode = 2
    throw new Error('PENDING_LOGIN')
  }
  const app = await context.newPage()
  await app.goto(`chrome-extension://${extensionId}/app.html`, { waitUntil: 'domcontentloaded' })
  console.log(login.attempted ? '已提交登录表单，正在等待会话。' : '未提供登录环境变量，等待页面会话。')
  const deadline = Date.now() + 240000
  let connection = null
  while (Date.now() < deadline) {
    connection = await app.evaluate(async () => {
      const listed = await chrome.runtime.sendMessage({ type: 'WORKSPACE', payload: { action: 'listTabs' } })
      const tab = listed.payload.tabs && listed.payload.tabs[0]
      if (!tab) return { status: 'no-tab' }
      const bound = await chrome.runtime.sendMessage({ type: 'WORKSPACE', payload: { action: 'bind', tabId: tab.id } })
      return {
        status: bound.payload.connection && bound.payload.connection.sessionStatus,
        name: bound.payload.connection && bound.payload.connection.displayName,
        operatorId: bound.payload.connection && bound.payload.connection.operatorId
      }
    })
    if (connection.status === 'authenticated') break
    await app.waitForTimeout(3000)
  }
  if (!connection || connection.status !== 'authenticated') {
    evidence.session = 'PENDING'
    evidence.checks.push(row('GetUserModel', { error: '隔离配置里还没有完成 EASY 登录。没有把 Fixture 或 HAR 记成通过。' }))
    for (const call of ['GetSearchFiles', 'IPGetBasicData', 'LoadFileTypeByCaseType', 'LoadMailType', 'GetMailInfo', 'GetMailFile', 'GetMailCase', 'GetFlowInfo', 'GetFlowHistory']) {
      evidence.checks.push(row(call, { error: '登录未完成，未发送请求。' }))
    }
    save()
    console.log('live readonly: PENDING login')
    process.exitCode = 2
    throw new Error('PENDING_LOGIN')
  }
  evidence.session = 'AUTHENTICATED'
  const accept = async (call, context = {}) => app.evaluate(async ({ call, context }) => {
    const loaded = await chrome.runtime.sendMessage({ type: 'WORKSPACE', payload: { action: 'load' } })
    const connection = loaded.payload.connection
    return chrome.runtime.sendMessage({
      type: 'WORKSPACE',
      payload: {
        action: 'runAcceptance',
        call,
        caseTypeId: context.caseTypeId,
        mailId: context.mailId,
        flowType: context.flowType
      }
    }).then(response => ({
      ok: response.payload.ok,
      message: response.payload.message,
      operatorId: connection.operatorId,
      record: response.payload.forwarded && response.payload.forwarded.payload && response.payload.forwarded.payload.records
        ? response.payload.forwarded.payload.records[0]
        : null,
      probe: response.payload.forwarded && response.payload.forwarded.payload ? response.payload.forwarded.payload.probe : null
    }))
  }, { call, context })
  const statusOf = (result) => {
    const fields = result.probe && result.probe.fields ? result.probe.fields : {}
    if (fields.loginPage === 'true' || fields.clientLogin === 'false' || fields.clientStatus === 'false') return 'FAIL'
    if (result.record && result.record.result === 'PASS') return 'PASS'
    if (fields.clientStatus === 'true' || fields.clientLogin === 'true') return 'RESPONSE_OBSERVED'
    return result.record ? result.record.result : 'FAIL'
  }
  const user = await accept('GetUserModel')
  const userFields = user.probe && user.probe.fields ? user.probe.fields : {}
  const visibleName = userFields.displayName ? await easy.getByText(userFields.displayName, { exact: false }).count().catch(() => 0) : 0
  evidence.checks.push(row('GetUserModel', {
    httpStatus: httpStatusFor('GetUserModel', user.probe ? user.probe.httpStatus : 0),
    businessStatus: statusOf(user),
    requestSummary: 'Call,log_pagename',
    fields: userFields,
    uiCompared: visibleName > 0,
    error: user.record ? user.record.reason : user.message
  }))
  const basic = await accept('IPGetBasicData')
  const basicFields = basic.probe && basic.probe.fields ? basic.probe.fields : {}
  const caseLabelVisible = basicFields.caseTypeLabel ? await easy.getByText(basicFields.caseTypeLabel, { exact: false }).count().catch(() => 0) : 0
  evidence.checks.push(row('IPGetBasicData', {
    httpStatus: httpStatusFor('IPGetBasicData', basic.probe ? basic.probe.httpStatus : 0),
    businessStatus: statusOf(basic),
    requestSummary: 'Call,log_pagename',
    fields: basicFields,
    uiCompared: caseLabelVisible > 0,
    error: basic.record ? basic.record.reason : basic.message
  }))
  if (basicFields.caseTypeId) {
    const tree = await accept('LoadFileTypeByCaseType', { caseTypeId: basicFields.caseTypeId })
    evidence.checks.push(row('LoadFileTypeByCaseType', {
      httpStatus: httpStatusFor('LoadFileTypeByCaseType', tree.probe ? tree.probe.httpStatus : 0),
      businessStatus: statusOf(tree),
      requestSummary: 'Call,official,case_type,file_type,log_pagename',
      fields: tree.probe && tree.probe.fields ? tree.probe.fields : {},
      uiCompared: false,
      error: '案件类型 ID 来自 IPGetBasicData 的既有适配。节点是否可作发文参数仍是 pending。' + (tree.record ? tree.record.reason : '')
    }))
  } else {
    evidence.checks.push(row('LoadFileTypeByCaseType', { error: 'IPGetBasicData 没有给出可解析的案件类型 ID，未猜测 GUID。' }))
  }
  const mailTypes = await accept('LoadMailType')
  const mailFields = mailTypes.probe && mailTypes.probe.fields ? mailTypes.probe.fields : {}
  evidence.checks.push(row('LoadMailType', {
    httpStatus: httpStatusFor('LoadMailType', mailTypes.probe ? mailTypes.probe.httpStatus : 0),
    businessStatus: statusOf(mailTypes),
    requestSummary: 'Call,log_pagename',
    fields: mailFields,
    uiCompared: false,
    error: mailTypes.record ? mailTypes.record.reason : mailTypes.message
  }))
  const caseVolume = process.env.PATMAIL_LIVE_CASE_VOLUME || ''
  if (!caseVolume) {
    evidence.checks.push(row('GetSearchFiles', { error: '没有从原站确认的查询条件。未使用离线 HAR，也未猜测查询 GUID。' }))
  } else {
    const searched = await app.evaluate(async (caseVolume) => {
      const loaded = await chrome.runtime.sendMessage({ type: 'WORKSPACE', payload: { action: 'load' } })
      const response = await chrome.runtime.sendMessage({
        type: 'WORKSPACE',
        payload: { action: 'forward', message: { type: 'SEARCH_FILES', payload: { query: { caseVolume, pageIndex: 1, pageSize: 20 } } } }
      })
      const data = response.payload.forwarded && response.payload.forwarded.payload && response.payload.forwarded.payload.data
      const first = data && Array.isArray(data.items) ? data.items[0] : null
      return {
        ok: response.payload.ok,
        message: response.payload.message,
        total: data ? data.total : 0,
        fileId: first ? first.fileId : '',
        fileName: first ? first.fileName : '',
        fileDescription: first ? first.fileDescription : '',
        customerName: first ? first.customerName : ''
      }
    }, caseVolume)
    const nameVisible = searched.fileName ? await easy.getByText(searched.fileName, { exact: false }).count().catch(() => 0) : 0
    evidence.checks.push(row('GetSearchFiles', {
      httpStatus: httpStatusFor('GetSearchFiles', 0),
      businessStatus: searched.ok ? 'RESPONSE_OBSERVED' : 'FAIL',
      requestSummary: 'existing buildGetSearchFilesParams; case_volume from PATMAIL_LIVE_CASE_VOLUME',
      fields: { total: String(searched.total || 0), fileId: searched.fileId || '', fileName: searched.fileName || '', fileDescription: searched.fileDescription || '', customerName: searched.customerName || '' },
      uiCompared: nameVisible > 0,
      error: searched.message || ''
    }))
    if (searched.fileId) evidence.testWrite.guids.file = searched.fileId
    evidence.testWrite.file = searched.fileId ? '响应中出现文件 ID，未发起写请求。' : evidence.testWrite.file
  }
  const mailId = process.env.PATMAIL_LIVE_MAIL_ID || ''
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!guid.test(mailId)) {
    for (const call of ['GetMailInfo', 'GetMailFile', 'GetMailCase', 'GetFlowInfo', 'GetFlowHistory']) {
      evidence.checks.push(row(call, { error: '没有已确认的测试邮件 ID。未猜测 mail_id。' }))
    }
  } else {
    for (const call of ['GetMailInfo', 'GetMailFile', 'GetMailCase']) {
      const result = await accept(call, { mailId })
      evidence.checks.push(row(call, {
        httpStatus: result.probe ? result.probe.httpStatus : 0,
        businessStatus: result.record ? result.record.result : 'FAIL',
        requestSummary: 'existing readonly builder',
        fields: result.probe && result.probe.fields ? result.probe.fields : {},
        uiCompared: false,
        error: result.record ? result.record.reason : result.message
      }))
    }
    for (const call of ['GetFlowInfo', 'GetFlowHistory']) {
      const result = await accept(call, { mailId, flowType: 'CO' })
      evidence.checks.push(row(call, {
        httpStatus: result.probe ? result.probe.httpStatus : 0,
        businessStatus: result.record ? result.record.result : 'FAIL',
        requestSummary: 'existing readonly builder; flowType=CO from existing contract',
        fields: result.probe && result.probe.fields ? result.probe.fields : {},
        uiCompared: false,
        error: result.record ? result.record.reason : result.message
      }))
    }
  }
  if (mailFields.mailTypeId) evidence.testWrite.guids.mailType = mailFields.mailTypeId
  evidence.testWrite.mailType = mailFields.mailTypeId ? '响应中出现发文类型 ID。可选性仍是 pending。' : evidence.testWrite.mailType
  evidence.writesObserved = observedWrites
  evidence.operatorId = connection.operatorId || ''
  save()
  console.log(`live readonly evidence: ${evidence.checks.length} checks, writes ${observedWrites.length}`)
  if (observedWrites.length > 0) process.exitCode = 1
} catch (error) {
  if (error instanceof Error && error.message === 'PENDING_LOGIN') {
    process.exitCode = 2
  } else {
    evidence.session = 'ERROR'
    evidence.checks.push(row('session', { error: error instanceof Error ? error.message : 'live readonly failed' }))
    evidence.writesObserved = observedWrites
    save()
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
} finally {
  await context.close()
}
