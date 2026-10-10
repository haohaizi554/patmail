import { describe, expect, it } from 'vitest'
import { buildPickerCatalog, choicesFromDictionary, describePickerReceipt } from '../src/api/dictionaries/picker-catalog'

const PATENT = '31D1A147-2931-43B5-94AE-B72B1525BA8A'
const TRADEMARK = '0E8A4B7F-E407-4EFF-9562-3809BF484207'
const OFFICIAL = 'A72068F7-6520-4AAF-A026-DADEB792ED4E'
const DEPT = '11111111-1111-4111-8111-111111111111'
const CHILD = '22222222-2222-4222-8222-222222222222'
const BUSS = '05E75F37-60F5-44E1-8B57-456AC8B4CFF7'

describe('下拉校对目录', () => {
  it('builds trees, download names, and limit dropdowns from the live response keys', () => {
    const built = buildPickerCatalog({
      dept: { DeptTree: [{ id: DEPT, name: '总所', pid: '' }, { id: CHILD, name: '一部', pid: DEPT }] },
      user: { TreeUser: [{ id: 'user-1', name: '吴晨晨', pid: DEPT }] },
      agent: null,
      fileTemp: { TempNameList: [{ id: 'temp-1', temp_name: '我的下载名', user_id: 'u1', new_filename: 'case_volume;官文', file_name_type: 'colname;txt' }] },
      branch: { BranchList: [{ dept_id: DEPT, dept_name: '广州分部', parent_id: '' }] },
      applyTags: { ApplyTags: null },
      limitInit: {
        CountryInfo: [{ value: 'CN', text_zh_cn: '中国' }],
        CaseType: [{ value: PATENT, text_zh_cn: '专利' }],
        ProcStatus: [{ value: 'DF', text_zh_cn: '待返稿' }],
        CustomerStatus: [{ value: 'vip', text_zh_cn: '大客户' }],
        apply_type: [
          { value: 'inv', text_zh_cn: '发明', case_type_id: PATENT, country_id: 'ALL' },
          { value: 'tm', text_zh_cn: '商标申请', case_type_id: TRADEMARK, country_id: 'CN' }
        ],
        case_status: [
          { value: 'open', text_zh_cn: '未结案', case_type_id: PATENT, status_class: 'CASE', seq: 2 },
          { value: 'early', text_zh_cn: '受理', case_type_id: PATENT, status_class: 'CASE', seq: 1 },
          { value: 'tm-open', text_zh_cn: '未结案', case_type_id: TRADEMARK, status_class: 'CASE', seq: 1 },
          { value: 'other', text_zh_cn: '处理中', case_type_id: '122136EA-F3E3-46C5-A529-EFC358AC764B', status_class: 'CASE', seq: 1 },
          { value: 'proc', text_zh_cn: '处理中', case_type_id: PATENT, status_class: 'PROC', seq: 1 }
        ],
        Case_direction: [{ value: 'II', text_zh_cn: '内-内' }],
        BussType: [{ business_type_id: BUSS, bussType: '普通新申请', case_type_id: PATENT }],
        procType: [{ dictionary_id: OFFICIAL, text_zh_cn: '官方事项' }]
      },
      limitCtrl: { CtrlProc: [{ id: 'proc-1', name: '新申请', pId: '' }, { id: 'proc-2', name: '补正', pId: 'proc-1' }] }
    })

    expect(built.dictionaries.dept.options.map(item => item.parentValue)).toEqual([undefined, DEPT])
    expect(built.dictionaries.fileTemp.options).toEqual([expect.objectContaining({
      value: 'temp-1',
      label: '我的下载名',
      metadata: { newFilename: 'case_volume;官文', fileNameType: 'colname;txt' }
    })])
    expect(built.dictionaries.applyTags.status).toBe('empty')
    expect(built.dictionaries.limitProcType.options).toEqual([expect.objectContaining({ value: OFFICIAL, label: '官方事项' })])
    expect(built.dictionaries.limitCaseStatus.options.map(item => item.value)).toEqual(['open', 'early', 'tm-open', 'other'])
    expect(built.dictionaries.limitCtrlProc.options.find(item => item.value === 'proc-2')?.parentValue).toBe('proc-1')
    expect(built.warnings.some(item => item.startsWith('agent'))).toBe(false)

    const applyTypes = choicesFromDictionary(built.dictionaries.limitApplyType, PATENT, '')
    expect(applyTypes.map(item => item.value)).toEqual(['inv'])
    const chinaTypes = choicesFromDictionary(built.dictionaries.limitApplyType, TRADEMARK, 'CN')
    expect(chinaTypes.map(item => item.value)).toEqual(['tm'])
    const business = choicesFromDictionary(built.dictionaries.limitBussType, PATENT)
    expect(business.map(item => item.label)).toEqual(['普通新申请'])
    const tree = choicesFromDictionary(built.dictionaries.dept)
    expect(tree.find(item => item.value === CHILD)?.parent).toBe(DEPT)
    expect(choicesFromDictionary(built.dictionaries.limitCaseStatus, '')).toEqual([])
    expect(choicesFromDictionary(built.dictionaries.limitCaseStatus, PATENT).map(item => item.value)).toEqual(['early', 'open'])
    expect(choicesFromDictionary(built.dictionaries.limitCaseStatus, TRADEMARK)).toEqual([{ value: 'tm-open', label: '未结案' }])
    expect(describePickerReceipt(built.dictionaries)).toContain('部门 2')
    expect(describePickerReceipt(built.dictionaries)).toContain('处理事项 2')
  })
})
