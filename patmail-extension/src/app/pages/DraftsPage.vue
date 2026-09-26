<script setup lang="ts">
import { computed } from 'vue'
import { describeTaskRecord } from '../record-status'
import { useWorkspace } from '../composables/useWorkspace'

const { connection, tasks } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const drafts = computed(() => tasks.value.filter(item => item.status === 'DRY_RUN_COMPLETED' || item.status === 'READY' || item.status === 'CREATED'))
</script>

<template>
  <section class="pm-card">
    <h2>邮件草稿</h2>
    <p class="hint">这里只展示已保存在本地的计划。生成草稿不会创建 EASY 邮件。</p>
    <p v-if="!ready || drafts.length === 0" class="empty">暂无草稿</p>
    <table v-else class="pm-table">
      <thead><tr><th>客户</th><th>预计邮件</th><th>状态</th></tr></thead>
      <tbody>
        <tr v-for="task in drafts" :key="task.taskId">
          <td>{{ task.customerName || '未命名' }}</td>
          <td>{{ task.mailCount }}</td>
          <td>{{ describeTaskRecord(task.status) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
