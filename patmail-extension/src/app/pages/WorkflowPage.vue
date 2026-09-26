<script setup lang="ts">
import { inject, ref } from 'vue'
import { isQueryGuid } from '../../query/query-validator'
import { MessageType, type MessageBridge } from '../../shared/message'
import { MAIL_FLOW_TYPE } from '../../workflow/contracts'
import { WORKFLOW_WRITES_ENABLED } from '../../workflow/gate'

const bridge = inject<MessageBridge>('bridge')
const mailId = ref('')
const message = ref('')
const snapshot = ref('')

async function readFlow(): Promise<void> {
  snapshot.value = ''
  if (!isQueryGuid(mailId.value.trim())) {
    message.value = 'BLOCKED：请先填写已有 EASY 邮件 ID。没有提交。'
    return
  }
  if (!bridge) {
    message.value = '没有 EASY 通道。没有提交。'
    return
  }
  const response = await bridge.request({ type: MessageType.ReadWorkflow, payload: { mailId: mailId.value.trim(), flowType: MAIL_FLOW_TYPE } })
  if (response.type === MessageType.Error) {
    message.value = response.payload.message
    return
  }
  message.value = '已读取流程。没有提交。'
  snapshot.value = JSON.stringify(response.payload).slice(0, 500)
}
</script>

<template>
  <section class="pm-card">
    <h2>工作流</h2>
    <p class="hint">只读 GetFlowInfo、GetFlowHistory、GetFlowSubmit、GetFlowLastStatus。默认不提交。写开关：{{ WORKFLOW_WRITES_ENABLED ? '异常开启' : '关闭' }}</p>
    <form class="pm-form" @submit.prevent="readFlow">
      <label>已有邮件 ID <input v-model="mailId" type="text" /></label>
      <button class="solid" type="submit">只读流程</button>
    </form>
    <p v-if="message" class="hint">{{ message }}</p>
    <p v-if="snapshot" class="hint">{{ snapshot }}</p>
    <p v-else class="empty">暂无记录</p>
  </section>
</template>
