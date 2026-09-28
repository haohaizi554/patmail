import { MessageType, type MessageBridge } from '../shared/message'

export async function fetchMailTypeNodes(bridge: MessageBridge, force: boolean): Promise<{ nodes: Array<{ id: string; name: string }>; message: string }> {
  try {
    const response = await bridge.request({ type: MessageType.LoadDictionary, payload: { kind: 'mailType', force } })
    if (response.type === MessageType.Error) return { nodes: [], message: response.payload.message }
    if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'mailType') {
      const message = response.type === MessageType.DictionaryResult && !response.payload.ok
        ? response.payload.error.message
        : '发文类型没有从原网站读到。'
      return { nodes: [], message }
    }
    return { nodes: response.payload.data.nodes.map(node => ({ id: node.id, name: node.name })), message: '' }
  } catch {
    return { nodes: [], message: '读取发文类型失败。' }
  }
}
