import { describe, expect, it } from 'vitest'
import { readXlsxRows } from '../src/customer/xlsx-table'
import {
  agencySearchElement,
  firstInventorEmail,
  patentDataParams,
  searchHits,
  techUserText
} from '../src/case-contact/query'
import { contactWorkbook } from '../src/case-contact/xlsx'
import { caseContactSkills, hasCaseContactSkill } from '../src/customer/skills'
import { isCustomerProfile } from '../src/customer/guards'

describe('案件联系人导出', () => {
  it('查询条件把客户案号放进 case_volume，并保持转义', () => {
    const element = agencySearchElement(['WT-CN20260104-01', 'CS-CN20251009-01'])
    expect(element.startsWith('&lt;case_volume&gt;WT-CN20260104-01\nCS-CN20251009-01&lt;/case_volume&gt;')).toBe(true)
    expect(element).toContain('&lt;case_type&gt;&lt;/case_type&gt;')
    expect(element).toContain('&lt;is_proc&gt;1&lt;/is_proc&gt;')
    expect(element).not.toContain('<case_volume>')
  })

  it('从查询结果只留下客户案号和案件编号', () => {
    const parsed = searchHits({
      TableRows: [{
        case_volume: 'WT-CN20260104-01',
        case_id: 'B1E3444A-FCCB-460C-B207-49D0A67A6DF1',
        case_volume_customer: 'PA2610049CND',
        tablerowscount: '1'
      }]
    })
    expect(parsed).toEqual({
      hits: [{ volume: 'WT-CN20260104-01', caseId: 'B1E3444A-FCCB-460C-B207-49D0A67A6DF1' }],
      total: 1
    })
  })

  it('邮箱取第一位发明人，技术负责人取显示名', () => {
    expect(firstInventorEmail({
      Inventors: [
        { inventor_name_cn: '倪晓升', email: 'nixsh@pcl.ac.cn', id_number: '445221199406204557', mobile: '15626120198' },
        { inventor_name_cn: '俞熊斌', email: 'yuxb@pcl.ac.cn' }
      ]
    })).toBe('nixsh@pcl.ac.cn')
    expect(techUserText({
      p_case_info: [{ tech_user_id: '160f63be-aa05-417e-ba18-f8da81e91dd2', tech_user_id_text: '倪晓升(nixsh)', case_volume: 'WT-CN20260104-01' }]
    })).toBe('倪晓升(nixsh)')
    expect(patentDataParams('B1E3444A-FCCB-460C-B207-49D0A67A6DF1').get('Call')).toBe('GetPatentData')
  })

  it('工作簿只有这三列', async () => {
    const rows = await readXlsxRows(contactWorkbook([{ volume: 'WT-CN20260104-01', tech: '倪晓升(nixsh)', email: 'nixsh@pcl.ac.cn' }]))
    expect(rows).toEqual([
      ['客户案号', '技术负责人', '邮箱'],
      ['WT-CN20260104-01', '倪晓升(nixsh)', 'nixsh@pcl.ac.cn']
    ])
  })

  it('只有创建鹏城实验室才默认解锁导出', () => {
    expect(caseContactSkills('鹏城实验室')).toEqual(['case-contacts'])
    expect(caseContactSkills(' 鹏城 实验室 ')).toEqual(['case-contacts'])
    expect(caseContactSkills('其他客户')).toBeUndefined()
    expect(hasCaseContactSkill({ name: '鹏城实验室' })).toBe(true)
    expect(hasCaseContactSkill({ name: '其他客户' })).toBe(false)
    expect(caseContactSkills('改名以后', ['case-contacts'])).toEqual(['case-contacts'])
    expect(isCustomerProfile({
      id: 'customer-1', name: '鹏城实验室', baseTemplateId: 'manual', overrides: {},
      skills: ['case-contacts'], enabled: true,
      createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z'
    })).toBe(true)
    expect(isCustomerProfile({
      id: 'customer-1', name: '其他客户', baseTemplateId: 'manual', overrides: {},
      skills: ['other'], enabled: true,
      createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z'
    })).toBe(false)
  })
})
