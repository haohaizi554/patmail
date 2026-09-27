import type { NormalizedDictionary } from '../api/dictionaries'
import type { FileSearchFormField } from '../shared/message'

/** 文件查询里走基础资料接口的下拉，表单键对应字典名。 */
export const FILE_BASIC_OPTION_FIELDS: Record<string, string> = {
  case_type: 'caseType',
  apply_type: 'applyType',
  case_status: 'caseStatus',
  business_type_id: 'bussType',
  country: 'country',
  customer_country: 'country',
  customer_status_id: 'customerStatus',
  i_ctrl_proc: 'ctrlProc',
  branch_dept_id: 'caseBranchDept'
}

/** 文件查询里走流程字典的下拉。 */
export const FILE_FLOW_OPTION_FIELDS: Record<string, string> = {
  file_status: 'fileStatus',
  flow_direction: 'caseDirection',
  proc_status: 'procStatus',
  selfilename1: 'downloadFileName'
}

export interface SavedChoice {
  value: string
  label: string
  parent?: string
}

const STORAGE_KEY = 'patmail.formOptionFallback.v1'
const memory = new Map<string, Map<string, SavedChoice[]>>()
const loadedUsers = new Set<string>()
const dirtyUsers = new Set<string>()
const listeners = new Set<() => void>()
let activeUser = ''
let epoch = 0
let flushTimer = 0

export function optionFallbackEpoch(): number {
  return epoch
}

export function subscribeOptionFallback(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function activeOptionUser(): string {
  return activeUser
}

function touch(): void {
  epoch += 1
  for (const listener of listeners) listener()
}

function same(left: SavedChoice[], right: SavedChoice[]): boolean {
  if (left.length !== right.length) return false
  return left.every((item, index) => item.value === right[index]?.value && item.label === right[index]?.label && item.parent === right[index]?.parent)
}

function cleanChoice(value: unknown): SavedChoice | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.value !== 'string' || typeof row.label !== 'string') return null
  const id = row.value.trim()
  const label = row.label.trim()
  if (!id || !label || id.length > 120 || label.length > 200 || label.replace(/[\s\-—_]/g, '') === '请选择') return null
  const parent = typeof row.parent === 'string' ? row.parent.trim() : ''
  if (parent.length > 120) return null
  return parent ? { value: id, label, parent } : { value: id, label }
}

function sanitize(choices: SavedChoice[]): SavedChoice[] {
  const seen = new Set<string>()
  const output: SavedChoice[] = []
  for (const item of choices) {
    const clean = cleanChoice(item)
    if (!clean || seen.has(clean.value)) continue
    seen.add(clean.value)
    output.push(clean)
    if (output.length >= 2000) break
  }
  return output
}

function parseBag(value: unknown): Map<string, SavedChoice[]> {
  const bag = new Map<string, SavedChoice[]>()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bag
  for (const [key, rows] of Object.entries(value as Record<string, unknown>)) {
    if (!key || key.length > 80 || !Array.isArray(rows)) continue
    const choices = sanitize(rows as SavedChoice[])
    if (choices.length) bag.set(key, choices)
    if (bag.size >= 400) break
  }
  return bag
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = 0
    void flushOptionFallback()
  }, 200) as unknown as number
}

export async function flushOptionFallback(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = 0
  }
  const users = [...dirtyUsers]
  dirtyUsers.clear()
  const area = globalThis.chrome?.storage?.local
  if (!area || users.length === 0) return
  try {
    const stored = await area.get(STORAGE_KEY)
    const previous = stored[STORAGE_KEY]
    const all = previous && typeof previous === 'object' && !Array.isArray(previous)
      ? { ...(previous as Record<string, unknown>) }
      : {}
    for (const userId of users) {
      const bag = memory.get(userId)
      if (!bag?.size) continue
      const row: Record<string, SavedChoice[]> = {}
      for (const [key, choices] of bag) row[key] = choices
      all[userId] = row
    }
    await area.set({ [STORAGE_KEY]: all })
  } catch {
    for (const userId of users) dirtyUsers.add(userId)
  }
}

/** 切换账号后先用这个账号上次保存的下拉，接口回来再覆盖。 */
export function activateOptionFallback(userId: string): void {
  activeUser = userId
  touch()
}

export async function hydrateOptionFallback(userId: string): Promise<void> {
  activeUser = userId
  if (!userId || loadedUsers.has(userId)) {
    touch()
    return
  }
  loadedUsers.add(userId)
  const area = globalThis.chrome?.storage?.local
  if (!area) {
    touch()
    return
  }
  try {
    const stored = await area.get(STORAGE_KEY)
    const bag = stored[STORAGE_KEY]
    const row = bag && typeof bag === 'object' && !Array.isArray(bag)
      ? (bag as Record<string, unknown>)[userId]
      : undefined
    const parsed = parseBag(row)
    if (parsed.size) {
      const current = memory.get(userId) ?? new Map<string, SavedChoice[]>()
      for (const [key, choices] of parsed) {
        if (!current.has(key)) current.set(key, choices)
      }
      memory.set(userId, current)
    }
  } catch {
    loadedUsers.delete(userId)
  }
  touch()
}

export function savedChoices(userId: string, key: string): SavedChoice[] | null {
  const rows = memory.get(userId)?.get(key)
  return rows?.length ? rows.map(item => ({ ...item })) : null
}

/** 只有非空新列表才覆盖上次保存的选项。空结果保持原样。 */
export function rememberChoices(userId: string, key: string, choices: SavedChoice[]): boolean {
  if (!userId || !key || key.length > 80) return false
  const clean = sanitize(choices)
  if (!clean.length) return false
  const bag = memory.get(userId) ?? new Map<string, SavedChoice[]>()
  const previous = bag.get(key)
  if (previous && same(previous, clean)) return false
  bag.set(key, clean)
  memory.set(userId, bag)
  dirtyUsers.add(userId)
  scheduleFlush()
  touch()
  return true
}

export function choicesFromDictionary(dictionary: NormalizedDictionary | undefined): SavedChoice[] {
  if (!dictionary || dictionary.status === 'invalid') return []
  return sanitize(dictionary.options.flatMap(item => {
    if (item.disabled || !item.value || !item.label) return []
    return [{
      value: item.value,
      label: item.label,
      ...(item.parentValue ? { parent: item.parentValue } : {})
    }]
  }))
}

/** 按表单键把这次读到的非空字典写进回退。 */
export function rememberDictionaries(
  userId: string,
  formToDictionary: Record<string, string>,
  dictionaries: Record<string, NormalizedDictionary>
): void {
  for (const [formKey, name] of Object.entries(formToDictionary)) {
    rememberChoices(userId, formKey, choicesFromDictionary(dictionaries[name]))
  }
}

/** 脚本扫到的下拉只有带选项时才覆盖回退。调用方传入已经换成表单键的字段。 */
export function rememberFormFields(userId: string, fields: FileSearchFormField[]): void {
  for (const field of fields) {
    if ((field.control !== 'select' && field.control !== 'picker') || !field.options.length) continue
    rememberChoices(userId, field.id, field.options)
  }
}
