<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { isQueryGuid } from '../../query/query-validator'
import { MessageType, type MessageBridge } from '../../shared/message'
import { MAIL_FLOW_TYPE } from '../../workflow/contracts'
import { WORKFLOW_WRITES_ENABLED } from '../../workflow/gate'
import type { WorkflowView } from '../../workflow/types'

const bridge = inject<MessageBridge>('bridge')
const mailId = ref('')
const message = ref('')
const view = ref<WorkflowView | null>(null)
const snapshot = computed(() => view.value?.snapshot ?? null)

async function readFlow(): Promise<void> {
  view.value = null
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
  if (response.type !== MessageType.WorkflowResult || !response.payload.view) {
    message.value = '没有读到流程。没有提交。'
    return
  }
  view.value = response.payload.view
  message.value = '已读取流程。审核人按 GUID 显示。没有提交。'
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
    <div v-if="snapshot" class="pm-form">
      <p>邮件 ID {{ snapshot.mailId }}</p>
      <p>当前节点 {{ snapshot.currentNodeName || '未返回' }} · {{ snapshot.currentNodeCode || '' }} · {{ snapshot.currentNodeId || '' }}</p>
      <p>当前处理人 ID {{ snapshot.currentUserId || '未返回' }}<span v-if="snapshot.currentUserName">（{{ snapshot.currentUserName }}）</span></p>
      <p>流程状态 {{ snapshot.status ?? '未返回' }} · 最后状态 {{ snapshot.versionToken || '未返回' }}</p>
      <h3>审核历史</h3>
      <p v-if="snapshot.history.length === 0" class="empty">没有审核历史。</p>
      <ul v-else>
        <li v-for="row in snapshot.history" :key="row.historyId || row.auditTime">{{ row.nodeName }} · 审核人 {{ row.auditUserId || '无 GUID' }} · {{ row.auditTime }}</li>
      </ul>
      <h3>候选下一节点</h3>
      <p v-if="snapshot.availableNodes.length === 0" class="empty">没有候选节点。</p>
      <ul v-else>
        <li v-for="node in snapshot.availableNodes" :key="node.listId || node.nodeId">
          {{ node.nodeName }} · {{ node.nodeId }}
          <span v-for="reviewer in node.reviewers" :key="reviewer.id"> · 审核人 {{ reviewer.id }}<template v-if="reviewer.name">（{{ reviewer.name }}）</template></span>
        </li>
      </ul>
    </div>
  </section>
</template>
