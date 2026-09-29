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
  const procs = ref<Array<{ id: string; label: string; parentId?: string }>>([])
  const reviewers = ref<Array<{ id: string; name: string }>>([])
  const notice = ref('')

  async function load(force: boolean): Promise<void> {
    if (!bridge || !ready.value) {
      mailTypes.value = []
      senders.value = []
      procs.value = []
      reviewers.value = []
      notice.value = '还没连上，名单是空的。'
      return
    }
    notice.value = '正在读取已经配好的名单…'
    const [types, boxes, matters, people] = await Promise.all([
      fetchMailTypeNodes(bridge, force),
      fetchMailSenders(bridge, force),
      loadProcs(force),
      loadReviewers(force)
    ])
    mailTypes.value = types.nodes
    senders.value = boxes.items.map(item => ({ id: item.id, label: item.label }))
    procs.value = matters.nodes
    reviewers.value = people.reviewers
    notice.value = [types.message, boxes.message, matters.message, people.message].filter(Boolean).join(' ')
  }

  async function loadProcs(force: boolean): Promise<{ nodes: Array<{ id: string; label: string; parentId?: string }>; message: string }> {
    if (!bridge) return { nodes: [], message: '' }
    try {
      const response = await bridge.request({ type: MessageType.LoadDictionary, payload: { kind: 'picker', force } })
      if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'picker') {
        const message = response.type === MessageType.Error
          ? response.payload.message
          : response.type === MessageType.DictionaryResult && !response.payload.ok
            ? response.payload.error.message
            : '事项名单这次没有读到。'
        return { nodes: [], message }
      }
      const nodes = (response.payload.data.dictionaries.limitCtrlProc?.options ?? []).flatMap(item => {
        const id = item.value.trim()
        const label = item.label.trim()
        if (!id || !label) return []
        const parentId = item.parentValue?.trim()
        return [{ id, label, ...(parentId && parentId !== id ? { parentId } : {}) }]
      })
      return { nodes, message: nodes.length ? '' : '事项名单是空的。' }
    } catch {
      return { nodes: [], message: '事项名单没有读到。' }
    }
  }

  async function loadReviewers(force: boolean): Promise<{ reviewers: Array<{ id: string; name: string }>; message: string }> {
    if (!bridge) return { reviewers: [], message: '' }
    try {
      const response = await bridge.request({ type: MessageType.LoadDictionary, payload: { kind: 'reviewer', force } })
      if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'reviewer') {
        const message = response.type === MessageType.Error
          ? response.payload.message
          : response.type === MessageType.DictionaryResult && !response.payload.ok
            ? response.payload.error.message
            : '审核人这次没有读到。'
        return { reviewers: [], message }
      }
      const people = response.payload.data.reviewers
      return { reviewers: people, message: people.length ? '' : '审核人名单是空的。' }
    } catch {
      return { reviewers: [], message: '审核人没有读到。' }
    }
  }

  return { ready, rules, mailTypes, senders, procs, reviewers, notice, load }
}
