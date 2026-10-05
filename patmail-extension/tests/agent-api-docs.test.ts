import { describe, expect, it } from 'vitest'
import { apiCatalogBrief, apiDocFiles, searchApiDocs, searchApiSections, sectionsFromMarkdown } from '../src/agent/api-docs'

describe('api docs', () => {
  it('splits a note on second-level headings', () => {
    const sections = sectionsFromMarkdown('04-文件查询.md', '# 文件查询\n\n前言\n\n## GetSearchFiles\n\nCall=GetSearchFiles\n')
    expect(sections.map(section => section.heading)).toEqual(['文件查询', '文件查询 / GetSearchFiles'])
    const found = searchApiSections(sections, 'GetSearchFiles')
    expect(found).toContain('04-文件查询.md')
    expect(found).toContain('Call=GetSearchFiles')
    expect(found).not.toContain('前言')
  })

  it('loads every API markdown and can find a known call', () => {
    const files = apiDocFiles()
    expect(files).toContain('00-通用约定.md')
    expect(files).toContain('README.md')
    expect(files.length).toBeGreaterThanOrEqual(42)
    const hit = searchApiDocs('GetSearchFiles')
    expect(hit).toContain('GetSearchFiles')
    expect(hit).toContain('不是这次已经发出的请求')
  })

  it('counts interfaces from the index instead of counting markdown files', () => {
    const brief = apiCatalogBrief()
    expect(brief).toContain('一共 350 个接口')
    expect(brief).toContain('CaseInfo.ashx 79')
    expect(brief).toContain('不是文档篇数')
    expect(searchApiDocs('一共有多少接口')).toBe(brief)
    expect(searchApiDocs('一共有多少接口')).not.toContain('00-通用约定.md')
  })
})
