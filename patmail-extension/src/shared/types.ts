/** 页面上的文本输入控件。textarea 用 tag 区分，不单独拆业务字段。 */
export interface InputInfo {
  tag: 'input' | 'textarea'
  type: string
  name: string
  id: string
  placeholder: string
  value: string
}

export interface SelectInfo {
  tag: 'select'
  name: string
  id: string
  value: string
  options: string[]
}

export interface ButtonInfo {
  tag: 'button' | 'input'
  type: string
  id: string
  name: string
  text: string
}

/** 一次 DOM 扫描的结构化结果。只描述页面，不包含业务含义。 */
export interface PageSnapshot {
  url: string
  title: string
  hostname: string
  inputs: InputInfo[]
  selects: SelectInfo[]
  buttons: ButtonInfo[]
}

export interface PageInfo {
  url: string
  title: string
  hostname: string
}

export interface ScanSummary {
  url: string
  title: string
  hostname: string
  inputCount: number
  selectCount: number
  buttonCount: number
}

export function summarize(snapshot: PageSnapshot): ScanSummary {
  return {
    url: snapshot.url,
    title: snapshot.title,
    hostname: snapshot.hostname,
    inputCount: snapshot.inputs.length,
    selectCount: snapshot.selects.length,
    buttonCount: snapshot.buttons.length
  }
}
