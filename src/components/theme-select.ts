export interface ThemeSelectOption {
  value: string | number
  label: string
  group?: string
  disabled?: boolean
  /** 选项前的短标记，用来区分同一菜单里的不同来源。 */
  badge?: string
  /** site / diy。只这两类会带上对应的高亮样式。 */
  tone?: string
}

export interface MenuAnchor {
  top: number
  bottom: number
  left: number
  width: number
}

export interface MenuPlacement {
  top: number
  left: number
  width: number
  maxHeight: number
}

/** 选项多于这个数量时，菜单里提供搜索。 */
export const SELECT_SEARCH_THRESHOLD = 10

export function selectNeedsSearch(count: number): boolean {
  return count > SELECT_SEARCH_THRESHOLD
}

export function filterSelectOptions<T extends ThemeSelectOption>(options: T[], query: string): T[] {
  const text = query.trim().toLowerCase()
  if (!text) return options
  return options.filter(item => item.label.toLowerCase().includes(text))
}

const GAP = 6
const EDGE = 8
const MAX_HEIGHT = 280
/** 菜单内边距、选项内边距、边框，以及纵向滚动条占位，避免最长一行被挤出横向滚动。 */
const LABEL_CHROME = 6 * 2 + 10 * 2 + 2 + 16

let measureContext: CanvasRenderingContext2D | null | undefined

function measureMenuText(text: string): number {
  if (!text) return 0
  if (measureContext === undefined) {
    try {
      measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
    } catch {
      measureContext = null
    }
  }
  if (!measureContext) return text.length * 13
  measureContext.font = '700 13px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif'
  return measureContext.measureText(text).width
}

/** 菜单宽度至少放下最长的一项。extra 是树缩进等额外占位。 */
export function menuWidthForLabels(labels: readonly string[], extra = 0): number {
  let widest = 0
  for (const label of labels) widest = Math.max(widest, measureMenuText(label))
  return Math.ceil(widest + extra + LABEL_CHROME)
}

/** 树形选项按层级缩进。宽度按最深、最长的那一行计算。 */
export function treeMenuWidth(options: readonly { value: string; label: string; parent?: string }[]): number {
  const known = new Set(options.map(item => item.value))
  const parentOf = new Map(options.map(item => [item.value, item.parent ?? '']))
  const depthOf = (value: string, seen = new Set<string>()): number => {
    if (seen.has(value)) return 0
    seen.add(value)
    const parent = parentOf.get(value)
    if (!parent || !known.has(parent)) return 0
    return depthOf(parent, seen) + 1
  }
  let widest = 0
  for (const item of options) {
    const indent = depthOf(item.value) * 18 + 22
    widest = Math.max(widest, menuWidthForLabels([item.label], indent))
  }
  return widest
}

/** 菜单用视口坐标，靠近底部时向上展开，并避开左右边缘。宽度不窄于最长选项。 */
export function placeMenu(anchor: MenuAnchor, viewport: { width: number; height: number }, preferredHeight = 240, contentWidth = 0): MenuPlacement {
  const limit = Math.max(160, viewport.width - EDGE * 2)
  const width = Math.min(Math.max(anchor.width, contentWidth, 160), limit)
  let left = anchor.left
  if (left + width > viewport.width - EDGE) left = viewport.width - EDGE - width
  if (left < EDGE) left = EDGE
  const below = Math.max(0, viewport.height - anchor.bottom - GAP - EDGE)
  const above = Math.max(0, anchor.top - GAP - EDGE)
  const openUp = below < Math.min(preferredHeight, 160) && above > below
  const maxHeight = Math.max(80, Math.min(MAX_HEIGHT, openUp ? above : below || above || 80))
  const top = openUp ? Math.max(EDGE, anchor.top - GAP - maxHeight) : anchor.bottom + GAP
  return { top, left, width, maxHeight }
}

export function showsGroup(options: ThemeSelectOption[], index: number): boolean {
  const group = options[index]?.group
  if (!group) return false
  return index === 0 || options[index - 1]?.group !== group
}

/** 关闭时方向键只负责打开；打开后移动高亮、确认或关闭。 */
export function highlightAfterKey(current: number, count: number, key: string, opened: boolean): { highlight: number; action: 'open' | 'move' | 'select' | 'close' | 'none' } {
  if (!opened) {
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') return { highlight: current, action: 'open' }
    return { highlight: current, action: 'none' }
  }
  if (count <= 0) return { highlight: -1, action: key === 'Escape' ? 'close' : 'none' }
  if (key === 'ArrowDown') return { highlight: current < 0 ? 0 : (current + 1) % count, action: 'move' }
  if (key === 'ArrowUp') return { highlight: current < 0 ? count - 1 : (current - 1 + count) % count, action: 'move' }
  if (key === 'Home') return { highlight: 0, action: 'move' }
  if (key === 'End') return { highlight: count - 1, action: 'move' }
  if (key === 'Enter' || key === ' ') return { highlight: current < 0 ? 0 : current, action: 'select' }
  if (key === 'Escape') return { highlight: current, action: 'close' }
  return { highlight: current, action: 'none' }
}

export function textOptions(labels: readonly string[]): ThemeSelectOption[] {
  return labels.map(label => ({ value: label, label }))
}
