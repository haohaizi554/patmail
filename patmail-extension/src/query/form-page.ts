import snapshot from './file-search-form.snapshot.json'
import { xmlNodeToApiField } from './field-registry'
import { activeOptionUser, savedChoices } from './option-fallback'
import type { FileSearchFormField } from '../shared/message'

const saved = snapshot.fields as FileSearchFormField[]

/** 打包时的扫描结果，叠上这个账号上次读到的非空选项。 */
export function fallbackFields(): FileSearchFormField[] {
  const userId = activeOptionUser()
  if (!userId) return saved
  return saved.map(field => {
    const next = savedChoices(userId, formFieldKey(field.id))
    if (!next?.length || (field.control !== 'select' && field.control !== 'picker')) return field
    return {
      ...field,
      options: next.map(item => ({ value: item.value, label: item.label, ...(item.parent ? { parent: item.parent } : {}) }))
    }
  })
}

export function formFieldKey(id: string): string {
  return xmlNodeToApiField(id) ?? id
}

export function hiddenFormFields(fields: FileSearchFormField[] = saved): Set<string> {
  return new Set(fields.filter(item => !item.visible).map(item => formFieldKey(item.id)))
}

function meaningfulOption(option: { value: string; label: string }): boolean {
  const value = option.value.trim()
  const label = option.label.trim()
  if (!value || !label) return false
  return label.replace(/[\s\-—_]/g, '') !== '请选择'
}

export function pageSelectOptions(key: string, fields: FileSearchFormField[] = fallbackFields()): { value: string; label: string; parent?: string }[] | null {
  const found = fields.find(item => item.visible && (item.control === 'select' || item.control === 'picker') && formFieldKey(item.id) === key && item.options.length)
  if (!found) return null
  return found.options.flatMap(option => {
    if (!meaningfulOption(option)) return []
    const row = { value: option.value.trim(), label: option.label.trim() }
    return option.parent ? [{ ...row, parent: option.parent }] : [row]
  })
}

/** 页面上读到的字段保留原样。树形框不再点开，选项用接口刚返回的完整名单补上。 */
export function overlayFieldOptions(
  fields: FileSearchFormField[],
  optionsFor: (key: string) => { value: string; label: string; parent?: string }[] | null
): FileSearchFormField[] {
  return fields.map(field => {
    if (field.control !== 'select' && field.control !== 'picker') return field
    const key = formFieldKey(field.id)
    const live = key ? optionsFor(key) : null
    if (!live?.length) return field
    return { ...field, options: live }
  })
}

export function mergeFormFields(live: FileSearchFormField[], previous: FileSearchFormField[] = fallbackFields()): FileSearchFormField[] {
  return live.map(field => {
    if (field.options.some(meaningfulOption)) return field
    const older = previous.find(item => item.id === field.id)
    return older?.options.some(meaningfulOption) ? { ...field, options: older.options } : field
  })
}

export function describeFormCheck(live: FileSearchFormField[], previous: FileSearchFormField[] = fallbackFields()): string[] {
  const before = new Map(previous.map(item => [item.id, item]))
  const hiddenNow: string[] = []
  const shownNow: string[] = []
  const optionsChanged: string[] = []
  for (const field of live) {
    const older = before.get(field.id)
    if (!older) continue
    if (older.visible && !field.visible) hiddenNow.push(`${field.label}藏在 ${field.hiddenBy[0] || '页面样式里'}`)
    if (!older.visible && field.visible) shownNow.push(field.label)
    if ((field.control === 'select' || field.control === 'picker') && JSON.stringify(field.options) !== JSON.stringify(older.options)) optionsChanged.push(field.label)
  }
  const lines = ['已打开原网站的文件查询页，对照上次保存的字段记录。']
  if (!hiddenNow.length && !shownNow.length && !optionsChanged.length) lines.push('藏起来的条件和下拉选项都没有变化。')
  if (hiddenNow.length) lines.push(`新藏起来的：${hiddenNow.join('，')}。`)
  if (shownNow.length) lines.push(`现在能看到的：${shownNow.join('，')}。`)
  if (optionsChanged.length) lines.push(`下拉选项有变化：${optionsChanged.join('，')}。`)
  const stillHidden = live.filter(item => !item.visible && item.label && item.label !== item.id)
  if (stillHidden.length) lines.push(`页面上仍然藏着 ${stillHidden.length} 项，例如${stillHidden.slice(0, 4).map(item => item.label).join('、')}。这些不会出现在查询表里。`)
  return lines
}
