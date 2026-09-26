<script setup lang="ts">
import { computed } from 'vue'
import { describeTaskRecord } from '../record-status'
import { useWorkspace } from '../composables/useWorkspace'

const { connection, tasks } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
</script>

<template>
  <section class="pm-card">
    <h2>发文记录</h2>
    <p class="hint">记录从已保存任务推导。没有发送核验时，不会显示已成功发送。</p>
    <p v-if="!ready || tasks.length === 0" class="empty">暂无记录</p>
    <table v-else class="pm-table">
      <thead><tr><th>时间</th><th>客户</th><th>状态</th><th>说明</th></tr></thead>
      <tbody>
        <tr v-for="task in tasks" :key="task.taskId">
          <td>{{ task.updatedAt || task.createdAt }}</td>
          <td>{{ task.customerName || '未命名' }}</td>
          <td>{{ task.status }}</td>
          <td>{{ describeTaskRecord(task.status) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
