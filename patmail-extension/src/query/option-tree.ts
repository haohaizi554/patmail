export interface TreeOption {
  value: string
  label: string
  parent?: string
}

export interface OptionTreeNode {
  value: string
  label: string
  childIds: string[]
}

export interface OptionTree {
  roots: string[]
  byId: Map<string, OptionTreeNode>
}

/** 至少有一个选项的父节点也在这份列表里，才按树展示。 */
export function hasOptionTree(options: readonly TreeOption[]): boolean {
  const ids = new Set(options.map(item => item.value))
  return options.some(item => Boolean(item.parent) && item.parent !== item.value && ids.has(item.parent ?? ''))
}

export function buildOptionTree(options: readonly TreeOption[]): OptionTree {
  const byId = new Map<string, OptionTreeNode>()
  for (const option of options) {
    if (!option.value || byId.has(option.value)) continue
    byId.set(option.value, { value: option.value, label: option.label, childIds: [] })
  }
  const roots: string[] = []
  for (const option of options) {
    const node = byId.get(option.value)
    if (!node) continue
    const parent = option.parent && option.parent !== option.value ? byId.get(option.parent) : undefined
    if (parent) parent.childIds.push(node.value)
    else roots.push(node.value)
  }
  return { roots, byId }
}

/** 搜索命中节点，并带上通往根的父级，方便手动展开前先看到路径。 */
export function searchOptionTree(tree: OptionTree, query: string): { visible: Set<string>; expand: Set<string> } {
  const text = query.trim().toLowerCase()
  const visible = new Set<string>()
  const expand = new Set<string>()
  if (!text) return { visible, expand }
  const parentOf = new Map<string, string>()
  for (const node of tree.byId.values()) {
    for (const childId of node.childIds) parentOf.set(childId, node.value)
  }
  for (const node of tree.byId.values()) {
    if (!node.label.toLowerCase().includes(text)) continue
    visible.add(node.value)
    let parent = parentOf.get(node.value)
    const trail = new Set<string>([node.value])
    while (parent && !trail.has(parent)) {
      visible.add(parent)
      expand.add(parent)
      trail.add(parent)
      parent = parentOf.get(parent)
    }
  }
  return { visible, expand }
}
