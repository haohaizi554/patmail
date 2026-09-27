import { describe, expect, it } from 'vitest'
import { buildOptionTree, hasOptionTree, searchOptionTree } from '../src/query/option-tree'

const options = [
  { value: 'root', label: '恒程创新' },
  { value: 'office', label: '总裁办', parent: 'root' },
  { value: 'lab', label: '天策研究院', parent: 'root' },
  { value: 'solo', label: '歌尔-专利部' }
]

describe('选项树', () => {
  it('keeps parent and child levels', () => {
    expect(hasOptionTree(options)).toBe(true)
    const tree = buildOptionTree(options)
    expect(tree.roots).toEqual(['root', 'solo'])
    expect(tree.byId.get('root')?.childIds).toEqual(['office', 'lab'])
  })

  it('search keeps the path and expands ancestors', () => {
    const found = searchOptionTree(buildOptionTree(options), '总裁')
    expect([...found.visible]).toEqual(['office', 'root'])
    expect([...found.expand]).toEqual(['root'])
  })

  it('treats a flat list as not a tree', () => {
    expect(hasOptionTree([{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }])).toBe(false)
  })
})
