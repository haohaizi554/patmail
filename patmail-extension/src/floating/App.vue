<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import { MessageType, type ContentResponse, type MessageBridge } from '../shared/message'
import { summarize, type PageSnapshot, type ScanSummary } from '../shared/types'
import DebugViewer from './DebugViewer.vue'
import FileSearchPanel from './FileSearchPanel.vue'
import { copySnapshot } from './copySnapshot'
import { usePanelDrag } from './usePanelDrag'
import { isEasyOrigin, trustedOrigin } from '../api/config'
import { sendToBackground } from '../utils/runtime'

const bridge = inject<MessageBridge>('bridge')
const closePanel = inject<() => void>('closePanel')
const panel = ref<HTMLElement | null>(null)
const collapsed = ref(false)
const activeTab = ref<'files' | 'scan'>('scan')
const { position, dragging, onPointerDown } = usePanelDrag(panel, collapsed)

const url = ref('')
const title = ref('')
const summary = ref<ScanSummary | null>(null)
const snapshot = ref<PageSnapshot | null>(null)
const showDom = ref(false)
const loadingInfo = ref(true)
const scanning = ref(false)
const errorText = ref('')
const copyText = ref('')
const backgroundStatus = ref<'checking' | 'ready' | 'unavailable'>('checking')
const backgroundError = ref('')
const openingWorkspace = ref(false)
const workspaceNote = ref('')
const fileSearchAvailable = computed(() => trustedOrigin(url.value) !== null)
watch(activeTab, async () => {
  await nextTick()
  const body = panel.value?.querySelector<HTMLElement>('.body')
  if (body) body.scrollTop = 0
})
const statusText = computed(() => {
  if (backgroundStatus.value === 'checking') return '正在连接后台'
  if (backgroundStatus.value === 'unavailable') return '后台连接失败'
  if (loadingInfo.value) return '正在读取当前页面'
  return url.value ? '插件运行中' : '页面读取失败'
})

