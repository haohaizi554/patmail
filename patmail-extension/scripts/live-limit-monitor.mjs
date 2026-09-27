import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const origin = 'http://183.36.43.66:88'
const profileDir = join(root, 'test-results', 'live-chrome-profile-v2')
const evidencePath = join(root, 'test-results', 'live-limit-monitor.json')
const caseVolume = process.env.PATMAIL_LIMIT_VOLUME || 'PA2622582CND-YS'

function redact(value) {
  const password = process.env.PATMAIL_LIVE_PASSWORD || ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]').split(password || '\0').join('[redacted]')
}

const source = readFileSync(new URL('../src/api/limit-monitor-params.ts', import.meta.url), 'utf8')
const fields = [...source.match(/export const LIMIT_MONITOR_FIELDS = \[([\s\S]*?)\] as const/)[1].matchAll(/'([^']+)'/g)].map(item => item[1])
const colsel = source.match(/export const LIMIT_MONITOR_COLSEL = '([^']*)'/)[1]
const caseType = readFileSync(new URL('../src/api/config.ts', import.meta.url), 'utf8').match(/caseTypeId: '([^']+)'/)[1]

function entries(type) {
  const values = Object.fromEntries(fields.map(field => [field, '']))
  Object.assign(values, {
    pageIndex: '1',
    pageSize: '10',
    select_and: 'false',
    Call: 'GetLimitMonitorCaseList',
    is_first: 'false',
    case_type: caseType,
    case_volume: caseVolume,
    is_fuzzy_query_case_volume_other: 'false',
    is_fuzzy_query_app_no_other: 'false',
    is_point_app_no_other: 'false',
    type,
    colsel,
    _t: String(Date.now()),
    log_pagename: 'LimitMonitor.aspx'
  })
  return fields.map(field => [field, values[field] ?? ''])
}

async function login(page) {
  if (!/Login\.aspx/i.test(page.url())) return
  const user = process.env.PATMAIL_LIVE_USER || ''
  const password = process.env.PATMAIL_LIVE_PASSWORD || ''
  const remember = page.locator('#chk_password')
  if (await remember.count() && await remember.isChecked()) await remember.uncheck()
  await page.locator('#txtUser').fill(user)
  await page.locator('#txtPwd').fill(password)
  await page.locator('#btnLogin').click({ force: true })
  await page.waitForURL(url => !/Login\.aspx/i.test(url.pathname), { timeout: 25000 })
}

const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1200, height: 800 }
})
const page = context.pages()[0] || await context.newPage()
const evidence = { mode: 'LIMIT_MONITOR_READONLY', caseVolume, tabs: [] }
try {
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await login(page)
  if (/Login\.aspx/i.test(page.url())) throw new Error('仍在登录页')
  evidence.tabs = await page.evaluate(async (packs) => {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    const out = []
    for (const pack of packs) {
      let last = null
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const response = await fetch(location.origin + '/AjaxServers/Report.ashx', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: new URLSearchParams(pack.entries)
        })
        const text = await response.text()
        let data = null
        try { data = JSON.parse(text) } catch { data = null }
        const client = data && data.ClientInfo ? data.ClientInfo : {}
        const rows = data && Array.isArray(data.TableRows) ? data.TableRows : null
        const first = rows && rows[0] ? rows[0] : null
        last = {
          type: pack.type,
          http: response.status,
          status: client.Status,
          result: client.Result,
          login: client.IsLogin,
          message: typeof client.Message === 'string' ? client.Message.slice(0, 160) : '',
          count: data ? data.TableRowsCount ?? null : null,
          rowCount: rows ? rows.length : null,
          first: first ? {
            caseVolume: first.case_volume || '',
            ctrlProc: first.ctrl_proc || '',
            hasProcId: typeof first.proc_id === 'string' && first.proc_id.length > 0,
            legalDueDate: first.legal_due_date || '',
            cusDueDate: first.cus_due_date || '',
            intDueDate: first.int_due_date || ''
          } : null,
          attempt
        }
        if (response.status !== 502 && response.status !== 503) break
        if (attempt < 4) await sleep(700 * attempt)
      }
      out.push(last)
    }
    return out
  }, [
    { type: 'all', entries: entries('all') },
    { type: 'pay', entries: entries('pay') }
  ])
  const all = evidence.tabs.find(item => item.type === 'all')
  if (!all || all.http !== 200 || all.login !== true || all.status !== true || typeof all.rowCount !== 'number') {
    process.exitCode = 1
  }
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
  console.log(redact(JSON.stringify(evidence.tabs)))
} catch (error) {
  evidence.error = error instanceof Error ? error.message : 'failed'
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
  console.error(redact(evidence.error))
  process.exitCode = 1
} finally {
  await Promise.race([context.close(), new Promise(resolve => setTimeout(resolve, 8000))])
}
