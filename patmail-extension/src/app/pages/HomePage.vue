<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import PageHead from '../../../../src/components/PageHead.vue'
import { bg, icon } from '../../../../src/assets'
import { useWorkspace } from '../composables/useWorkspace'
import EmptyGuide from '../components/EmptyGuide.vue'
import wechatQr from '../assets/wechat-qr.png'

const { connection, customers, tasks, rules } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const unknownCount = computed(() => tasks.value.filter(item => item.status === 'UNKNOWN').length)
const title = computed(() => connection.value.displayName ? `下午好，${connection.value.displayName}！` : '首页')
const qrOpen = ref(false)
const wechatButton = ref<HTMLButtonElement | null>(null)
const qrClose = ref<HTMLButtonElement | null>(null)

function closeQr(): void {
  qrOpen.value = false
  void nextTick(() => wechatButton.value?.focus())
}

watch(qrOpen, (open) => {
  if (open) void nextTick(() => qrClose.value?.focus())
})
</script>

<template>
  <PageHead :title="title" desc="今日已为您准备好了最新的发文任务，一起继续加油吧！" :art="bg('专注每一次发文，让知识更有力量.png')">
    <address class="page-contact">
      <button ref="wechatButton" type="button" class="contact-hit" :aria-expanded="qrOpen" aria-haspopup="dialog" @click="qrOpen = true">
        <span>WeChat</span><b>MemoryLeak2023</b>
      </button>
      <p><span>GitHub</span><a href="https://github.com/haohaizi554/patmail" target="_blank" rel="noreferrer">haohaizi554</a></p>
      <p><span>phone</span><a href="tel:15603838733">15603838733</a></p>
    </address>
  </PageHead>
  <Teleport to="body">
    <div v-if="qrOpen" class="qr-layer" @click.self="closeQr" @keydown.esc="closeQr">
      <div class="qr-card" role="dialog" aria-modal="true" aria-label="微信二维码">
        <button ref="qrClose" type="button" class="qr-close" aria-label="关闭" @click="closeQr">×</button>
        <img :src="wechatQr" alt="微信二维码，MemoryLeak2023" />
      </div>
    </div>
  </Teleport>
  <div v-if="!ready" class="card"><p class="empty">尚未连接 EASY。确认登录用户之前，这里不显示客户、任务或发送统计。</p></div>
  <template v-else>
    <div class="metric-row">
      <article class="metric tone-pink"><img :src="icon(0)" alt="" /><div><b>已保存客户</b><strong>{{ customers.length }}</strong></div></article>
      <article class="metric tone-blue"><img :src="icon(11)" alt="" /><div><b>已保存任务</b><strong>{{ tasks.length }}</strong></div></article>
      <article class="metric tone-orange"><img :src="icon(18)" alt="" /><div><b>结果未知</b><strong>{{ unknownCount }}</strong></div></article>
      <article class="metric tone-purple"><img :src="icon(17)" alt="" /><div><b>规则版本</b><strong>{{ rules?.revision ?? '—' }}</strong></div></article>
    </div>
    <section class="card">
      <div class="card-head"><h2><img :src="icon(11)" alt="" />最近任务</h2></div>
      <EmptyGuide v-if="tasks.length === 0" text="还没有发文任务。去发文任务里自己拼一封，或按工作流生成。" action="去发文任务" hash="/tasks" />
      <table v-else class="grid">
        <thead><tr><th>客户</th><th>文件</th><th>计划邮件</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-for="task in tasks" :key="task.taskId">
            <td>{{ task.customerName || '未命名' }}</td>
            <td>{{ task.fileCount }}</td>
            <td>{{ task.mailCount }}</td>
            <td><span class="chip">{{ task.status }}</span></td>
          </tr>
        </tbody>
      </table>
    </section>
  </template>
</template>
