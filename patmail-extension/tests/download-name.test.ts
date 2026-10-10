import { describe, expect, it } from 'vitest'
import type { EasyTransport } from '../src/api/transport'
import {
  buildGetFileNameParams, downloadRecipe, readGeneratedFileNames, resolveDownloadFileNames, selectionFromControls
} from '../src/mail/download-name'

const TEMPLATE = 'd9896997-1e83-4c7d-9a49-da69ba56e7aa'
const FILE = '603ca943-a07a-4894-9461-29dff2d60c4b'

describe('下载名称', () => {
  it('选中模板时记下配方，不把空列当成名称', () => {
    expect(selectionFromControls({
      templateId: TEMPLATE,
      column: '',
      label: '微众官文',
      template: { newFilename: 'case_volume;官文', fileNameType: 'colname;txt' }
    })).toEqual({
      templateId: TEMPLATE,
      newFilename: 'case_volume;官文',
      fileNameType: 'colname;txt',
      label: '微众官文'
    })
    expect(selectionFromControls({ column: '' })).toBeNull()
    expect(selectionFromControls({ column: 'case_volume', label: '我方文号' })).toEqual({
      column: 'case_volume',
      newFilename: 'case_volume',
      fileNameType: 'colname',
      label: '我方文号'
    })
    expect(downloadRecipe('case_volume;', 'colname;txt')).toBeNull()
  })

  it('GetFileName 按文件顺序带回生成名', async () => {
    const params = buildGetFileNameParams([FILE], { newFilename: 'file_desc', fileNameType: 'colname' })
    expect(params?.get('Call')).toBe('GetFileName')
    expect(params?.get('file_ids')).toBe(FILE)
    expect(params?.get('new_filename')).toBe('file_desc')
    expect(readGeneratedFileNames({
      file_names: '证书.pdf',
      ClientInfo: { Status: true, Result: false, Message: null }
    }, 1)).toEqual(['证书.pdf'])

    const transport = {
      async post(operation: string) {
        if (operation === 'fileTempList') {
          return {
            ok: true as const,
            data: { TempNameList: [{ id: TEMPLATE, new_filename: 'case_volume;官文', file_name_type: 'colname;txt' }] }
          }
        }
        return {
          ok: true as const,
          data: { file_names: 'PA1官文.pdf', ClientInfo: { Status: true } }
        }
      }
    }
    const named = await resolveDownloadFileNames(transport as unknown as EasyTransport, [FILE], { templateId: TEMPLATE })
    expect(named).toEqual({ ok: true, data: ['PA1官文.pdf'] })
  })
})
