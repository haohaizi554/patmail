import { apiError, type ApiResult } from '../api/types'
import { isRecord, readClientInfo } from '../api/response-guards'
import type { EasyTransport } from '../api/transport'
import { isQueryGuid } from '../query/query-validator'

/** 文件查询里选中的下载名称。不进 GetSearchFiles，发文前交给 GetFileName。 */
export interface FileDownloadSelection {
  templateId?: string
  column?: string
  fixedText?: string
  /** 选中时从模板行抄下的配方。发文时优先用账号上的最新模板。 */
  newFilename?: string
  fileNameType?: string
  label?: string
}

export interface DownloadNameRecipe {
  newFilename: string
  fileNameType: string
}

const COLUMN = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/
const NAME_BATCH = 20

function segments(value: string): string[] {
  return value.split(';')
}

export function downloadRecipe(newFilename: string, fileNameType: string): DownloadNameRecipe | null {
  const names = segments(newFilename.trim())
  const types = segments(fileNameType.trim())
  if (!names.length || names.length !== types.length || names.length > 31) return null
  if (names.some(name => !name || name.length > 80)) return null
  for (let index = 0; index < types.length; index += 1) {
    const kind = types[index]
    const name = names[index]
    if (kind === 'colname' && !COLUMN.test(name)) return null
    if (kind !== 'colname' && kind !== 'txt') return null
  }
  return { newFilename: names.join(';'), fileNameType: types.join(';') }
}

export function selectionFromControls(input: {
  templateId?: string
  column?: string
  fixedText?: string
  label?: string
  template?: { newFilename: string; fileNameType: string } | null
}): FileDownloadSelection | null {
  const templateId = input.templateId?.trim() ?? ''
  const column = input.column?.trim() ?? ''
  const fixedText = input.fixedText?.trim() ?? ''
  const label = input.label?.trim().slice(0, 80) ?? ''
  if (isQueryGuid(templateId)) {
    const recipe = input.template ? downloadRecipe(input.template.newFilename, input.template.fileNameType) : null
    return {
      templateId,
      ...(recipe ?? {}),
      ...(label ? { label } : {})
    }
  }
  if (!column) return null
  if (column === 'fixtxt') {
    if (!fixedText || fixedText.includes(';') || fixedText.length > 80) return null
    return { column: 'fixtxt', fixedText, newFilename: fixedText, fileNameType: 'txt', ...(label ? { label } : {}) }
  }
  if (!COLUMN.test(column)) return null
  return { column, newFilename: column, fileNameType: 'colname', ...(label ? { label } : {}) }
}

export function isFileDownloadSelection(value: unknown): value is FileDownloadSelection {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.some(key => !['templateId', 'column', 'fixedText', 'newFilename', 'fileNameType', 'label'].includes(key))) return false
  const templateId = value.templateId
  const column = value.column
  const fixedText = value.fixedText
  const label = value.label
  if (templateId !== undefined && (typeof templateId !== 'string' || !isQueryGuid(templateId))) return false
  if (column !== undefined && (typeof column !== 'string' || (column !== 'fixtxt' && !COLUMN.test(column)))) return false
  if (fixedText !== undefined && (typeof fixedText !== 'string' || !fixedText || fixedText.length > 80 || fixedText.includes(';'))) return false
  if (label !== undefined && (typeof label !== 'string' || !label.trim() || label.length > 80)) return false
  const named = value.newFilename
  const typed = value.fileNameType
  if ((named === undefined) !== (typed === undefined)) return false
  if (named !== undefined || typed !== undefined) {
    if (typeof named !== 'string' || typeof typed !== 'string' || !downloadRecipe(named, typed)) return false
  }
  if (!templateId && named === undefined && !column) return false
  if (column === 'fixtxt' && !fixedText && named === undefined) return false
  return true
}

export function downloadNameText(selection: FileDownloadSelection | null | undefined): string {
  const label = selection?.label?.trim()
  if (label) return label
  if (selection?.column === 'fixtxt') return selection.fixedText || '固定字符'
  if (selection?.column) return selection.column
  if (selection?.templateId) return '已选下载名称模板'
  return ''
}

