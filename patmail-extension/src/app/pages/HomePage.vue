<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspace } from '../composables/useWorkspace'

const { connection, customers, tasks, rules } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const unknownCount = computed(() => tasks.value.filter(item => item.status === 'UNKNOWN').length)
</script>

<template>
  <div v-if="!ready" class="pm-card"><p class="empty">尚未连接 EASY。确认登录用户之前，这里不显示客户、任务或发送统计。</p></div>
  <template v-else>
    <div class="pm-metrics">
      <article class="pm-metric"><b>已保存客户</b><strong>{{ customers.length }}</strong></article>
      <article class="pm-metric"><b>已保存任务</b><strong>{{ tasks.length }}</strong></article>
      <article class="pm-metric"><b>结果未知</b><strong>{{ unknownCount }}</strong></article>
      <article class="pm-metric"><b>规则版本</b><strong>{{ rules?.revision ?? '—' }}</strong></article>
    </div>
    <section class="pm-card">
      <h2>最近任务</h2>
      <p v-if="tasks.length === 0" class="empty">暂无记录</p>
      <table v-else class="pm-table">
        <thead><tr><th>客户</th><th>文件</th><th>计划邮件</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-for="task in tasks" :key="task.taskId">
            <td>{{ task.customerName || '未命名' }}</td>
            <td>{{ task.fileCount }}</td>
            <td>{{ task.mailCount }}</td>
            <td><span class="status-pill">{{ task.status }}</span></td>
          </tr>
        </tbody>
      </table>
    </section>
  </template>
</template>
