<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import PageHead from '../../shell/components/PageHead.vue'
import { bg, icon } from '../../shell/assets'
import { greetingForHour } from '../greeting'
import { barWidth, homeReport } from '../home-report'
import { pickHomeLine } from '../home-lines'
import { readLimitMailLedger } from '../../customer/limit-mail-submit'
import { useWorkspace } from '../composables/useWorkspace'
import EmptyGuide from '../components/EmptyGuide.vue'
import wechatQr from '../assets/wechat-qr.png'

const { connection, customers, tasks } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const report = computed(() => homeReport({
  customers: customers.value,
  tasks: tasks.value,
  ledger: readLimitMailLedger()
}))
const now = ref(new Date())
let clock = 0
onMounted(() => {
  clock = window.setInterval(() => {
    now.value = new Date()
  }, 60_000)
})
onUnmounted(() => window.clearInterval(clock))
const title = computed(() => {
  const name = connection.value.displayName
  return name ? `${greetingForHour(now.value.getHours())}，${name}！` : '首页'
})
const desc = pickHomeLine()
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
  <PageHead :title="title" :desc="desc" :art="bg('专注每一次发文，让知识更有力量.png')">
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
    <section class="home-report" aria-label="发文报表">
      <div class="metric-row">
        <article class="metric tone-green"><img :src="icon(11)" alt="" /><div><b>本页已交审核</b><strong>{{ report.submitted }}</strong><small>这个标签页里的事项</small></div></article>
        <article class="metric tone-pink"><img :src="icon(18)" alt="" /><div><b>待发任务</b><strong>{{ report.pendingTasks }}</strong><small>计划 {{ report.letters }} 封 · {{ report.files }} 个文件</small></div></article>
        <article class="metric tone-orange"><img :src="icon(17)" alt="" /><div><b>结果未知</b><strong>{{ report.unknownTasks }}</strong><small>不能自动再提交</small></div></article>
        <article class="metric tone-blue"><img src="/assets/icons/img_customer.png" alt="" /><div><b>在册客户</b><strong>{{ report.customers }}</strong><small>PCT {{ report.workflows[0]?.count ?? 0 }} · 鹏城 {{ report.workflows[1]?.count ?? 0 }}</small></div></article>
      </div>
      <div class="report-board">
        <article>
          <h2>发文任务</h2>
          <ul>
            <li v-for="item in report.tasks" :key="item.label">
              <span>{{ item.label }}</span>
              <i><b :class="item.tone" :style="{ width: barWidth(item.count, report.tasks) + '%' }"></b></i>
              <strong>{{ item.count }}</strong>
            </li>
          </ul>
        </article>
        <article>
          <h2>客户工作流</h2>
          <ul>
            <li v-for="item in report.workflows" :key="item.label">
              <span>{{ item.label }}</span>
              <i><b :class="item.tone" :style="{ width: barWidth(item.count, report.workflows) + '%' }"></b></i>
              <strong>{{ item.count }}</strong>
            </li>
          </ul>
        </article>
        <article>
          <h2>本页发文</h2>
          <ul>
            <li v-for="item in report.ledger" :key="item.label">
              <span>{{ item.label }}</span>
              <i><b :class="item.tone" :style="{ width: barWidth(item.count, report.ledger) + '%' }"></b></i>
              <strong>{{ item.count }}</strong>
            </li>
          </ul>
          <p>账本只留在这个标签页，关掉就清空。</p>
        </article>
      </div>
    </section>
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
