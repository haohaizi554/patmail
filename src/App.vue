<script setup>
import { computed, provide, ref, watch } from 'vue'
import Shell from './components/Shell.vue'
import HomePage from './pages/HomePage.vue'
import TaskPage from './pages/TaskPage.vue'
import RulePage from './pages/RulePage.vue'
import CustomerPage from './pages/CustomerPage.vue'
import FilePage from './pages/FilePage.vue'
import RecordPage from './pages/RecordPage.vue'
import StatsPage from './pages/StatsPage.vue'
import FloatPage from './pages/FloatPage.vue'

const views = {
  首页: HomePage,
  发文任务: TaskPage,
  发文规则与映射配置: RulePage,
  客户管理: CustomerPage,
  文件管理: FilePage,
  发文记录: RecordPage,
  统计报表: StatsPage,
  浮窗: FloatPage
}
const page = ref(decodeURIComponent(location.hash.slice(1)) || '首页')
const search = ref('')
const toast = ref('')
const modal = ref('')
let timer
if (!views[page.value]) page.value = '首页'

function go(name) {
  page.value = name
  location.hash = encodeURIComponent(name)
  window.scrollTo(0, 0)
}
function notify(message) {
  toast.value = message
  clearTimeout(timer)
  timer = setTimeout(() => { toast.value = '' }, 2400)
}
function open(title) { modal.value = title }
window.addEventListener('hashchange', () => {
  const next = decodeURIComponent(location.hash.slice(1)) || '首页'
  page.value = views[next] ? next : '首页'
})
watch(page, () => { search.value = '' })

const ui = { search, notify, open, go }
provide('ui', ui)

const view = computed(() => views[page.value])
const placeholder = computed(() => ({
  客户管理: '搜索客户、联系人、行业、备注...',
  发文记录: '搜索客户、批次、邮件主题、申请号...',
  发文任务: '搜索任务名称、客户或文件...'
}[page.value] || '搜索客户、任务、文件、模板...'))
</script>

<template>
  <FloatPage v-if="page === '浮窗'" />
  <Shell v-else :page="page" :search="search" :placeholder="placeholder" @navigate="go" @update:search="search = $event" @settings="open">
    <component :is="view" />
  </Shell>
  <div v-if="toast" class="toast">{{ toast }}</div>
  <div v-if="modal" class="mask" @click.self="modal = ''">
    <div class="dialog">
      <header><h3>{{ modal }}</h3><button @click="modal = ''">×</button></header>
      <p>请确认信息后继续。此操作为前端演示，不会提交到业务系统。</p>
      <label>名称<input :value="modal" /></label>
      <label>备注<textarea rows="3" placeholder="请输入备注" /></label>
      <footer><button class="ghost" @click="modal = ''">取消</button><button class="solid" @click="notify(modal + ' 已保存'); modal = ''">保存</button></footer>
    </div>
  </div>
</template>
