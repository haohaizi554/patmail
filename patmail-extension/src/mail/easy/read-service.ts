import type { EasyTransport } from '../../api/transport'
import {
  applyCases, applyFiles, contactParams, initParams, listParams, readCustomerContacts, readMailInfo,
  readMailInit, readRuleSubject, readSignature, readTableRows, ruleParams, signatureParams, snapshotFromMailInfo
} from './contracts'
import type { EasyMailSnapshot } from './types'

const FILE_PAGE = 5
const CASE_PAGE = 100
const MAX_PAGES = 40

export class EasyMailReadService {
  constructor(private readonly transport: EasyTransport) {}

  async load(mailId: string, signal?: AbortSignal): Promise<{ ok: true; snapshot: EasyMailSnapshot } | { ok: false; message: string }> {
    const init = await this.transport.post('mailInfoInit', initParams(mailId), signal)
    if (!init.ok) return { ok: false, message: init.error.message }
    const opened = readMailInit(init.data)
    if (!opened.ok) return opened
    const info = await this.transport.post('getMailInfo', infoParams(mailId), signal)
    if (!info.ok) return { ok: false, message: info.error.message }
    const row = readMailInfo(info.data, mailId)
    if (!row.ok) return row
    let snapshot = snapshotFromMailInfo(row.row, mailId)
    if (snapshot.mailsetId.state !== 'known' && opened.mailsetId.state === 'known') snapshot = { ...snapshot, mailsetId: opened.mailsetId }
    snapshot = await this.readSignature(snapshot, signal)
    snapshot = await this.readRule(snapshot, signal)
    snapshot = await this.readContacts(snapshot, signal)
    const files = await this.readPages('GetMailFile', mailId, 'file_id', 'file_name', FILE_PAGE, signal)
    if (files.state === 'invalid') return { ok: false, message: files.message }
    if (files.state === 'known') snapshot = applyFiles(snapshot, files.rows)
    const cases = await this.readPages('GetMailCase', mailId, 'case_id', 'case_volume', CASE_PAGE, signal)
    if (cases.state === 'invalid') return { ok: false, message: cases.message }
    if (cases.state === 'known') snapshot = applyCases(snapshot, cases.rows)
    return { ok: true, snapshot }
  }

  private async readSignature(snapshot: EasyMailSnapshot, signal?: AbortSignal): Promise<EasyMailSnapshot> {
    if (snapshot.mailsetId.state !== 'known' || !snapshot.mailsetId.value) return snapshot
    const params = signatureParams(snapshot.mailsetId.value)
    if (!params) return snapshot
    const response = await this.transport.post('getSignature', params, signal)
    if (!response.ok) return snapshot
    return { ...snapshot, signature: readSignature(response.data) }
  }

  private async readRule(snapshot: EasyMailSnapshot, signal?: AbortSignal): Promise<EasyMailSnapshot> {
    if (snapshot.customerId.state !== 'known' || !snapshot.customerId.value) return snapshot
    if (snapshot.mailTypeId.state !== 'known' || !snapshot.mailTypeId.value) return snapshot
    if (snapshot.mailTypeName.state !== 'known' || !snapshot.mailTypeName.value) return snapshot
    const params = ruleParams({
      mailId: snapshot.mailId, customerId: snapshot.customerId.value,
      mailTypeId: snapshot.mailTypeId.value, mailTypeName: snapshot.mailTypeName.value
    })
    if (!params) return snapshot
    const response = await this.transport.post('getMailRule', params, signal)
    if (!response.ok) return snapshot
    return { ...snapshot, ruleSubject: readRuleSubject(response.data) }
  }

  private async readContacts(snapshot: EasyMailSnapshot, signal?: AbortSignal): Promise<EasyMailSnapshot> {
    if (snapshot.customerId.state !== 'known' || !snapshot.customerId.value) return snapshot
    const params = contactParams(snapshot.customerId.value, snapshot.mailId)
    if (!params) return snapshot
    const response = await this.transport.post('getCustomerContact', params, signal)
    if (!response.ok) return snapshot
    const contacts = readCustomerContacts(response.data)
    if (!contacts.ok) return snapshot
    return { ...snapshot, contacts: contacts.contacts }
  }

  private async readPages(
    call: 'GetMailFile' | 'GetMailCase', mailId: string, idKey: 'file_id' | 'case_id', nameKey: string, pageSize: number, signal?: AbortSignal
  ): Promise<{ state: 'known'; rows: Array<{ id: string; name: string }> } | { state: 'unknown' } | { state: 'invalid'; message: string }> {
    const rows: Array<{ id: string; name: string }> = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await this.transport.post(call === 'GetMailFile' ? 'getMailFile' : 'getMailCase', listParams(call, mailId, page), signal)
      if (!response.ok) return { state: 'invalid', message: response.error.message }
      const parsed = readTableRows(response.data, idKey, nameKey)
      if (parsed.state !== 'known') return parsed
      rows.push(...parsed.rows)
      const reached = parsed.total !== null && rows.length >= parsed.total
      const shortPage = parsed.rows.length < pageSize
      if (reached || shortPage) return { state: 'known', rows }
      if (parsed.total === null) return { state: 'unknown' }
    }
    return { state: 'unknown' }
  }
}

function infoParams(mailId: string): URLSearchParams {
  const params = new URLSearchParams()
  params.set('Call', 'GetMailInfo')
  params.set('mail_id', mailId)
  params.set('log_pagename', 'mail.aspx')
  return params
}
