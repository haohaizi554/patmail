<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref } from 'vue'
import { createFullPageBridge } from './services/full-page-bridge'
import { useWorkspace } from './composables/useWorkspace'
import HomePage from './pages/HomePage.vue'
import FilesPage from './pages/FilesPage.vue'
import CustomersPage from './pages/CustomersPage.vue'
import TemplatesPage from './pages/TemplatesPage.vue'
import RulesPage from './pages/RulesPage.vue'
import TasksPage from './pages/TasksPage.vue'
import DraftsPage from './pages/DraftsPage.vue'
import WorkflowPage from './pages/WorkflowPage.vue'
import RecordsPage from './pages/RecordsPage.vue'
import AcceptancePage from './pages/AcceptancePage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import LimitsPage from './pages/LimitsPage.vue'
import Shell from '../../../src/components/Shell.vue'

const nav = [
  { name: '首页', path: 'home', hash: '/' },
  { name: '文件管理', path: 'file', hash: '/files' },
  { name: '期限监控', path: 'limit', hash: '/limits' },
  { name: '客户管理', path: 'users', hash: '/customers' },
  { name: '发文规则与映射配置', path: 'rule', hash: '/rules' },
  { name: '发文任务', path: 'task', hash: '/tasks' },
  { name: '发文记录', path: 'record', hash: '/records' },
  { name: '查询模板', path: 'chart', hash: '/templates' },
  { name: '邮件草稿', path: 'task', hash: '/drafts' },
  { name: '工作流', path: 'rule', hash: '/workflow' },
  { name: '接口验收', path: 'chart', hash: '/acceptance' },
  { name: '系统设置', path: 'chart', hash: '/settings' }
]
const pages = { '/': HomePage, '/files': FilesPage, '/limits': LimitsPage, '/customers': CustomersPage, '/templates': TemplatesPage, '/rules': RulesPage, '/tasks': TasksPage, '/drafts': DraftsPage, '/workflow': WorkflowPage, '/records': RecordsPage, '/acceptance': AcceptancePage, '/settings': SettingsPage }

function readRoute(): string {
  const path = location.hash.replace(/^#/, '') || '/'
  return nav.some(item => item.hash === path) ? path : '/'
}

const route = ref(readRoute())
const workspace = useWorkspace()
const selectedTab = ref<number | null>(null)
const search = ref('')
const pageName = computed(() => nav.find(item => item.hash === route.value)?.name ?? '首页')
const page = computed(() => pages[route.value as keyof typeof pages] ?? HomePage)
const profileName = computed(() => workspace.connection.value.displayName || '未登录')
const profileDept = computed(() => workspace.connection.value.sessionStatus === 'authenticated' ? 'EASY 已连接' : '尚未连接')

function go(name: string): void {
  const item = nav.find(entry => entry.name === name)
  if (item) location.hash = item.hash
}
provide('bridge', createFullPageBridge())

function onHash(): void { route.value = readRoute() }
async function refreshTabs(): Promise<void> {
  const payload = await workspace.call({ action: 'listTabs' })
  if (payload && payload.tabs.length === 1) selectedTab.value = payload.tabs[0].id
}
onMounted(() => {
  window.addEventListener('hashchange', onHash)
  void refreshTabs()
  void workspace.call({ action: 'load' })
})
onUnmounted(() => window.removeEventListener('hashchange', onHash))
</script>

<template>
  <Shell :page="pageName" :search="search" placeholder="搜索我方文号、客户或申请号..." :items="nav" :profile-name="profileName" :profile-dept="profileDept" :show-demo="false" @navigate="go" @update:search="search = $event" @settings="go('系统设置')">
    <section class="card" aria-label="EASY 连接">
      <div class="card-head">
        <h2>{{ workspace.connection.value.sessionStatus === 'authenticated' ? '已连接 EASY' : '尚未连接 EASY' }}</h2>
        <span v-if="workspace.demo" class="demo-flag">DEMO</span>
      </div>
      <p class="hint" v-if="workspace.connection.value.displayName">{{ workspace.connection.value.displayName }} · {{ workspace.connection.value.operatorId }}</p>
      <p class="hint">{{ workspace.notice.value }}</p>
      <div class="filters">
        <button type="button" class="ghost" @click="refreshTabs">刷新标签页</button>
        <button type="button" class="solid" @click="workspace.call({ action: 'openLogin' })">打开 EASY 登录页面</button>
        <button type="button" class="ghost" :disabled="selectedTab == null" @click="workspace.call({ action: 'bind', tabId: selectedTab! })">连接所选标签页</button>
        <button type="button" class="ghost" @click="workspace.call({ action: 'refreshSession' })">重新检测会话</button>
      </div>
      <div v-if="workspace.tabs.value.length" class="pm-form">
        <label v-for="tab in workspace.tabs.value" :key="tab.id">
          <span><input type="radio" name="easy-tab" :value="tab.id" v-model="selectedTab" /> {{ tab.title || tab.url }}</span>
        </label>
      </div>
    </section>
    <component :is="page" />
  </Shell>
</template>
