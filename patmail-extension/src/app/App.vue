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

const nav = [
  { path: '/', label: '首页' },
  { path: '/files', label: '文件查询' },
  { path: '/customers', label: '客户管理' },
  { path: '/templates', label: '查询模板' },
  { path: '/rules', label: '发文规则' },
  { path: '/tasks', label: '发文任务' },
  { path: '/drafts', label: '邮件草稿' },
  { path: '/workflow', label: '工作流' },
  { path: '/records', label: '发文记录' },
  { path: '/acceptance', label: '接口验收' },
  { path: '/settings', label: '系统设置' }
]
const pages = { '/': HomePage, '/files': FilesPage, '/customers': CustomersPage, '/templates': TemplatesPage, '/rules': RulesPage, '/tasks': TasksPage, '/drafts': DraftsPage, '/workflow': WorkflowPage, '/records': RecordsPage, '/acceptance': AcceptancePage, '/settings': SettingsPage }

function readRoute(): string {
  const path = location.hash.replace(/^#/, '') || '/'
  return nav.some(item => item.path === path) ? path : '/'
}

const route = ref(readRoute())
const workspace = useWorkspace()
const selectedTab = ref<number | null>(null)
const title = computed(() => nav.find(item => item.path === route.value)?.label ?? '首页')
const page = computed(() => pages[route.value as keyof typeof pages] ?? HomePage)
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
  <div class="pm-shell">
    <nav class="pm-side" aria-label="工作台导航">
      <div class="pm-brand">
        <span class="pm-mark" aria-hidden="true">P</span>
        <div><strong>PatMail</strong><small>发文工作台</small></div>
      </div>
      <a v-for="item in nav" :key="item.path" :href="`#${item.path}`" :class="{ active: route === item.path }">{{ item.label }}</a>
    </nav>
    <main class="pm-main">
      <header class="pm-top">
        <h1>{{ title }}</h1>
        <span v-if="workspace.demo" class="demo-flag">DEMO</span>
      </header>
      <section class="pm-card" aria-label="EASY 连接">
        <h2>{{ workspace.connection.value.sessionStatus === 'authenticated' ? '已连接 EASY' : '尚未连接 EASY' }}</h2>
        <p class="hint" v-if="workspace.connection.value.displayName">{{ workspace.connection.value.displayName }} · {{ workspace.connection.value.operatorId }}</p>
        <p class="hint">{{ workspace.notice.value }}</p>
        <div class="pm-row">
          <button type="button" class="ghost" @click="refreshTabs">刷新标签页</button>
          <button type="button" class="solid" @click="workspace.call({ action: 'openLogin' })">打开 EASY 登录页面</button>
          <button type="button" class="ghost" :disabled="selectedTab == null" @click="workspace.call({ action: 'bind', tabId: selectedTab! })">连接所选标签页</button>
          <button type="button" class="ghost" @click="workspace.call({ action: 'refreshSession' })">重新检测会话</button>
        </div>
        <div v-if="workspace.tabs.value.length" class="pm-form" style="margin-top: 10px">
          <label v-for="tab in workspace.tabs.value" :key="tab.id">
            <span><input type="radio" name="easy-tab" :value="tab.id" v-model="selectedTab" /> {{ tab.title || tab.url }}</span>
          </label>
        </div>
      </section>
      <component :is="page" />
    </main>
  </div>
</template>

<style src="../floating/style.css"></style>
