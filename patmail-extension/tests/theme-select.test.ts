import { describe, expect, it } from 'vitest'
import { highlightAfterKey, placeMenu, showsGroup, textOptions } from '../../src/components/theme-select'

describe('theme select', () => {
  it('opens downward and flips upward when the lower space is tight', () => {
    const down = placeMenu({ top: 100, bottom: 136, left: 20, width: 220 }, { width: 800, height: 600 })
    expect(down.top).toBe(142)
    expect(down.left).toBe(20)
    expect(down.width).toBe(220)
    const up = placeMenu({ top: 540, bottom: 576, left: 20, width: 220 }, { width: 800, height: 600 })
    expect(up.top).toBeLessThan(540)
    expect(up.maxHeight).toBeGreaterThan(80)
  })

  it('keeps the menu inside the viewport', () => {
    const placed = placeMenu({ top: 40, bottom: 76, left: 760, width: 220 }, { width: 800, height: 600 })
    expect(placed.left + placed.width).toBeLessThanOrEqual(792)
  })

  it('moves the highlight only after the menu is open', () => {
    expect(highlightAfterKey(-1, 3, 'ArrowDown', false).action).toBe('open')
    expect(highlightAfterKey(-1, 3, 'ArrowDown', true)).toEqual({ highlight: 0, action: 'move' })
    expect(highlightAfterKey(2, 3, 'ArrowDown', true).highlight).toBe(0)
    expect(highlightAfterKey(0, 3, 'Enter', true)).toEqual({ highlight: 0, action: 'select' })
    expect(highlightAfterKey(1, 3, 'Escape', true).action).toBe('close')
  })

  it('shows a group heading when the group changes', () => {
    const options = textOptions(['手动查询']).concat([
      { value: 'a', label: '甲', group: 'EASY' },
      { value: 'b', label: '乙', group: 'EASY' },
      { value: 'c', label: '丙', group: '本地' }
    ])
    expect(showsGroup(options, 0)).toBe(false)
    expect(showsGroup(options, 1)).toBe(true)
    expect(showsGroup(options, 2)).toBe(false)
    expect(showsGroup(options, 3)).toBe(true)
  })
})