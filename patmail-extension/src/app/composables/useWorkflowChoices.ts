import { computed, inject, ref } from 'vue'
import { fetchMailTypeNodes } from '../../customer/mail-type-load'
import { fetchMailSenders } from '../../customer/mailset-load'
import { MessageType, type MessageBridge } from '../../shared/message'
import { useWorkspace } from './useWorkspace'

export function useWorkflowChoices() {
  const bridge = inject<MessageBridge>('bridge')
  const { connection, rules } = useWorkspace()
  const ready = computed(() => connection.value.sessionStatus === 'authenticated')
  const mailTypes = ref<Array<{ id: string; name: string; parentId: string }>>([])
  const senders = ref<Array<{ id: string; label: string }>>([])
  const procs = ref<string[]>([])
  const notice = ref('')

  async function load(force: boolean): Promise<void> {
    if (!bridge || !ready.value) {
      mailTypes.value = []
      senders.value = []
      procs.value = []
      notice.value = '还没连上，名单是空的。'
      return
    }
    notice.value = '正在读取已经配好的名单…'
    const [types, boxes, matters] = await Promise.all([
      fetchMailTypeNodes(bridge, force),
      fetchMailSenders(bridge, force),
      loadProcs(force)
    ])
    mailTypes.value = types.nodes
    senders.value = boxes.items.map(item => ({ id: item.id, label: item.label }))
    procs.value = matters.labels
    notice.value = [types.message, boxes.message, matters.message].filter(Boolean).join(' ')
  }

  async function loadProcs(force: boolean): Promise<{ labels: string[]; message: string }> {
    if (!bridge) return { labels: [], message: '' }
    try {
      const response = await bridge.request({ type: MessageType.LoadDictionary, payload: { kind: 'picker', force } })
      if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'picker') {
        const message = response.type === MessageType.Error
          ? response.payload.message
          : response.type === MessageType.DictionaryResult && !response.payload.ok
            ? response.payload.error.message
            : '事项名单这次没有读到。'
        return { labels: [], message }
      }
      const labels = (response.payload.data.dictionaries.limitCtrlProc?.options ?? []).map(item => item.label)
      return { labels, message: labels.length ? '' : '事项名单是空的。' }
    } catch {
      return { labels: [], message: '事项名单没有读到。' }
    }
  }

  return { ready, rules, mailTypes, senders, procs, notice, load }
}