export function recipeFromTempList(data: unknown, templateId: string): DownloadNameRecipe | null {
  if (!isRecord(data) || !Array.isArray(data.TempNameList)) return null
  for (const row of data.TempNameList) {
    if (!isRecord(row) || typeof row.id !== 'string' || row.id.toLowerCase() !== templateId.toLowerCase()) continue
    const filename = typeof row.new_filename === 'string' ? row.new_filename : ''
    const kind = typeof row.file_name_type === 'string' ? row.file_name_type : ''
    return downloadRecipe(filename, kind)
  }
  return null
}

function snapshotRecipe(selection: FileDownloadSelection): DownloadNameRecipe | null {
  if (!selection.newFilename || !selection.fileNameType) return null
  return downloadRecipe(selection.newFilename, selection.fileNameType)
}

export function buildGetFileNameParams(fileIds: string[], recipe: DownloadNameRecipe): URLSearchParams | null {
  if (!fileIds.length || fileIds.length > NAME_BATCH || fileIds.some(id => !isQueryGuid(id))) return null
  const params = new URLSearchParams()
  params.set('Call', 'GetFileName')
  params.set('file_ids', fileIds.join(';'))
  params.set('new_filename', recipe.newFilename)
  params.set('file_name_type', recipe.fileNameType)
  params.set('childpath', '')
  params.set('zip_name', '')
  params.set('zip_file_name_type', '')
  params.set('log_pagename', 'FileSearch.aspx')
  return params
}

/** 生成名与传入的文件 ID 一一对应。空段或超长名整批作废。 */
export function readGeneratedFileNames(data: unknown, count: number): string[] | null {
  if (!isRecord(data) || count < 1) return null
  const info = readClientInfo(data.ClientInfo)
  if (!info.ok || info.data.Status !== true || typeof data.file_names !== 'string') return null
  const names = data.file_names.split(';').map(name => name.trim())
  if (names.length !== count || names.some(name => !name || name.length > 180)) return null
  return names
}

async function recipeFor(transport: EasyTransport, selection: FileDownloadSelection): Promise<ApiResult<DownloadNameRecipe>> {
  const saved = snapshotRecipe(selection)
  if (!selection.templateId) {
    return saved ? { ok: true, data: saved } : apiError('INVALID_QUERY', '下载名称没有配好，没有按这个名称发文。')
  }
  const params = new URLSearchParams()
  params.set('Call', 'GetFileTempNameList')
  params.set('log_pagename', 'FileSearch.aspx')
  const listed = await transport.post('fileTempList', params)
  if (!listed.ok) {
    if (saved && listed.error.code !== 'SESSION_EXPIRED') return { ok: true, data: saved }
    return listed
  }
  const live = recipeFromTempList(listed.data, selection.templateId)
  if (live) return { ok: true, data: live }
  if (saved) return { ok: true, data: saved }
  return apiError('BUSINESS_ERROR', '这份下载名称模板不在当前账号里，没有按原文件名发文。')
}

/** 按下载名称模板生成发文用的文件名。查询结果里的附件原名留在调用方。 */
export async function resolveDownloadFileNames(
  transport: EasyTransport,
  fileIds: string[],
  selection: FileDownloadSelection
): Promise<ApiResult<string[]>> {
  if (!fileIds.length || fileIds.length > 300 || fileIds.some(id => !isQueryGuid(id))) {
    return apiError('INVALID_QUERY', '文件编号不能用来生成下载名称。')
  }
  const recipe = await recipeFor(transport, selection)
  if (!recipe.ok) return recipe
  const names: string[] = []
  for (let index = 0; index < fileIds.length; index += NAME_BATCH) {
    const batch = fileIds.slice(index, index + NAME_BATCH)
    const params = buildGetFileNameParams(batch, recipe.data)
    if (!params) return apiError('INVALID_QUERY', '下载名称参数无效，没有发文。')
    const response = await transport.post('getFileName', params)
    if (!response.ok) return response
    const generated = readGeneratedFileNames(response.data, batch.length)
    if (!generated) return apiError('INVALID_RESPONSE', '下载名称没有生成完整的文件名，没有按原文件名发文。')
    names.push(...generated)
  }
  return { ok: true, data: names }
}
