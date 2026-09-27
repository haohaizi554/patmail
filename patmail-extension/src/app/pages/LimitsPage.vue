<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import LimitPage from '../../../../src/pages/LimitPage.vue'
import LimitQuerySection from '../../floating/LimitQuerySection.vue'
import type { LimitMonitorResult, LimitMonitorRow } from '../../api/limit-monitor-types'
import { isLimitMonitorType } from '../../api/limit-monitor-params'
import { MessageType, type MessageBridge } from '../../shared/message'
import { useWorkspace } from '../composables/useWorkspace'

const bridge = inject<MessageBridge>('bridge')
const { connection } = useWorkspace()
const connected = computed(() => connection.value.sessionStatus === 'authenticated')
const loading = ref(false)
const message = ref('')
const rows = ref<LimitMonitorRow[]>([])
const total = ref(0)

function textFor(code: string, fallback: string): string {
  if (code === 'SESSION_EXPIRED') return 'EASY 登录已失效，请在原网站重新登录后检测。'
  if (code === 'HTTP_ERROR') return 'EASY 暂时没有返回列表，可以再查一次。'
  if (code === 'INVALID_QUERY') return fallback || '请输入查询条件。'
  return fallback || '期限查询失败，请稍后重试。'
}

async function search(input: { type: string; caseVolume?: string; applicationNo?: string; customerName?: string; ctrlProcId?: string; fields?: Record<string, string>; reset?: boolean }): Promise<void> {
  rows.value = []
  total.value = 0
  if (input.reset) {
    message.value = ''
    return
  }
  if (!bridge || !connected.value) {
    message.value = '尚未连接 EASY。'
    return
  }
  if (!isLimitMonitorType(input.type)) {
    message.value = '这个页签还不能查询。'
    return
  }
  loading.value = true
  message.value = ''
  try {
    const response = await bridge.request({
      type: MessageType.SearchLimitMonitor,
      payload: {
        query: {
          type: input.type,
          caseVolume: input.caseVolume ?? '',
          applicationNo: input.applicationNo ?? '',
          customerName: input.customerName ?? '',
          ...(input.ctrlProcId ? { ctrlProcId: input.ctrlProcId } : {}),
          ...(input.fields ? { fields: input.fields } : {}),
          pageIndex: 1,
          pageSize: 10
        }
      }
    })
    if (response.type === MessageType.Error) {
      message.value = response.payload.message
      return
    }
    if (response.type !== MessageType.SearchLimitMonitorResult) {
      message.value = '期限查询返回了意外结果。'
      return
    }
    const payload = response.payload
    if (!payload.ok) {
      message.value = textFor(payload.error.code, payload.error.message)
      return
    }
    const data: LimitMonitorResult = payload.data
    rows.value = data.items
    total.value = data.total
    message.value = data.items.length ? '' : '这个条件下没有期限记录。'
  } catch {
    message.value = '期限查询失败，请重试。'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <LimitPage live hide-form :rows="rows" :total="total" :loading="loading" :message="message" :connected="connected">
    <section v-if="!connected" class="card"><p class="empty">尚未确认 EASY 用户，不能读取期限模板。</p></section>
    <LimitQuerySection v-else :bridge="bridge" :user-id="connection.operatorId" :can-search="connected && !loading" @search="search" />
  </LimitPage>
</template>
