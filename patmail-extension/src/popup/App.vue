<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { isMessage, MessageType, type ContentRequest } from '../shared/message'
import { summarize, type ScanSummary } from '../shared/types'
import { sendToBackground } from '../utils/runtime'

const summary = ref<ScanSummary | null>(null)
const hint = ref('打开普通网页后，右侧会自动出现浮窗。')
const busy = ref(false)
const workerStatus = ref<'checking' | 'ready' | 'unavailable'>('checking')

/** Chrome 内部页与商店页受浏览器保护，不能注入 Content Script。 */
function supportedUrl(value: string | undefined): boolean {
  if (!value) return false
  const url = new URL(value)
  return ['http:', 'https:', 'file:'].includes(url.protocol) &&
    url.hostname !== 'chromewebstore.google.com' &&
    !(url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'))
}

async function act(type: 'SCAN_PAGE' | 'SHOW_PANEL'): Promise<void> {
  busy.value = true
  summary.value = null
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id === undefined || !supportedUrl(tab.url)) {
      hint.value = '此页面不允许插件注入，请切换到普通网页。'
      return
    }
    const request: ContentRequest = { type }
    const response: unknown = await chrome.tabs.sendMessage(tab.id, request, { frameId: 0 })
    if (!isMessage(response)) throw new Error('无效响应')
    if (response.type === MessageType.Error) {
      hint.value = response.payload.message
    } else if (type === MessageType.ScanPage && response.type === MessageType.ScanResult) {
      summary.value = summarize(response.payload)
      hint.value = '已扫描当前页面。'
    } else if (type === MessageType.ShowPanel && response.type === MessageType.PanelShown) {
      hint.value = '浮窗已在当前页面打开。'
    } else {
      hint.value = '页面返回了意外结果，请刷新网页后再试。'
    }
  } catch {
    hint.value = '无法连接当前页，请刷新网页后重试。若为本地文件，请在扩展详情中允许访问文件网址。'
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  const response = await sendToBackground({ type: MessageType.Ping })
  workerStatus.value = response?.type === MessageType.Pong ? 'ready' : 'unavailable'
})
</script>

<template>
  <main class="popup">
    <header><h1>PatMail</h1><span>页面助手</span></header>
    <p class="worker">{{ workerStatus === 'ready' ? '插件运行中' : workerStatus === 'checking' ? '正在连接后台…' : '后台连接失败，请重新加载扩展' }}</p>
    <p class="hint" role="status">{{ hint }}</p>
    <div class="actions">
      <button type="button" :disabled="busy" @click="act(MessageType.ScanPage)">扫描当前页面</button>
      <button type="button" class="secondary" :disabled="busy" @click="act(MessageType.ShowPanel)">打开浮窗</button>
    </div>
    <section v-if="summary" aria-label="扫描结果">
      <p class="title">{{ summary.title || '（无标题）' }}</p>
      <p class="url">{{ summary.url }}</p>
      <ul>
        <li>input：{{ summary.inputCount }}</li>
        <li>select：{{ summary.selectCount }}</li>
        <li>button：{{ summary.buttonCount }}</li>
      </ul>
    </section>
    <p class="footnote">仅扫描当前页面 · 不会填写或提交表单</p>
  </main>
</template>

<style>
body { margin: 0; }
* { box-sizing: border-box; }
.popup { width: 320px; padding: 20px; font: 13px/1.6 "Microsoft YaHei", sans-serif; color: #55415f; background: #fff8fc; }
header { display: flex; justify-content: space-between; align-items: center; }
h1 { margin: 0; font-size: 22px; color: #ba6797; }
header span, .footnote { color: #a18aaa; font-size: 11px; }
.worker { color: #698b73; margin: 5px 0 15px; }
.hint { min-height: 42px; }
.actions { display: flex; gap: 8px; }
button { border: 1px solid #d984b0; background: #d984b0; color: white; border-radius: 9px; min-height: 36px; padding: 0 11px; cursor: pointer; font: inherit; }
button.secondary { background: #f7effc; color: #976ca3; border-color: #e7d1eb; }
button:disabled { opacity: .6; cursor: wait; }
button:focus-visible { outline: 2px solid #9d64b5; outline-offset: 2px; }
section { margin-top: 15px; padding: 12px; background: white; border: 1px solid #efdfea; border-radius: 10px; }
.title { margin: 0; font-weight: 600; }
.url { overflow-wrap: anywhere; color: #8e7d98; font-size: 11px; }
ul { display: flex; gap: 12px; list-style: none; padding: 0; margin-bottom: 0; }
.footnote { margin: 16px 0 0; }
</style>