function responseError(message: ContentResponse): string {
  return message.type === MessageType.Error ? message.payload.message : '页面通信返回了意外结果'
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function checkBackground(): Promise<void> {
  if (!bridge) {
    backgroundError.value = '页面通信不可用'
    backgroundStatus.value = 'unavailable'
    return
  }
  try {
    const message = await bridge.request({ type: MessageType.Ping })
    if (message.type !== MessageType.Pong || !message.payload.ok) {
      backgroundError.value = responseError(message)
      backgroundStatus.value = 'unavailable'
      return
    }
    backgroundStatus.value = 'ready'
  } catch (error) {
    backgroundError.value = `后台连接失败：${failureText(error)}`
    backgroundStatus.value = 'unavailable'
  }
}

async function loadPageInfo(): Promise<void> {
  if (!bridge) {
    errorText.value = '页面通信不可用'
    loadingInfo.value = false
    return
  }
  try {
    const message = await bridge.request({ type: MessageType.GetPageInfo })
    if (message.type !== MessageType.PageInfo || !message.payload) {
      errorText.value = responseError(message)
      return
    }
    url.value = message.payload.url
    title.value = message.payload.title
    if (isEasyOrigin(new URL(message.payload.url).origin)) activeTab.value = 'files'
  } catch (error) {
    errorText.value = `读取页面信息失败：${failureText(error)}`
  } finally {
    loadingInfo.value = false
  }
}

async function copyJson(): Promise<void> {
  if (!snapshot.value || !panel.value) return
  copyText.value = ''
  try {
    copyText.value = await copySnapshot(snapshot.value, panel.value)
      ? '完整 JSON 已复制' : '复制失败，请检查浏览器剪贴板权限'
  } catch {
    copyText.value = '复制失败，请检查浏览器剪贴板权限'
  }
}

async function openWorkspace(): Promise<void> {
  if (openingWorkspace.value) return
  openingWorkspace.value = true
  workspaceNote.value = ''
  try {
    const response = await sendToBackground({ type: MessageType.Workspace, payload: { action: 'focus' } })
    workspaceNote.value = response?.type === MessageType.WorkspaceResult
      ? response.payload.message
      : '没有打开工作台，请在扩展管理里重新加载 PatMail。'
  } catch {
    workspaceNote.value = '没有打开工作台。'
  } finally {
    openingWorkspace.value = false
  }
}

async function scan(): Promise<void> {
  if (scanning.value) return
  if (!bridge) {
    errorText.value = '页面通信不可用'
    return
  }
  scanning.value = true
  errorText.value = ''
  copyText.value = ''
  try {
    const message = await bridge.request({ type: MessageType.ScanPage })
    if (message.type !== MessageType.ScanResult || !message.payload) {
      errorText.value = responseError(message)
      return
    }
    snapshot.value = message.payload
    summary.value = summarize(message.payload)
    url.value = message.payload.page.url
    title.value = message.payload.page.title
  } catch (error) {
    errorText.value = `扫描失败：${failureText(error)}`
  } finally {
    scanning.value = false
  }
}

function toggleDom(): void {
  showDom.value = !showDom.value
  if (showDom.value && !snapshot.value) void scan()
}

onMounted(() => {
  void checkBackground()
  void loadPageInfo()
})
</script>

<template>
  <section
    ref="panel"
    class="panel"
    :class="{ collapsed, dragging }"
    :style="{ top: position.top + 'px', right: position.right + 'px' }"
    aria-label="PatMail 悬浮面板"
  >
    <header class="bar" @pointerdown="onPointerDown">
      <div class="brand"><span class="brand-mark">✦</span><strong>PatMail</strong></div>
      <div class="actions">
        <button type="button" :aria-label="collapsed ? '展开面板' : '收起面板'" v-hint="collapsed ? '展开' : '收起'" @click="collapsed = !collapsed">{{ collapsed ? '▢' : '−' }}</button>
        <button type="button" aria-label="关闭面板" v-hint="'关闭'" @click="closePanel?.()">×</button>
      </div>
    </header>
    <div v-if="!collapsed" class="body">
      <div class="intro">
        <span class="eyebrow">PAGE COMPANION</span>
        <p class="status"><span class="status-dot" :class="{ 'status-dot-error': backgroundStatus === 'unavailable' }"></span>{{ statusText }}</p>
      </div>

      <nav class="panel-tabs" aria-label="PatMail 功能">
        <button type="button" :class="{ active: activeTab === 'files' }" :disabled="!fileSearchAvailable" @click="activeTab = 'files'">文件查询</button>
        <button type="button" :class="{ active: activeTab === 'scan' }" @click="activeTab = 'scan'">页面扫描</button>
      </nav>
      <button type="button" class="secondary workspace-entry" :disabled="openingWorkspace" @click="openWorkspace">{{ openingWorkspace ? '正在打开…' : '打开工作台' }}</button>
      <p v-if="workspaceNote" class="copy-status" role="status">{{ workspaceNote }}</p>

      <FileSearchPanel v-if="activeTab === 'files' && fileSearchAvailable" />
      <template v-if="activeTab === 'scan'">

      <section class="card page-card" aria-label="当前页面">
        <span class="field-label">当前页面</span>
        <p class="value url">{{ url || (loadingInfo ? '读取中…' : '暂无页面地址') }}</p>
        <span class="field-label title-label">页面标题</span>
        <p class="value">{{ title || (loadingInfo ? '读取中…' : '（无标题）') }}</p>
      </section>

      <div class="buttons">
        <button type="button" class="primary" :disabled="scanning" @click="scan">{{ scanning ? '扫描中…' : '扫描页面' }}</button>
        <button type="button" class="secondary" :aria-expanded="showDom" @click="toggleDom">{{ showDom ? '收起 DOM' : '查看 DOM' }}</button>
        <button type="button" class="secondary" :disabled="!snapshot" @click="copyJson">复制 JSON</button>
      </div>
      <p v-if="copyText" class="copy-status" role="status">{{ copyText }}</p>
      <p v-if="backgroundError" class="error" role="alert">{{ backgroundError }}</p>
      <p v-if="errorText" class="error" role="alert">{{ errorText }}</p>

      <section v-if="summary" class="card results" aria-label="扫描结果">
        <div class="section-heading"><span class="eyebrow">SCAN RESULT</span><span class="result-note">当前页面</span></div>
        <div class="counts">
          <div><strong>{{ summary.inputCount }}</strong><span>inputs</span></div>
          <div><strong>{{ summary.selectCount }}</strong><span>selects</span></div>
          <div><strong>{{ summary.buttonCount }}</strong><span>buttons</span></div>
        </div>
        <p class="result-meta">控件 {{ summary.totalControls }} · textarea {{ summary.textareaCount }} · 可见 {{ summary.visibleCount }} · 隐藏 {{ summary.hiddenCount }} · 语义识别 {{ summary.semanticResolved }}</p>
        <p class="result-meta">{{ summary.hostname || '—' }} · {{ summary.title || '（无标题）' }}</p>
      </section>

      <DebugViewer v-if="showDom && snapshot" :snapshot="snapshot" />
      <p v-else-if="showDom" class="empty">{{ scanning ? '正在读取页面结构…' : '扫描页面后可查看结构化结果。' }}</p>
      </template>
    </div>
  </section>
</template>
