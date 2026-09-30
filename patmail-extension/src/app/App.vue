<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, ref } from 'vue'
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
import CaseContactsPage from './pages/CaseContactsPage.vue'
import { CASE_CONTACT_CUSTOMER_NAME } from '../customer/skills'
import Shell from '../../../src/components/Shell.vue'
import AppDialog from './components/AppDialog.vue'

const nav = [
  { name: '首页', path: 'home', hash: '/' },
  { name: '文件管理', path: 'file', hash: '/files' },
  { name: '期限监控', path: 'limit', hash: '/limits' },
  { name: '客户管理', path: 'users', hash: '/customers' },
  { name: '发文映射', path: 'rule', hash: '/rules' },
  { name: '发文任务', path: 'task', hash: '/tasks' },
  { name: '发文记录', path: 'record', hash: '/records' },
  { name: '文件查询模板', path: 'chart', hash: '/templates' },
  { name: '邮件草稿', path: 'task', hash: '/drafts' },
  { name: '工作流', path: 'rule', hash: '/workflow' }
]
const hiddenRoutes = new Set(['/acceptance', '/settings', '/contacts'])
const pages = { '/': HomePage, '/files': FilesPage, '/limits': LimitsPage, '/customers': CustomersPage, '/contacts': CaseContactsPage, '/templates': TemplatesPage, '/rules': RulesPage, '/tasks': TasksPage, '/drafts': DraftsPage, '/workflow': WorkflowPage, '/records': RecordsPage, '/acceptance': AcceptancePage, '/settings': SettingsPage }

function readRoute(): string {
  const path = location.hash.replace(/^#/, '') || '/'
  return nav.some(item => item.hash === path) || hiddenRoutes.has(path) ? path : '/'
}

const route = ref(readRoute())
const scrollTops = new Map<string, number>()
const workspace = useWorkspace()

function workspaceScroller(): HTMLElement | null {
  return document.querySelector('.workspace')
}
const search = ref('')
const pageName = computed(() => route.value === '/settings' ? '系统设置' : route.value === '/contacts' ? CASE_CONTACT_CUSTOMER_NAME : nav.find(item => item.hash === route.value)?.name ?? '首页')
const page = computed(() => pages[route.value as keyof typeof pages] ?? HomePage)
const profileName = computed(() => workspace.connection.value.displayName || '未登录')
const profileDept = computed(() => workspace.connection.value.sessionStatus === 'authenticated' ? 'EASY 已连接' : '尚未连接')

function go(name: string): void {
  const item = nav.find(entry => entry.name === name)
  if (item) location.hash = item.hash
}

function onShellSettings(name: string): void {
  if (name === '系统设置') location.hash = '/settings'
}
provide('bridge', createFullPageBridge())

function onHash(): void {
  const scroller = workspaceScroller()
  if (scroller) scrollTops.set(route.value, scroller.scrollTop)
  route.value = readRoute()
  const next = route.value
  void nextTick(() => {
    const node = workspaceScroller()
    if (node) node.scrollTop = scrollTops.get(next) ?? 0
  })
}
onMounted(() => {
  window.addEventListener('hashchange', onHash)
  void workspace.call({ action: 'load' })
})
onUnmounted(() => window.removeEventListener('hashchange', onHash))
</script>

<template>
  <Shell :page="pageName" :search="search" placeholder="搜索我方文号、客户或申请号..." :items="nav" :profile-name="profileName" :profile-dept="profileDept" :show-demo="false" :show-settings="true" @navigate="go" @settings="onShellSettings" @update:search="search = $event">
    <KeepAlive>
      <component :is="page" :key="route" />
    </KeepAlive>
  </Shell>
  <AppDialog />
</template>
