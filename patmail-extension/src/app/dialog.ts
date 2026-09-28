import { reactive } from 'vue'

export interface DialogOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
}

const state = reactive({
  open: false,
  title: '',
  message: '',
  confirmLabel: '确定',
  cancelLabel: '取消'
})

let settle: ((confirmed: boolean) => void) | null = null

export function dialogState() {
  return state
}

/** 全站确认框。同一时间只开一个，后来的会关掉前一个。 */
export function confirmDialog(options: DialogOptions): Promise<boolean> {
  if (settle) settle(false)
  state.title = options.title
  state.message = options.message
  state.confirmLabel = options.confirmLabel?.trim() || '确定'
  state.cancelLabel = options.cancelLabel === undefined ? '取消' : options.cancelLabel.trim()
  state.open = true
  return new Promise(resolve => {
    settle = resolve
  })
}

/** 只读说明。遮罩、Esc 和「知道了」都是关掉。 */
export function infoDialog(options: Pick<DialogOptions, 'title' | 'message'>): Promise<boolean> {
  return confirmDialog({ ...options, confirmLabel: '知道了', cancelLabel: '' })
}

export function closeDialog(confirmed: boolean): void {
  if (!state.open) return
  state.open = false
  const done = settle
  settle = null
  done?.(confirmed)
}
