import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const origin = 'http://183.36.43.66:88'
const profileDir = join(root, 'test-results', 'live-chrome-profile-v2')
const evidencePath = join(root, 'test-results', 'live-api-write.json')
const fileId = '5AB0E950-7056-44C0-9A6C-7037E541BE7B'
const fileName = 'PA2622582CND-YS-实用新型专利证书.pdf'

function redact(value) {
  const password = process.env.PATMAIL_LIVE_PASSWORD || ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]').split(password || '\0').join('[redacted]')
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
let evidence = { mode: 'API_CALLS', calls: [] }
try {
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await login(page)
  evidence = await page.evaluate(async ({ fileId, fileName }) => {
    const report = { mode: 'API_CALLS', calls: [], mailId: '', cancelled: false, reviewer: null }
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    async function post(path, fields) {
      let last = null
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const started = new Date().toISOString()
        const response = await fetch(location.origin + path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: new URLSearchParams(fields)
        })
        const text = await response.text()
        let data = null
        try { data = JSON.parse(text) } catch { data = null }
        const client = data && data.ClientInfo ? data.ClientInfo : {}
        last = { http: response.status, data, text: text.slice(0, 180) }
        report.calls.push({
          call: fields.Call,
          path,
          http: response.status,
          status: client.Status,
          result: client.Result,
          login: client.IsLogin,
          message: typeof client.Message === 'string' ? client.Message.slice(0, 160) : '',
          attempt,
          at: started
        })
        const reads = new Set(['GetUserModel', 'LoadMailType', 'GetFlowInfo', 'GetFlowSubmit', 'GetFlowLastStatus', 'GetUrgencyList', 'GetFlowHistory', 'GetFlowReject', 'GetMailInfo'])
        if (!reads.has(fields.Call) || (response.status !== 502 && response.status !== 503)) return last
        if (attempt < 4) await sleep(700 * attempt)
      }
      return last
    }
    function outline(data) {
      if (!data || typeof data !== 'object') return { type: typeof data }
      const out = {}
      for (const key of Object.keys(data)) {
        const value = data[key]
        if (Array.isArray(value)) out[key] = { n: value.length, keys: value[0] && typeof value[0] === 'object' ? Object.keys(value[0]).slice(0, 14) : [] }
        else if (value && typeof value === 'object') out[key] = Object.keys(value).slice(0, 14)
        else out[key] = typeof value
      }
      return out
    }
    function asRows(value) {
      if (Array.isArray(value)) return value
      if (!value || typeof value !== 'object') return []
      if (value.node_id || value.node_code || value.history_id || value.audit_user_id) return [value]
      for (const key of ['Table', 'Rows', 'row', 'data']) {
        if (Array.isArray(value[key])) return value[key]
      }
      return Object.values(value).filter(item => item && typeof item === 'object' && (item.node_id || item.node_code || item.history_id || item.audit_user_id))
    }
    function usersOf(node) {
      if (Array.isArray(node.user_list)) {
        return node.user_list.map(item => ({ id: String(item.user_id || ''), name: String(item.cn_name || item.user_name || '') }))
      }
      const ids = String(node.user_list_id || '').split(/[;,]/).filter(Boolean)
      const names = String(node.user_list_name || '').split(/[;,]/)
      return ids.map((id, index) => ({ id, name: names[index] || '' }))
    }
    const user = await post('/AjaxServers/Login.ashx', { Call: 'GetUserModel', log_pagename: '' })
    const model = user.data && user.data.UserModel ? user.data.UserModel : {}
    const selfId = String(model.user_id || '')
    report.self = { id: selfId, name: String(model.Name || model.user_name || '') }
    const types = await post('/AjaxServers/Common.ashx', { Call: 'LoadMailType', log_pagename: 'FileSearchMail.aspx' })
    const rows = types.data && Array.isArray(types.data.MailType) ? types.data.MailType : []
    const chosen = rows.find(row => typeof row.name === 'string' && /审核|审批/.test(row.name) && !/不需要/.test(row.name) && row.id)
      || rows.find(row => typeof row.name === 'string' && !/不需要审批/.test(row.name) && row.id)
    if (!chosen) throw new Error('LoadMailType 没有可提交审核的发文类型')
    report.mailType = { id: chosen.id, name: chosen.name }
    let created
    try {
    created = await post('/AjaxServers/Notice.ashx', {
      Call: 'MailCustomer',
      _file_ids: fileId,
      _file_names: fileName,
      mailstyle: '1',
      mailtype: chosen.id,
      log_pagename: 'FileSearchMail.aspx'
    })
    const mailId = created.data && (created.data.objid || created.data.obj_id || created.data.mail_id)
    report.mailId = typeof mailId === 'string' ? mailId : ''
    if (!report.mailId) throw new Error('MailCustomer 没有返回 objid')
    const info = await post('/AjaxServers/Common.ashx', {
      Call: 'GetFlowInfo', obj_id: report.mailId, flow_type: 'CO', flow_sub_type: '', log_pagename: 'mail.aspx'
    })
    const flow = info.data && info.data.Result && !Array.isArray(info.data.Result) ? info.data.Result : null
    report.flow = flow ? {
      status: flow.status, enabled: flow.is_enabled, node: flow.node_code, nodeName: flow.node_name_zh_cn
    } : { missing: true }
    if (!flow || flow.is_enabled === false) throw new Error('这个发文类型没有可提交的审核流程')
    const nodesResponse = await post('/AjaxServers/Common.ashx', {
      Call: 'GetFlowSubmit',
      obj_id: flow.obj_id,
      flow_id: flow.flow_id,
      flow_type: flow.flow_type,
      flow_sub_type: flow.flow_sub_type || '',
      dept_id: flow.dept_id || '',
      dept_full_name: flow.dept_full_name || '',
      status: String(flow.status),
      cur_node_id: flow.cur_node_id || '',
      cur_user_id: flow.cur_user_id || '',
      node_code: flow.node_code || '',
      cn_name: flow.cn_name || '',
      is_skip: String(flow.is_skip),
      is_enabled: String(flow.is_enabled),
      urgency_id: flow.urgency_id || '',
      update_time: flow.update_time || '',
      update_time_dd: flow.update_time_dd || '',
      update_time_mm: flow.update_time_mm || '',
      update_time_ss: flow.update_time_ss || '',
      log_pagename: 'IhgFlow.aspx'
    })
    const nodes = nodesResponse.data && Array.isArray(nodesResponse.data.Result) ? nodesResponse.data.Result : []
    report.nodes = nodes.map(node => ({ code: node.node_code, name: node.node_name_zh_cn, users: usersOf(node).map(item => item.name) }))
    const next = nodes.find(node => node.node_code !== 'END' && usersOf(node).some(item => item.id.toLowerCase() === selfId.toLowerCase()))
    if (!next) throw new Error('下一节点里没有当前登录人，未提交')
    const reviewer = usersOf(next).find(item => item.id.toLowerCase() === selfId.toLowerCase())
    report.reviewer = reviewer
    await post('/AjaxServers/Common.ashx', { Call: 'GetFlowLastStatus', obj_id: report.mailId, flow_type: 'CO' })
    const urgency = await post('/AjaxServers/Common.ashx', { Call: 'GetUrgencyList', log_pagename: 'IhgFlow.aspx' })
    const urgencyId = urgency.data && Array.isArray(urgency.data.UrgencyList) && urgency.data.UrgencyList[0] ? urgency.data.UrgencyList[0].urgency_id : ''
    const submitted = await post('/AjaxServers/Mail.ashx', {
      Call: 'MailSubmit',
      f_audit_type_id: 'submit',
      f_obj_id: report.mailId,
      f_cur_status: String(flow.status),
      f_status: next.node_code === 'FIRST' ? '0' : '1000',
      f_allow_edit: next.allow_edit ? '1' : '0',
      f_flow_id: flow.flow_id,
      f_flow_type: flow.flow_type || 'CO',
      f_flow_sub_type: flow.flow_sub_type || '',
      f_cur_node_id: flow.cur_node_id || '',
      f_cur_node_code: flow.node_code || '',
      f_cur_node: flow.node_name_zh_cn || '',
      f_next_node_id: next.node_id,
      f_next_node_code: next.node_code,
      f_next_user_id: reviewer.id,
      f_next_user_name: reviewer.name,
      f_list_id: next.list_id || '',
      f_remark: '接口测试，随即取消',
      f_is_parallel: String(next.is_parallel ?? 0),
      f_urgency_id: urgencyId || flow.urgency_id || '',
      f_score: '',
      finishdate: '',
      pic_user: '',
      int_due_date: '',
      cus_due_date: '',
      leg_due_date: '',
      log_pagename: 'IhgFlow.aspx'
    })
    report.submitted = submitted.data && submitted.data.ClientInfo ? submitted.data.ClientInfo.Result === true : false
    if (!report.submitted) throw new Error('MailSubmit 未成功')
    let meta = {}
    let historyData = {}
    let now = null
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const rejectMeta = await post('/AjaxServers/Common.ashx', { Call: 'GetFlowReject', obj_id: report.mailId, flow_type: 'CO', log_pagename: 'mail.aspx' })
      meta = rejectMeta.data || {}
      const history = await post('/AjaxServers/Common.ashx', { Call: 'GetFlowHistory', obj_id: report.mailId, log_pagename: 'mail.aspx' })
      historyData = history.data || {}
      const current = await post('/AjaxServers/Common.ashx', {
        Call: 'GetFlowInfo', obj_id: report.mailId, flow_type: 'CO', flow_sub_type: '', log_pagename: 'mail.aspx'
      })
      now = current.data && current.data.Result && !Array.isArray(current.data.Result) ? current.data.Result : null
      const historyRows = asRows(meta.flow_history).concat(asRows(historyData.Result), asRows(historyData.flow_history))
      const nodeRows = [].concat(Array.isArray(meta.Result) ? meta.Result : [], nodes)
      if (nodeRows.some(item => item.node_code === 'FIRST') && (meta.flow_config || now) && historyRows.length) break
      if (attempt < 5) await sleep(900)
    }
    const config = meta.flow_config || now
    const historyRows = asRows(meta.flow_history).concat(asRows(historyData.Result), asRows(historyData.flow_history))
    const nodeRows = [].concat(Array.isArray(meta.Result) ? meta.Result : [], nodes)
    const firstNode = nodeRows.find(item => item.node_code === 'FIRST')
    const firstHistory = historyRows.find(row => row.node_code === 'FIRST' || (firstNode && String(row.node_id || '').toLowerCase() === String(firstNode.node_id || '').toLowerCase()))
    const start = firstNode && firstNode.node_id ? {
      node_id: firstNode.node_id,
      node_code: 'FIRST',
      allow_edit: firstNode.allow_edit,
      h_user_id: (firstHistory && (firstHistory.audit_user_id || firstHistory.h_user_id)) || selfId,
      h_user_name: (firstHistory && (firstHistory.audit_cn_name || firstHistory.h_user_name || firstHistory.cn_name)) || report.self.name
    } : null
    report.rejectShape = {
      historyNodes: historyRows.slice(0, 6).map(row => ({
        code: row.node_code || '',
        name: row.node_name_zh_cn || row.node_name || '',
        hasUser: Boolean(row.audit_user_id || row.h_user_id)
      })),
      cur: config ? { code: config.node_code || '', name: config.node_name_zh_cn || '', status: config.status } : null,
      target: start ? 'FIRST' : ''
    }
    if (!config || !start) throw new Error('没有可退回的启动节点')
    const last = await post('/AjaxServers/Common.ashx', { Call: 'GetFlowLastStatus', obj_id: report.mailId, flow_type: 'CO' })
    const lastStatus = last.data && last.data.last_status ? last.data.last_status : null
    if (lastStatus && config.last_update_time_ss && String(lastStatus.update_time_ss) !== String(config.last_update_time_ss)) {
      throw new Error('流程版本已变化，退回前需要重读')
    }
    const rejected = await post('/AjaxServers/Common.ashx', {
      Call: 'FlowSubmit',
      f_audit_type_id: 'reject',
      f_obj_id: report.mailId,
      f_status: start.node_code === 'FIRST' ? '0' : '1000',
      f_allow_edit: start.allow_edit ? '1' : '0',
      f_flow_id: config.flow_id,
      f_flow_type: config.flow_type || 'CO',
      f_flow_sub_type: (lastStatus && lastStatus.flow_sub_type) || config.flow_sub_type || '',
      f_cur_node_id: config.cur_node_id || '',
      f_cur_node_code: config.node_code || '',
      f_next_node_id: start.node_id,
      f_next_node_code: start.node_code,
      f_next_user_id: start.h_user_id,
      f_next_user_name: start.h_user_name || '',
      f_remark: '接口测试退回后删除',
      f_urgency_id: config.urgency_id || urgencyId || '',
      f_score: '',
      log_pagename: 'IhgFlow.aspx'
    })
    report.rejected = Boolean(rejected.data && rejected.data.ClientInfo && rejected.data.ClientInfo.Result === true)
    if (!report.rejected) {
      const message = rejected.data && rejected.data.ClientInfo && rejected.data.ClientInfo.Message || rejected.text || ''
      throw new Error('退回启动节点未成功：' + String(message).slice(0, 160))
    }
    let wait = null
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const check = await post('/AjaxServers/Common.ashx', {
        Call: 'GetFlowInfo', obj_id: report.mailId, flow_type: 'CO', flow_sub_type: '', log_pagename: 'mail.aspx'
      })
      const back = check.data && check.data.Result && !Array.isArray(check.data.Result) ? check.data.Result : null
      report.flowAfterReject = back ? { status: back.status, node: back.node_code, nodeName: back.node_name_zh_cn } : { missing: true }
      const backAtStart = back && (back.node_code === 'FIRST' || back.node_name_zh_cn === '启动流程')
      if (!backAtStart) {
        if (attempt < 4) await sleep(800)
        continue
      }
      wait = await post('/AjaxServers/Mail.ashx', { Call: 'DelMailWait', mail_id: report.mailId, log_pagename: 'mail.aspx' })
      if (wait.data && wait.data.ClientInfo && wait.data.ClientInfo.Result === true) break
      if (attempt < 4) await sleep(800)
    }
    if (!wait || !wait.data || !wait.data.ClientInfo || wait.data.ClientInfo.Result !== true) {
      const where = report.flowAfterReject && report.flowAfterReject.nodeName || ''
      const message = wait && wait.data && wait.data.ClientInfo && wait.data.ClientInfo.Message || ''
      throw new Error(where && where !== '启动流程' ? '退回后仍在' + where : 'DelMailWait 未成功：' + String(message).slice(0, 160))
    }
    const draft = await post('/AjaxServers/Mail.ashx', { Call: 'DelMaildraft', mail_id: report.mailId, log_pagename: 'mail.aspx' })
    if (!draft.data || !draft.data.ClientInfo || draft.data.ClientInfo.Result !== true) throw new Error('DelMaildraft 未成功')
    const readback = await post('/AjaxServers/Mail.ashx', { Call: 'GetMailInfo', mail_id: report.mailId, log_pagename: 'mail.aspx' })
    const mailRows = readback.data && readback.data.MailInfo
    report.readback = {
      status: readback.data && readback.data.ClientInfo ? readback.data.ClientInfo.Status : null,
      result: readback.data && readback.data.ClientInfo ? readback.data.ClientInfo.Result : null,
      message: readback.data && readback.data.ClientInfo && readback.data.ClientInfo.Message || '',
      mailCount: Array.isArray(mailRows) ? mailRows.length : 0
    }
    report.cancelled = report.readback.mailCount === 0
    } catch (error) {
      report.error = error instanceof Error ? error.message : 'failed'
      if (report.mailId) {
        const wait = await post('/AjaxServers/Mail.ashx', { Call: 'DelMailWait', mail_id: report.mailId, log_pagename: 'mail.aspx' }).catch(() => null)
        const draft = await post('/AjaxServers/Mail.ashx', { Call: 'DelMaildraft', mail_id: report.mailId, log_pagename: 'mail.aspx' }).catch(() => null)
        report.cleanup = {
          wait: Boolean(wait && wait.data && wait.data.ClientInfo && wait.data.ClientInfo.Result === true),
          draft: Boolean(draft && draft.data && draft.data.ClientInfo && draft.data.ClientInfo.Result === true)
        }
      }
    }
    return report
  }, { fileId, fileName })
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
  if (evidence.error || !evidence.cancelled) process.exitCode = 1
  console.log(redact(JSON.stringify({
    mailId: evidence.mailId,
    submitted: evidence.submitted,
    rejected: evidence.rejected,
    cancelled: evidence.cancelled,
    error: evidence.error || '',
    flowAfterReject: evidence.flowAfterReject || null,
    readback: evidence.readback || null
  })))
} catch (error) {
  evidence.error = error instanceof Error ? error.message : 'failed'
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
  console.error(redact(evidence.error))
  process.exitCode = 1
} finally {
  await Promise.race([context.close(), new Promise(resolve => setTimeout(resolve, 8000))])
}
