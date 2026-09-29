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

/** 已经配好的一对排在前面，其余种类跟在后面。同一个种类只出现一次。 */
export function mailTypeChoiceOptions(input: MailTypeChoiceInput): ChoiceOption[] {
  const options: ChoiceOption[] = [{ value: '', label: '按名字里的词来对' }]
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

/** 不指定时沿用规则或客户上已经记住的邮箱。规则里那一个会标出来。 */
export function senderChoiceOptions(input: SenderChoiceInput): ChoiceOption[] {
  const options: ChoiceOption[] = [{ value: '', label: '不指定，沿用已经记住的' }]
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

/** 事项名单。当前写法不在名单里时仍留着，避免把表格对不上。 */
export function procChoiceOptions(labels: string[], current: string): ChoiceOption[] {
  const options: ChoiceOption[] = []
  const seen = new Set<string>()
  for (const label of labels) {
    const text = label.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    options.push({ value: text, label: text })
  }
  const saved = current.trim()
  if (saved && !seen.has(saved)) options.unshift({ value: saved, label: saved })
  return options
}
