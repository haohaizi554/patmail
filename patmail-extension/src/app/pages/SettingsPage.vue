<script setup lang="ts">
import { computed, ref } from 'vue'
import PageHead from '../../shell/components/PageHead.vue'
import ThemeSelect from '../../shell/components/ThemeSelect.vue'
import { bg } from '../../shell/assets'
import { AVATAR_PRESET_IDS, presetAvatarUrl } from '../../settings/avatar'
import { useAccountAvatar } from '../../settings/use-account-avatar'
import { useAgentConfig } from '../../settings/use-agent-config'
import { confirmDialog } from '../dialog'
import { useMailConcurrency } from '../../settings/use-mail-concurrency'
import { useWriteSwitch } from '../../settings/use-write-switch'
import { sendToBackground } from '../../utils/runtime'
import { MessageType } from '../../shared/message'

const { open, ready, setOpen } = useWriteSwitch()
const { concurrency, ready: concurrencyReady, setConcurrency } = useMailConcurrency()
const { src, presetId, uploadId, uploads, custom, note, signedIn, choosePreset, chooseUpload, upload, removeUpload, clear, openZoom } = useAccountAvatar()
const { config: agentConfig, ready: agentReady, setThinking } = useAgentConfig()
const file = ref<HTMLInputElement | null>(null)
const presets = AVATAR_PRESET_IDS.map(id => ({ id, src: presetAvatarUrl(id) }))
const concurrencyOptions = [1, 2, 3, 4].map(count => ({ value: count, label: String(count) }))

const PROBE_KEY = 'patmail.agent.probe.v1'

interface ProbeMark { ok: boolean; at: string; detail: string }

const agentNote = ref('')
const agentBusy = ref(false)
const probe = ref<ProbeMark | null>(null)

function readProbe(value: unknown): ProbeMark | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.ok !== 'boolean' || typeof record.at !== 'string') return null
  const at = record.at.slice(0, 40)
  if (Number.isNaN(Date.parse(at))) return null
  return { ok: record.ok, at, detail: typeof record.detail === 'string' ? record.detail.slice(0, 200) : '' }
}

function formatProbeTime(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

if (typeof chrome !== 'undefined' && chrome.storage?.local) {
  void chrome.storage.local.get(PROBE_KEY).then(stored => {
    probe.value = readProbe(stored[PROBE_KEY])
  }).catch(() => {})
}

const probeText = computed(() => {
  if (agentBusy.value) return '正在检测…'
  if (!probe.value) return '还没检测过'
  const when = `上次检测 ${formatProbeTime(probe.value.at)}`
  return probe.value.detail ? `${when}，${probe.value.detail}` : when
})

const lampKind = computed(() => {
  if (agentBusy.value) return 'busy'
  if (!probe.value) return 'idle'
  return probe.value.ok ? 'ok' : 'bad'
})

async function rememberProbe(mark: ProbeMark): Promise<void> {
  probe.value = mark
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  await chrome.storage.local.set({ [PROBE_KEY]: mark })
}

function onThinking(event: Event): void {
  const thinking = (event.target as HTMLInputElement).checked
  void setThinking(thinking).catch(() => {
    agentNote.value = '思考模式没有保存。'
  })
}

async function onAgentTest(): Promise<void> {
  if (agentBusy.value) return
  agentBusy.value = true
  const at = new Date().toISOString()
  try {
    const response = await sendToBackground({ type: MessageType.AgentChat, payload: { action: 'probe', message: '你好' } }, 120_000)
    if (!response || response.type !== MessageType.AgentChatResult) {
      await rememberProbe({ ok: false, at, detail: response?.type === MessageType.Error ? response.payload.message : '后台没有响应。' })
      return
    }
    if (response.payload.ok) {
      const model = response.payload.data.model.trim()
      await rememberProbe({ ok: true, at, detail: model ? `接通 ${model}` : '' })
    } else await rememberProbe({ ok: false, at, detail: response.payload.error.message })
  } catch (error) {
    await rememberProbe({ ok: false, at, detail: error instanceof Error ? error.message : '检测没有完成。' })
  } finally {
    agentBusy.value = false
  }
}

function onToggle(event: Event): void {
  void setOpen((event.target as HTMLInputElement).checked)
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0]
  input.value = ''
  if (!picked) return
  try {
    await upload(picked)
  } catch (error) {
    note.value = error instanceof Error ? error.message : '头像没有保存。'
  }
}

async function onRemove(id: string): Promise<void> {
  const ok = await confirmDialog({
    title: '删除上传的头像',
    message: '删掉之后不能再选用这张。系统预存的头像不会被删。',
    confirmLabel: '删除'
  })
  if (!ok) return
  await removeUpload(id)
}

