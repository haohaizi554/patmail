<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { describeItemRecord, describeTaskRecord } from '../record-status'
import { MessageType } from '../../shared/message'
import { sendToBackground } from '../../utils/runtime'
import { useWorkspace } from '../composables/useWorkspace'

const { connection, tasks, call } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const detail = ref<Record<string, unknown> | null>(null)
const detailMessage = ref('')
const evidenceMessage = ref('')

async function openTask(taskId: string): Promise<void> {
  const response = await sendToBackground({
    type: MessageType.GetTask,
    payload: { origin: connection.value.easyOrigin, operatorId: connection.value.operatorId, taskId }
  })
  if (!response || response.type !== MessageType.TaskResult || !response.payload.task) {
    detailMessage.value = response?.type === MessageType.Error ? response.payload.message : '没有读取到任务。'
    detail.value = null
    evidenceMessage.value = ''
    return
  }
  detail.value = response.payload.task
  detailMessage.value = ''
  const evidence = response.payload.currentEvidence
  evidenceMessage.value = evidence && typeof evidence === 'object' && evidence.requiresRevalidation === true && typeof evidence.message === 'string' ? evidence.message : ''
}

const items = computed(() => Array.isArray(detail.value?.items) ? detail.value.items as Array<Record<string, unknown>> : [])
const ruleRevision = computed(() => {
  const snapshot = detail.value?.ruleSnapshot
  return snapshot && typeof snapshot === 'object' && 'revision' in snapshot ? String((snapshot as { revision?: unknown }).revision ?? '') : ''
})
const identities = computed(() => Array.isArray(detail.value?.identitySnapshot) ? detail.value.identitySnapshot as Array<Record<string, unknown>> : [])
const issues = computed(() => Array.isArray(detail.value?.issues) ? detail.value.issues as Array<Record<string, unknown>> : [])
function draftSubject(item: Record<string, unknown>): string {
  const preview = item.mailDraftPreview
  if (!preview || typeof preview !== 'object') return ''
  return String((preview as { subject?: unknown }).subject ?? '')
}
onMounted(() => { if (ready.value) void call({ action: 'load' }) })
</script>

<template>
  <section v-if="!ready" class="pm-card"><p class="empty">尚未确认 EASY 用户。刷新页面后也不会加载其他账号的任务。</p></section>
  <template v-else>
    <section class="pm-card">
      <h2>发文任务</h2>
      <p class="hint">任务保存在扩展后台。Dry-run 只生成本地计划。Live Readonly 只读验收。Test Write 白名单为空。Production Write 保持关闭。</p>
      <p v-if="tasks.length === 0" class="empty">暂无任务</p>
      <table v-else class="pm-table">
        <thead><tr><th>客户</th><th>文件</th><th>预计邮件</th><th>状态</th><th>记录</th><th></th></tr></thead>
        <tbody>
          <tr v-for="task in tasks" :key="task.taskId">
            <td>{{ task.customerName || '未命名' }}</td>
            <td>{{ task.fileCount }}</td>
            <td>{{ task.mailCount }}</td>
            <td>{{ task.status }}</td>
            <td>{{ describeTaskRecord(task.status) }}</td>
            <td><button type="button" class="ghost" :aria-label="`${task.taskId} 详情`" @click="openTask(task.taskId)">详情</button></td>
          </tr>
        </tbody>
      </table>
    </section>
    <section v-if="detail" class="pm-card">
      <h2>任务详情</h2>
      <p v-if="evidenceMessage" class="hint" role="status">{{ evidenceMessage }}</p>
      <p class="hint">来源 Origin {{ String(detail.origin ?? '') }} · {{ String(detail.taskId) }} · {{ describeTaskRecord(String(detail.status ?? '')) }}</p>
      <p class="hint">客户 {{ String(detail.customerName ?? '') }} · 规则版本 {{ ruleRevision }} · 文件 {{ Array.isArray(detail.selectedFiles) ? detail.selectedFiles.length : 0 }} · 阶段 {{ String(detail.status ?? '') }}</p>
      <p v-if="issues.length" class="hint">阻塞：{{ issues.map(item => String(item.message ?? '')).filter(Boolean).join('；') }}</p>
      <ul v-if="identities.length" class="hint">
        <li v-for="row in identities" :key="String(row.profileId) + String(row.easyCustomerId)">配置 {{ row.profileName || row.profileId }} · EASY 客户 {{ row.easyCustomerId || '未绑定 GUID' }} · 模板 {{ row.baseTemplateId || '无' }}</li>
      </ul>
      <p v-if="items.length === 0" class="empty">这个任务没有邮件条目。</p>
      <table v-else class="pm-table">
        <thead><tr><th>文件</th><th>发文类型</th><th>草稿主题</th><th>当前阶段</th><th>说明</th></tr></thead>
        <tbody>
          <tr v-for="item in items" :key="String(item.itemId)">
            <td>{{ Array.isArray(item.fileNames) ? item.fileNames.join('、') : '' }}</td>
            <td>{{ item.mailTypeName || item.mailTypeId }}</td>
            <td>{{ draftSubject(item) }}</td>
            <td>{{ item.status }}</td>
            <td>{{ describeItemRecord(String(item.status ?? ''), String(item.easyMailId ?? '')) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
    <p v-if="detailMessage" class="hint">{{ detailMessage }}</p>
  </template>
</template>
