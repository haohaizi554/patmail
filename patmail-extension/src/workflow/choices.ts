import { LIMIT_MAIL_STYLES } from '../customer/mail-flow'
import type { TreeOption } from '../query/option-tree'

export interface ChoiceOption {
  value: string
  label: string
  group?: string
  badge?: string
}

export interface MailTypeChoiceInput {
  nodes: Array<{ id: string; name: string }>
  mappings: Array<{ enabled: boolean; mailTypeId: string; mailTypeName: string; fileDescriptionText?: string }>
  currentId: string
  currentName: string
}

export interface SenderChoiceInput {
  senders: Array<{ id: string; label: string }>
  remembered: { id: string; label: string } | null
  currentId: string
  currentName: string
}

function clip(value: string, max: number): string {
  const text = value.trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 发文类型按父子挂成树。当前选中的如果不在这份名单里，仍留着，避免把已保存的选择弄丢。 */
export function mailTypeTreeOptions(input: {
  nodes: Array<{ id: string; name: string; parentId?: string }>
  currentId: string
  currentName: string
}): TreeOption[] {
  const options: TreeOption[] = []
  const seen = new Set<string>()
  for (const node of input.nodes) {
    const id = node.id.trim()
    const name = node.name.trim()
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    const parent = node.parentId?.trim()
    options.push({ value: id, label: name, ...(parent && parent !== id ? { parent } : {}) })
  }
  const current = input.currentId.trim()
  if (current && !seen.has(current)) {
    options.push({ value: current, label: input.currentName.trim() || '上次选的一种' })
  }
  return options
}

/** 已经配好的一对排在前面，其余种类跟在后面。同一个种类只出现一次。 */
export function mailTypeChoiceOptions(input: MailTypeChoiceInput): ChoiceOption[] {
  const options: ChoiceOption[] = [{ value: '', label: '按完整名称对' }]
  const seen = new Set<string>()
  for (const mapping of input.mappings) {
    if (!mapping.enabled || !mapping.mailTypeId.trim() || seen.has(mapping.mailTypeId)) continue
    seen.add(mapping.mailTypeId)
    const name = input.nodes.find(node => node.id === mapping.mailTypeId)?.name || mapping.mailTypeName.trim() || '已配对的一种'
    const desc = clip(mapping.fileDescriptionText ?? '', 12)
    options.push({
      value: mapping.mailTypeId,
      label: desc ? `${desc} → ${name}` : name,
      group: '已经配好的',
      badge: '已配对'
    })
  }
  for (const node of input.nodes) {
    if (!node.id.trim() || !node.name.trim() || seen.has(node.id)) continue
    seen.add(node.id)
    options.push({ value: node.id, label: node.name, group: '全部种类' })
  }
  const current = input.currentId.trim()
  if (current && !seen.has(current)) {
    options.push({ value: current, label: input.currentName.trim() || '上次选的一种', group: '已经配好的' })
  }
  return options
}

/** 没点名时沿用哪一个邮箱。名字要写出来，不能只说「已经记住的」。 */
export function rememberedSenderLabel(name: string): string {
  const text = name.trim()
  return text ? `不指定，沿用${text}` : '不指定，还没有记住的邮箱'
}

/** 审核人就是现在登录的这个人。没读到名字时照实说。 */
export function loginReviewLabel(name: string): string {
  const text = name.trim()
  return text ? `交给${text}` : '还没读到当前登录人'
}

/** 不指定时沿用规则或客户上已经记住的邮箱。规则里那一个会标出来。 */
export function senderChoiceOptions(input: SenderChoiceInput): ChoiceOption[] {
  const options: ChoiceOption[] = [{ value: '', label: rememberedSenderLabel(input.remembered?.label ?? '') }]
  const seen = new Set<string>()
  const remembered = input.remembered
  if (remembered && remembered.id.trim()) {
    seen.add(remembered.id)
    options.push({ value: remembered.id, label: remembered.label.trim() || '已记住的邮箱', group: '已经记住的', badge: '已记住' })
  }
  for (const sender of input.senders) {
    if (!sender.id.trim() || seen.has(sender.id)) continue
    seen.add(sender.id)
    options.push({ value: sender.id, label: sender.label.trim() || '邮箱', group: '邮箱' })
  }
  const current = input.currentId.trim()
  if (current && !seen.has(current)) {
    options.push({ value: current, label: input.currentName.trim() || '已选的邮箱', group: '已经记住的' })
  }
  return options
}

export interface ProcNode {
  id: string
  label: string
  parentId?: string
}

/** 处理事项按父子挂成树。只把具体事项当作当前选中；分类节点留在树上，用来展开。 */
export function procTreeOptions(nodes: ProcNode[], currentLabel: string): { options: TreeOption[]; selectedId: string } {
  const options: TreeOption[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    const id = node.id.trim()
    const label = node.label.trim()
    if (!id || !label || seen.has(id)) continue
    seen.add(id)
    options.push({ value: id, label })
  }
  const byId = new Map(options.map(item => [item.value, item]))
  for (const node of nodes) {
    const item = byId.get(node.id.trim())
    const parent = node.parentId?.trim()
    if (!item || !parent || parent === item.value || !byId.has(parent)) continue
    item.parent = parent
  }
  const parents = new Set(options.map(item => item.parent).filter((item): item is string => Boolean(item)))
  const wanted = currentLabel.trim()
  const leaves = options.filter(item => item.label === wanted && !parents.has(item.value))
  if (leaves.length === 1) return { options, selectedId: leaves[0]?.value ?? '' }
  if (!wanted) return { options, selectedId: '' }
  const saved = `saved:${wanted}`
  return { options: [...options, { value: saved, label: wanted }], selectedId: saved }
}

/** 客户里看到的名字，和提交时用的记号分开。这里只给出看得见的名字。 */
export function mailStyleChoiceOptions(): ChoiceOption[] {
  return LIMIT_MAIL_STYLES.map(item => ({ value: item.value, label: item.label }))
}

const STYLE_VALUE: Record<string, string> = {
  style_1_label: 'style_1_value',
  style_2_label: 'style_2_value',
  style_3_label: 'style_3_value'
}

export function isStyleLabelParam(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(STYLE_VALUE, id)
}

export function styleValueParamId(labelId: string): string {
  return STYLE_VALUE[labelId] ?? ''
}

/** 已经记住的记号优先。没有记号时，按写出来的名字对上一种。 */
export function selectedStyleValue(label: string, stored: string): string {
  const code = stored.trim()
  if (LIMIT_MAIL_STYLES.some(item => item.value === code)) return code
  return LIMIT_MAIL_STYLES.find(item => item.label === label.trim())?.value ?? ''
}

export function styleLabelFor(value: string): string {
  return LIMIT_MAIL_STYLES.find(item => item.value === value)?.label ?? ''
}

/** 审核人名单。当前登录的人标出来。已经选过、这次名单里没有的，仍留着。 */
export function reviewerChoiceOptions(input: {
  reviewers: Array<{ id: string; name: string }>
  currentId: string
  currentName: string
  selectedId: string
  selectedName: string
}): ChoiceOption[] {
  const options: ChoiceOption[] = []
  const seen = new Set<string>()
  const current = input.currentId.trim().toLowerCase()
  for (const person of input.reviewers) {
    const id = person.id.trim()
    const name = person.name.trim()
    if (!id || !name || seen.has(id.toLowerCase())) continue
    seen.add(id.toLowerCase())
    options.push({ value: id, label: current && id.toLowerCase() === current ? `${name}（当前账号）` : name })
  }
  const selected = input.selectedId.trim()
  if (selected && selected.toLowerCase() !== 'self' && !seen.has(selected.toLowerCase())) {
    options.unshift({ value: selected, label: input.selectedName.trim() || '已选的人' })
  } else if (current && !seen.has(current)) {
    const name = input.currentName.trim()
    options.unshift({ value: input.currentId.trim(), label: name ? `${name}（当前账号）` : '当前登录人' })
  }
  return options
}

/** 选了具体的人就用那个人。没点名时，沿用现在登录的这个人。 */
export function shownReviewerId(input: { stored: string; currentId: string; reviewers: Array<{ id: string }> }): string {
  const stored = input.stored.trim()
  if (stored && stored.toLowerCase() !== 'self') return stored
  const current = input.currentId.trim().toLowerCase()
  const self = input.reviewers.find(item => current && item.id.trim().toLowerCase() === current)
  return self?.id ?? input.currentId.trim()
}
