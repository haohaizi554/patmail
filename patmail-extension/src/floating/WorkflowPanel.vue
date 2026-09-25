<script setup lang="ts">
import { computed, ref } from 'vue'
import { MessageType, type MessageBridge } from '../shared/message'
import { MAIL_FLOW_TYPE } from '../workflow/contracts'
import { WORKFLOW_WRITES_ENABLED } from '../workflow/gate'
import type { WorkflowView } from '../workflow/types'

const props = defineProps<{ bridge?: MessageBridge; mailId: string; ready: boolean }>()
const view = ref<WorkflowView | null>(null)
const nodeId = ref('')
const reviewerId = ref('')
const urgencyId = ref('')
const remark = ref('')
const auditType = ref<'submit' | 'handover'>('submit')
const busy = ref(false)
const panelMessage = ref('')

const nodes = computed(() => view.value?.snapshot?.availableNodes ?? [])
const history = computed(() => view.value?.snapshot?.history ?? [])
const activity = computed(() => view.value?.snapshot?.activity ?? null)
const selfReviewer = computed(() => view.value?.plan?.self === true)

async function readFlow(): Promise<void> {
  if (!props.bridge || !props.ready || !props.mailId) return
  busy.value = true
  panelMessage.value = ''
  const response = await props.bridge.request({ type: MessageType.ReadWorkflow, payload: { mailId: props.mailId, flowType: MAIL_FLOW_TYPE } })
  busy.value = false
  if (response.type !== MessageType.WorkflowResult) {
    panelMessage.value = '流程没有返回记录。'
    return
  }
  view.value = response.payload.view
  urgencyId.value = response.payload.view.snapshot?.urgencyId ?? response.payload.view.snapshot?.urgencies[0]?.id ?? ''
  panelMessage.value = response.payload.view.blockers[0] ?? response.payload.view.record.lastError
}

async function refreshNodes(): Promise<void> {
  if (!props.bridge || !view.value?.record.executionId) return
  busy.value = true
  const response = await props.bridge.request({ type: MessageType.RefreshWorkflow, payload: { executionId: view.value.record.executionId } })
  busy.value = false
  if (response.type === MessageType.WorkflowResult) {
    view.value = response.payload.view
    panelMessage.value = response.payload.view.blockers[0] ?? ''
  }
}

async function preview(): Promise<void> {
  if (!props.bridge || !view.value?.record.executionId) return
  busy.value = true
  const response = await props.bridge.request({
    type: MessageType.PreviewWorkflow,
    payload: {
      executionId: view.value.record.executionId, nodeId: nodeId.value, reviewerId: reviewerId.value,
      auditType: auditType.value, remark: remark.value, urgencyId: urgencyId.value
    }
  })
  busy.value = false
  if (response.type === MessageType.WorkflowResult) {
    view.value = response.payload.view
    panelMessage.value = response.payload.view.blockers[0] ?? response.payload.view.record.lastError
  }
}
</script>

<template>
  <section class="file-card" aria-label="发文流程">
    <p class="mail-stage" role="status">{{ ready ? '流程读取' : '文件关联核验完成后才能读取流程' }}</p>
    <p class="hint">真实提交流程尚未开放。</p>
    <p v-if="WORKFLOW_WRITES_ENABLED" class="hint">写开关状态异常。</p>
    <p v-if="mailId" class="hint">EASY 邮件 ID：{{ mailId }}</p>
    <p v-if="view?.snapshot" class="hint">当前节点 {{ view.snapshot.currentNodeName || '空' }} · {{ view.snapshot.currentNodeCode || '无代码' }} · 状态 {{ view.snapshot.status ?? '未知' }}</p>
    <p v-if="view?.snapshot" class="hint">当前办理人 {{ view.snapshot.currentUserName || '空' }} · {{ view.snapshot.currentUserId || '无 GUID' }}</p>
    <p v-if="activity" class="hint">当前活动节点 {{ activity.nodeName || activity.nodeCode }} · {{ activity.auditUserName || '无办理人' }}</p>
    <p v-if="panelMessage" class="hint">{{ panelMessage }}</p>
    <ul v-if="history.length" class="hint">
      <li v-for="item in history" :key="item.historyId || item.auditTime">历史 {{ item.nodeName }} · {{ item.auditUserName }} · {{ item.auditType }} · {{ item.auditTime }} · {{ item.remark }}</li>
    </ul>
    <label v-if="nodes.length">下一节点
      <select v-model="nodeId">
        <option value="">请选择</option>
        <option v-for="node in nodes" :key="node.nodeId" :value="node.nodeId">{{ node.nodeName || node.nodeCode }} · {{ node.nodeId }}</option>
      </select>
    </label>
    <label v-if="nodes.length">审核人
      <select v-model="reviewerId">
        <option value="">请选择</option>
        <option v-for="reviewer in nodes.flatMap(node => node.reviewers)" :key="reviewer.id" :value="reviewer.id">{{ reviewer.name }} · {{ reviewer.id }}</option>
      </select>
    </label>
    <label v-if="view?.snapshot?.urgencies.length">缓急
      <select v-model="urgencyId">
        <option v-for="item in view.snapshot.urgencies" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
    </label>
    <label>备注<textarea v-model="remark" rows="2" /></label>
    <p v-if="view?.plan" class="hint">下一节点 {{ view.plan.node.nodeName }} · 办理人 {{ view.plan.reviewer.name }} · {{ selfReviewer ? '是本人' : '不是本人' }}</p>
    <p v-if="view?.plan?.params" class="hint">提交计划已生成。响应契约未核对，不会发出真实提交。</p>
    <button type="button" class="text-button" :disabled="!ready || busy" @click="readFlow">读取流程</button>
    <button type="button" class="text-button" :disabled="!view || busy" @click="refreshNodes">刷新节点</button>
    <button type="button" class="text-button" :disabled="!view || busy" @click="preview">选择下一节点</button>
    <button type="button" class="text-button" :disabled="!view || busy" @click="preview">选择审核人</button>
    <button type="button" class="text-button" :disabled="!view || busy" @click="preview">预览提交流程</button>
  </section>
</template>