async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    note.value = error instanceof Error ? error.message : '头像没有保存。'
  }
}
</script>

<template>
  <PageHead title="系统设置" desc="头像和写开关都在这里。" :art="bg('今天也要高效发文.png')" />
  <section class="card avatar-panel">
    <h2>头像</h2>
    <p class="hint">还没单独设过头像时，用这台浏览器从 20 张里抽到的一张。上传的图片会按画面自动居中裁成正方形，留在这台浏览器里，出现在下面，之后还能再选。单击选用，双击放大。上传的可以删，系统预存的 20 张不能删。</p>
    <div class="avatar-current">
      <button type="button" class="avatar-zoom-open" :disabled="!src" aria-label="放大头像" @click="openZoom()">
        <img v-if="src" class="avatar-face" :src="src" alt="" />
      </button>
      <div class="avatar-actions">
        <button type="button" class="primary" :disabled="!signedIn" @click="file?.click()">上传图片</button>
        <button type="button" :disabled="!signedIn || !uploadId" @click="run(() => onRemove(uploadId))">删除</button>
        <button type="button" :disabled="!signedIn || !custom" @click="run(clear)">恢复默认</button>
        <input ref="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden @change="onFile" />
        <p>{{ signedIn ? (note || '可以从下面挑一张，也可以上传自己的图片。当前是上传的图时，可以点「删除」。双击任意一张可以放大。') : '先连上 EASY 并确认登录人，才能换成这个账号自己的头像。双击下面的头像仍可以放大。' }}</p>
      </div>
    </div>
    <div class="avatar-grid">
      <div v-for="item in uploads" :key="item.id" class="upload-slot">
        <button type="button" class="uploaded" :class="{ on: uploadId === item.id }" :aria-label="`上传的头像 ${item.id}`" @click="signedIn && run(() => chooseUpload(item.id))" @dblclick.stop="openZoom(item.image)">
          <img :src="item.image" alt="" />
        </button>
        <button type="button" class="upload-remove" :disabled="!signedIn" aria-label="删除这张上传的头像" @click.stop="run(() => onRemove(item.id))" @dblclick.stop>×</button>
      </div>
      <button v-for="(item, index) in presets" :key="item.id" type="button" :class="{ on: presetId === item.id }" :aria-label="`头像 ${index + 1}`" @click="signedIn && run(() => choosePreset(item.id))" @dblclick.stop="openZoom(item.src)">
        <img :src="item.src" alt="" />
      </button>
    </div>
  </section>
  <section class="card">
    <h2>发文写入</h2>
    <form class="stack-form" @submit.prevent>
      <div class="write-row">
        <label class="concurrency-line">并发数
          <ThemeSelect :model-value="concurrency" :disabled="!concurrencyReady" :options="concurrencyOptions" @update:model-value="setConcurrency(Number($event))" />
        </label>
        <label>
          <input type="checkbox" :checked="open" :disabled="!ready" @change="onToggle" />
          写开关
        </label>
      </div>
      <p v-if="!ready" class="hint">正在读取写开关。</p>
      <p v-else-if="open" class="hint">已打开。可以写回查询模板。创建邮件、保存草稿和流程提交还要等响应核对完，现在仍不会发出。</p>
      <p v-else class="hint">已关闭。不会写回查询模板，也不会创建邮件、保存草稿或提交流程。</p>
    </form>
  </section>
  <section class="card agent-settings">
    <div class="agent-settings-head">
      <h2>AI 助手</h2>
      <p>顶栏助手使用内置模型。主模型连不上时自动改用备用模型。检测只看连不连得上，并写上这次接通的模型，不查案件。</p>
    </div>
    <form v-if="agentConfig" @submit.prevent>
      <div class="agent-settings-bar">
        <label class="agent-think" v-hint="'打开后模型先思考再回答，等待时显示「正在思考」，勾选立即生效。关掉则直接回答，显示「正在回复」。'">
          <input :checked="agentConfig.thinking" type="checkbox" @change="onThinking" />
          思考模式
        </label>
        <button type="button" class="probe" :disabled="agentBusy" @click="onAgentTest">{{ agentBusy ? '正在检测…' : '检测连通' }}</button>
        <span class="agent-lamp" :class="lampKind" aria-hidden="true"></span>
        <p class="agent-probe-meta" v-hint="probeText">{{ probeText }}</p>
      </div>
      <p v-if="agentNote" class="hint">{{ agentNote }}</p>
    </form>
    <p v-else-if="!agentReady" class="hint">正在读取 AI 助手配置。</p>
    <p v-else class="hint">AI 助手配置没有读到。重新打开这一页再试。</p>
  </section>
</template>
