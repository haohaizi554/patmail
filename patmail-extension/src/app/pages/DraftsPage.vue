<script setup lang="ts">
import { computed, ref } from 'vue'
import PageHead from '../../shell/components/PageHead.vue'
import { bg } from '../../shell/assets'
import { describeDraftState, describeTaskRecord } from '../record-status'
import { MessageType } from '../../shared/message'
import { sendToBackground } from '../../utils/runtime'
import { useWorkspace } from '../composables/useWorkspace'
import EmptyGuide from '../components/EmptyGuide.vue'

const { connection, tasks } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const drafts = computed(() => tasks.value.filter(item => item.status === 'DRY_RUN_COMPLETED' || item.status === 'READY' || item.status === 'CREATED' || item.status === 'STALE' || item.status === 'UNKNOWN' || item.status === 'PARTIAL_FAILURE'))
const lines = ref<Array<{ id: string; subject: string; state: string }>>([])
const message = ref('')

async function openDraft(taskId: string): Promise<void> {
  const response = await sendToBackground({
    type: MessageType.GetTask,
    payload: { origin: connection.value.easyOrigin, operatorId: connection.value.operatorId, taskId }
  })
  if (!response || response.type !== MessageType.TaskResult || !response.payload.task) {
    message.value = '没有读取到本地草稿。'
    lines.value = []
    return
  }
  const task = response.payload.task as {
    items?: Array<{ itemId?: string; status?: string; easyMailId?: string; mailDraftPreview?: { subject?: string } | null }>
    checkpoints?: Array<{ itemId?: string; stage?: string; verified?: boolean }>
  }
  lines.value = (task.items ?? []).map(item => {
    const checkpoint = (task.checkpoints ?? []).find(row => row.itemId === item.itemId && (row.verified || row.stage === 'MAIL_SAVE'))
    return {
      id: String(item.itemId ?? ''),
      subject: item.mailDraftPreview?.subject || '未生成标题',
      state: describeDraftState({
        status: String(item.status ?? ''),
        easyMailId: String(item.easyMailId ?? ''),
        stage: String(checkpoint?.stage ?? ''),
        verified: checkpoint?.verified === true
      })
    }
  })
  message.value = lines.value.length ? '' : '这个任务没有本地草稿。'
}
</script>

<template>
  <PageHead title="邮件草稿" desc="本地草稿来自发文计划，这里不会把任务完成当成已经发出。" :art="bg('规则配置好，发文更轻松.png')" />
  <section class="card">
    <h2>邮件草稿</h2>
    <p class="hint">本地草稿来自已保存的发文计划。这里不会把任务完成当成邮件已经发出。</p>
    <p v-if="!ready" class="empty">还没确认当前登录的人，草稿先不显示。</p>
    <EmptyGuide v-else-if="drafts.length === 0" text="还没有草稿。去发文任务里拼一封，计划保存之后会出现在这里。" action="去发文任务" hash="/tasks" />
    <table v-else class="grid">
      <thead><tr><th>客户</th><th>预计邮件</th><th>状态</th><th></th></tr></thead>
      <tbody>
        <tr v-for="task in drafts" :key="task.taskId">
          <td>{{ task.customerName || '未命名' }}</td>
          <td>{{ task.mailCount }}</td>
          <td>{{ describeTaskRecord(task.status) }}</td>
          <td><button type="button" class="ghost" @click="openDraft(task.taskId)">查看草稿</button></td>
        </tr>
      </tbody>
    </table>
    <p v-if="message" class="hint">{{ message }}</p>
    <ul v-if="lines.length">
      <li v-for="line in lines" :key="line.id">{{ line.subject }} · {{ line.state }}</li>
    </ul>
  </section>
</template>
