<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { AGENT_FRAME_KEY, normalizeAgentFrame, resizeAgentFrame, type AgentFrame, type ResizeEdge } from '../agent-frame'
import { foldActivity, type AgentTraceStep } from '../../agent/trace'
import { AGENT_CONFIG_KEY, normalizeAgentConfig } from '../../agent/config'
import AgentAnswer from './AgentAnswer.vue'
import { thoughtLead } from '../../agent/loop'
import { formatAgentAnswer, isAgentQuestion, type AgentQuestion } from '../../agent/ask'
import { filterCommands, resolveSlash, slashToken, type SlashCommand } from '../../agent/slash'
import { MessageType, type BackgroundRequest } from '../../shared/message'
import { sendToBackground } from '../../utils/runtime'

interface Bubble { role: 'user' | 'assistant'; content: string }
interface Job { kind: 'turn' | 'facts' | 'compact' | 'reset'; display: string; message: string; label: string }
type AgentRequest = Extract<BackgroundRequest, { type: typeof MessageType.AgentChat }>
type AskResult = { ok: true; reply: string; history: Bubble[] } | { ok: false; message: string }

const RESIZE_EDGES: ResizeEdge[] = ['e', 's', 'se']
const open = ref(false)
const loaded = ref(false)
const placed = ref(false)
const history = ref<Bubble[]>([])
const aside = ref<string[]>([])
const QUEUE_HEAD = 3
const queue = ref<Job[]>([])
const queueOpen = ref(false)
const queueHead = computed(() => queue.value.slice(0, QUEUE_HEAD))
const queueRest = computed(() => queue.value.slice(QUEUE_HEAD))
const liveSteps = ref<AgentTraceStep[]>([])
const liveThought = ref('')
const liveThoughtTarget = ref('')
const liveDraft = ref('')
const liveThoughtOpen = ref(true)
const liveThoughtBox = ref<HTMLElement | null>(null)
let livePump = 0

function stopLivePump(): void {
  if (livePump) cancelAnimationFrame(livePump)
  livePump = 0
}

/** 目标文本可能一次到一大段。显示从首字开始，每帧往前走，避免首屏就是好几段。 */
function pumpLiveThought(): void {
  livePump = 0
  const target = liveThoughtTarget.value
  if (!target.startsWith(liveThought.value)) liveThought.value = ''
  const gap = target.length - liveThought.value.length
  if (gap <= 0) return
  const step = liveThought.value.length === 0 ? 1 : gap > 48 ? Math.min(24, Math.ceil(gap / 8)) : 1
  liveThought.value = target.slice(0, liveThought.value.length + step)
  livePump = requestAnimationFrame(pumpLiveThought)
}

function clearLiveThought(): void {
  stopLivePump()
  liveThoughtTarget.value = ''
  liveThought.value = ''
  liveDraft.value = ''
}
const draft = ref('')
interface PendingAsk { questions: AgentQuestion[]; index: number; answers: Record<string, string> }
const pendingAsk = ref<PendingAsk | null>(null)
const askText = ref('')
const askPicked = ref<string[]>([])
const askQuestion = computed(() => (pendingAsk.value ? pendingAsk.value.questions[pendingAsk.value.index] ?? null : null))
const askReady = computed(() => {
  const question = askQuestion.value
  if (!question) return false
  if (question.needsText) return askText.value.trim().length > 0
  return askPicked.value.length > 0 || askText.value.trim().length > 0
})
const askLast = computed(() => Boolean(pendingAsk.value && askQuestion.value && pendingAsk.value.index >= pendingAsk.value.questions.length - 1))
const note = ref('')
const busy = ref(false)
const waitLabel = ref('正在回复')
const thinkingOn = ref(false)
const stick = ref(true)
const copied = ref(-1)
const retryJob = ref<Job | null>(null)
const starters = [
  { label: '有多少接口', text: '一共有多少接口', send: true },
  { label: '建一条工作流', text: '给客户建一条工作流，名字叫', send: false },
  { label: '按文号建任务', text: '按文号建一条发文任务：', send: false }
]
let stopped = false
const ACTIVITY_CHANNEL = 'patmail-agent-activity'
const ASK_CHANNEL = 'patmail-agent-ask'
const calmNote = (text: string) => text === '这段对话已清空，长期记忆还在。' || text === '已停下。'

function readThinking(value: unknown): void {
  thinkingOn.value = normalizeAgentConfig(value).thinking
}

const viewport = ref({ width: window.innerWidth, height: window.innerHeight })
const preferred = ref<AgentFrame>({ width: 380, height: 560 })
const frame = computed(() => normalizeAgentFrame(preferred.value, viewport.value))
let resize: { edge: ResizeEdge; x: number; y: number; width: number; height: number; left: number; top: number } | null = null

function readFrame(value: unknown): void {
  if (resize) return
  preferred.value = normalizeAgentFrame(value, viewport.value)
  clamp(x.value, y.value)
}

function saveFrame(next: AgentFrame): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  void chrome.storage.local.set({ [AGENT_FRAME_KEY]: { width: next.width, height: next.height } }).catch(() => {})
}

if (typeof chrome !== 'undefined' && chrome.storage?.local) {
  void chrome.storage.local.get([AGENT_CONFIG_KEY, AGENT_FRAME_KEY]).then(stored => {
    readThinking(stored[AGENT_CONFIG_KEY])
    readFrame(stored[AGENT_FRAME_KEY])
  }).catch(() => {})
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (AGENT_CONFIG_KEY in changes) readThinking(changes[AGENT_CONFIG_KEY]?.newValue)
    if (AGENT_FRAME_KEY in changes) readFrame(changes[AGENT_FRAME_KEY]?.newValue)
  })
}
const paletteDismissed = ref(false)
const active = ref(0)
const x = ref(24)
const y = ref(88)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const box = ref<HTMLTextAreaElement | null>(null)
let waitTimer = 0
let drag: { dx: number; dy: number } | null = null
let pendingReset = false

const token = computed(() => slashToken(draft.value))
const commands = computed(() => token.value === null ? [] : filterCommands(token.value))
const groups = computed(() => {
  const order = ['指令', '去办', '本领'] as const
  return order.flatMap(group => {
    const items = commands.value.filter(command => command.group === group)
    return items.length ? [{ group, items }] : []
  })
})
const showPalette = computed(() => open.value && token.value !== null && !paletteDismissed.value)

function applyHistory(items: Bubble[]): void {
  history.value = items.filter(item => item.content.trim())
}

function nearBottom(): boolean {
  const el = scroller.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 64
}

function onStreamScroll(): void {
  stick.value = nearBottom()
}

async function scrollDown(force = false): Promise<void> {
  await nextTick()
  if (!scroller.value || (!force && !stick.value)) return
  scroller.value.scrollTop = scroller.value.scrollHeight
  stick.value = true
}

function waitPhrase(): string {
  return thinkingOn.value ? '正在思考' : '正在回复'
}

function startWait(label = waitPhrase()): void {
  waitLabel.value = label
  window.clearTimeout(waitTimer)
  waitTimer = window.setTimeout(() => {
    if (liveSteps.value.length === 0 && !liveThought.value && !liveDraft.value) waitLabel.value = '还在处理，稍等一下'
  }, 8_000)
}

function stopWait(): void {
  window.clearTimeout(waitTimer)
}

async function ask(action: AgentRequest): Promise<AskResult> {
  try {
    const response = await sendToBackground(action, 180_000)
    if (!response || response.type !== MessageType.AgentChatResult) {
      return { ok: false, message: response?.type === MessageType.Error ? response.payload.message : '后台没有响应。' }
    }
    if (!response.payload.ok) return { ok: false, message: response.payload.error.message }
    return {
      ok: true,
      reply: response.payload.data.reply,
      history: response.payload.data.history.filter(item => item.content.trim())
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '后台没有响应。' }
  }
}

async function ensureHistory(): Promise<void> {
  if (loaded.value) return
  const result = await ask({ type: MessageType.AgentChat, payload: { action: 'history' } })
  if (!result.ok) {
    note.value = result.message
    return
  }
  loaded.value = true
  note.value = ''
  applyHistory(result.history)
}

function placeNearEntry(): void {
  if (placed.value) return
  const button = root.value?.querySelector('.agent-entry')
  const rect = button?.getBoundingClientRect()
  const width = frame.value.width
  if (rect) {
    x.value = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))
    y.value = Math.max(12, Math.min(rect.bottom + 10, window.innerHeight - 160))
  }
  placed.value = true
}

function showAside(text: string): void {
  if (!text.trim()) return
  aside.value = [...aside.value, text]
}

function enqueue(job: Job): boolean {
  if (queue.value.length >= 8) {
    showAside('前面还有 8 条，先等这几条办完。')
    return false
  }
  queue.value = [...queue.value, job]
  return true
}

async function reset(): Promise<void> {
  queue.value = []
  queueOpen.value = false
  if (busy.value) {
    pendingReset = true
    return
  }
  await runJob({ kind: 'reset', display: '', message: '', label: '正在清空' })
}

async function finishJob(): Promise<void> {
  busy.value = false
  clearLiveThought()
  stopWait()
  await nextTick()
  box.value?.focus()
  if (pendingReset) {
    pendingReset = false
    queue.value = []
    queueOpen.value = false
    await runJob({ kind: 'reset', display: '', message: '', label: '正在清空' })
    return
  }
  const next = queue.value[0]
  if (!next) {
    queueOpen.value = false
    await scrollDown()
    return
  }
  queue.value = queue.value.slice(1)
  if (queue.value.length <= QUEUE_HEAD) queueOpen.value = false
  await runJob(next)
}

function halt(): void {
  if (!busy.value) return
  stopped = true
  pendingAsk.value = null
  askText.value = ''
  askPicked.value = []
  waitLabel.value = '正在停下'
  void sendToBackground({ type: MessageType.AgentChat, payload: { action: 'stop' } }, 8_000)
}

async function copyAnswer(text: string, index: number): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = index
    window.setTimeout(() => { if (copied.value === index) copied.value = -1 }, 1200)
  } catch {
    note.value = '没有复制成功。'
  }
}

function useStarter(item: { text: string; send: boolean }): void {
  draft.value = item.text
  if (item.send) void send()
  else void nextTick(() => box.value?.focus())
}

async function retry(): Promise<void> {
  const job = retryJob.value
  if (!job || busy.value) return
  retryJob.value = null
  note.value = ''
  await runJob(job)
}

async function runJob(job: Job): Promise<void> {
  stopped = false
  busy.value = true
  liveSteps.value = []
  clearLiveThought()
  liveThoughtOpen.value = true
  note.value = ''
  if (job.kind === 'turn') {
    aside.value = []
    const last = history.value.at(-1)
    if (!(last?.role === 'user' && last.content === job.display)) {
      history.value = [...history.value, { role: 'user', content: job.display }]
    }
  }
  startWait(job.label)
  stick.value = true
  await scrollDown(true)
  try {
    if (job.kind === 'reset') {
      const result = await ask({ type: MessageType.AgentChat, payload: { action: 'reset' } })
      aside.value = []
      if (!result.ok) note.value = result.message
      else {
        note.value = result.reply
        applyHistory(result.history)
      }
      return
    }
    if (job.kind === 'facts') {
      const result = await ask({ type: MessageType.AgentChat, payload: { action: 'facts' } })
      if (!result.ok) note.value = result.message
      else showAside(result.reply)
      return
    }
    if (job.kind === 'compact') {
      const result = await ask({ type: MessageType.AgentChat, payload: { action: 'compact' } })
      if (!result.ok) note.value = result.message
      else {
        applyHistory(result.history)
        showAside(result.reply)
      }
      return
    }
    const result = await ask({ type: MessageType.AgentChat, payload: { action: 'turn', message: job.message } })
    if (stopped) {
      note.value = '已停下。'
      retryJob.value = job
      return
    }
    if (!result.ok) {
      note.value = result.message
      retryJob.value = job
    } else {
      retryJob.value = null
      applyHistory(result.history)
    }
  } finally {
    await finishJob()
  }
}

async function send(): Promise<void> {
  stick.value = true
  const message = draft.value.trim()
  if (!message) return
  const resolved = resolveSlash(message)
  if (resolved.kind === 'local') {
    draft.value = ''
    if (resolved.local === 'help') {
      showAside(resolved.message)
      await scrollDown()
      return
    }
    if (resolved.local === 'clear') {
      await reset()
      return
    }
    const job: Job = resolved.local === 'memory'
      ? { kind: 'facts', display: '查看长期记忆', message: '', label: '正在读取记忆' }
      : { kind: 'compact', display: '压缩更早的对话', message: '', label: '正在压缩更早的对话' }
    if (busy.value) {
      if (!enqueue(job)) {
        draft.value = message
        return
      }
      await scrollDown()
      return
    }
    await runJob(job)
    return
  }
  if (resolved.kind === 'unknown') {
    showAside(resolved.message)
    draft.value = ''
    await scrollDown()
    box.value?.focus()
    return
  }
  const display = resolved.kind === 'skill' ? resolved.display : message
  const job: Job = {
    kind: 'turn',
    display,
    message,
    label: resolved.kind === 'skill' ? `正在办「${resolved.name}」` : waitPhrase()
  }
  if (busy.value) {
    if (!enqueue(job)) return
    draft.value = ''
    await scrollDown()
    box.value?.focus()
    return
  }
  draft.value = ''
  await runJob(job)
}

function beginAsk(questions: AgentQuestion[]): void {
  pendingAsk.value = { questions, index: 0, answers: {} }
  askText.value = ''
  askPicked.value = []
}

function replyAnswer(message: string): void {
  void sendToBackground({ type: MessageType.AgentChat, payload: { action: 'answer', message } }, 30_000)
}

function skipAsk(): void {
  if (!pendingAsk.value) return
  pendingAsk.value = null
  askText.value = ''
  askPicked.value = []
  replyAnswer('跳过')
}

function toggleAsk(choice: string): void {
  const question = askQuestion.value
  if (!question) return
  if (question.multiple) {
    askPicked.value = askPicked.value.includes(choice)
      ? askPicked.value.filter(item => item !== choice)
      : [...askPicked.value, choice]
    return
  }
  askPicked.value = askPicked.value[0] === choice ? [] : [choice]
  if (!question.placeholder && !question.needsText) advanceAsk()
}

function advanceAsk(): void {
  const pending = pendingAsk.value
  const question = askQuestion.value
  if (!pending || !question || !askReady.value) return
  const typed = askText.value.trim()
  const picked = question.multiple ? askPicked.value.join('、') : (askPicked.value[0] ?? '')
  const value = [picked, typed].filter(Boolean).join(' ')
  const answers = { ...pending.answers, [question.id]: value }
  if (pending.index + 1 < pending.questions.length) {
    pendingAsk.value = { ...pending, index: pending.index + 1, answers }
    askText.value = ''
    askPicked.value = []
    return
  }
  const line = formatAgentAnswer(pending.questions, answers).trim()
  pendingAsk.value = null
  askText.value = ''
  askPicked.value = []
  replyAnswer(line || '跳过')
}

function fillCommand(command: SlashCommand, submitReady: boolean): void {
  if (submitReady && command.args !== 'optional') {
    draft.value = `/${command.name}`
    void send()
    return
  }
  draft.value = command.args === 'none' ? `/${command.name}` : `/${command.name} `
  void nextTick(() => box.value?.focus())
}

function openPalette(): void {
  paletteDismissed.value = false
  if (!draft.value.trim()) draft.value = '/'
  box.value?.focus()
}

function onKey(event: KeyboardEvent): void {
  if (showPalette.value && commands.value.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault()
    const count = commands.value.length
    active.value = event.key === 'ArrowDown' ? (active.value + 1) % count : (active.value - 1 + count) % count
    return
  }
  if (showPalette.value && commands.value.length > 0 && event.key === 'Tab') {
    event.preventDefault()
    const command = commands.value[active.value]
    if (command) fillCommand(command, false)
    return
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    if (showPalette.value && commands.value.length > 0) {
      const command = commands.value[active.value]
      if (command) fillCommand(command, true)
      return
    }
    void send()
  }
}

function clamp(nextX: number, nextY: number): void {
  const width = frame.value.width
  const height = frame.value.height
  x.value = Math.min(Math.max(8, nextX), Math.max(8, window.innerWidth - width - 8))
  y.value = Math.min(Math.max(8, nextY), Math.max(8, window.innerHeight - Math.min(height, 80) - 8))
}

function onResizeStart(edge: ResizeEdge, event: PointerEvent): void {
  event.preventDefault()
  event.stopPropagation()
  resize = { edge, x: event.clientX, y: event.clientY, width: frame.value.width, height: frame.value.height, left: x.value, top: y.value }
  try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* 指针已经松开 */ }
}

function onResizeMove(event: PointerEvent): void {
  if (!resize) return
  const next = resizeAgentFrame(resize, resize.edge, { x: event.clientX, y: event.clientY }, viewport.value)
  preferred.value = next.frame
  x.value = next.left
  y.value = next.top
}

function onResizeEnd(): void {
  if (!resize) return
  resize = null
  saveFrame(preferred.value)
}

function onViewport(): void {
  viewport.value = { width: window.innerWidth, height: window.innerHeight }
  clamp(x.value, y.value)
}

function onDragStart(event: PointerEvent): void {
  if ((event.target as HTMLElement).closest('button')) return
  drag = { dx: event.clientX - x.value, dy: event.clientY - y.value }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onDragMove(event: PointerEvent): void {
  if (!drag) return
  clamp(event.clientX - drag.dx, event.clientY - drag.dy)
}

function onDragEnd(): void {
  drag = null
}

function onEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !open.value) return
  if (busy.value) {
    halt()
    event.preventDefault()
    return
  }
  if (showPalette.value) {
    paletteDismissed.value = true
    event.preventDefault()
    return
  }
  if (!busy.value) open.value = false
}

watch(token, () => {
  paletteDismissed.value = false
  active.value = 0
})
watch(commands, list => { if (active.value >= list.length) active.value = 0 })
watch(active, async () => {
  await nextTick()
  panel.value?.querySelector('.agent-palette button.on')?.scrollIntoView({ block: 'nearest' })
})

watch(open, async (shown) => {
  if (!shown) return
  placeNearEntry()
  await ensureHistory()
  await nextTick()
  box.value?.focus()
  await scrollDown()
})

let agentPort: chrome.runtime.Port | null = null
let agentPulse = 0

function holdAgentPort(): void {
  if (agentPort || typeof chrome === 'undefined' || !chrome.runtime?.connect) return
  try {
    agentPort = chrome.runtime.connect({ name: 'patmail-agent' })
    agentPort.onDisconnect.addListener(() => { agentPort = null })
    agentPulse = window.setInterval(() => {
      try { agentPort?.postMessage({ kind: 'tick' }) } catch { agentPort = null }
    }, 15_000)
  } catch {
    agentPort = null
  }
}

function dropAgentPort(): void {
  window.clearInterval(agentPulse)
  try { agentPort?.disconnect() } catch { /* 已经断开 */ }
  agentPort = null
}

function onActivity(message: unknown): void {
  try { agentPort?.postMessage({ kind: 'tick' }) } catch { agentPort = null }
  if (!message || typeof message !== 'object') return
  const record = message as { channel?: unknown; questions?: unknown; label?: unknown; thought?: unknown; detail?: unknown; phase?: unknown }
  if (record.channel === ASK_CHANNEL) {
    if (!busy.value || stopped || !Array.isArray(record.questions)) return
    const questions = record.questions.filter(isAgentQuestion).slice(0, 3)
    if (questions.length === 0) return
    beginAsk(questions)
    if (stick.value) void scrollDown()
    return
  }
  if (!busy.value) return
  if (record.channel !== ACTIVITY_CHANNEL || typeof record.label !== 'string') return
  if (stopped) return
  if (record.label === '正在写' && typeof record.thought === 'string' && record.thought.trim()) {
    liveDraft.value = record.thought
    waitLabel.value = '正在写'
    if (stick.value) void scrollDown()
    return
  }
  if (typeof record.thought === 'string' && record.thought.trim()) {
    liveThoughtTarget.value = record.thought
    waitLabel.value = '正在思考'
    if (!livePump) livePump = requestAnimationFrame(pumpLiveThought)
    return
  }
  liveSteps.value = foldActivity(liveSteps.value, {
    label: record.label,
    phase: record.phase === 'done' ? 'done' : 'run',
    ...(typeof record.detail === 'string' ? { detail: record.detail } : {})
  })
  waitLabel.value = record.label.slice(0, 40)
  if (stick.value) void scrollDown()
}

watch(liveThought, async () => {
  if (!liveThought.value) return
  await nextTick()
  if (liveThoughtBox.value) liveThoughtBox.value.scrollTop = liveThoughtBox.value.scrollHeight
  if (stick.value) await scrollDown()
})

holdAgentPort()
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(onActivity)
}

window.addEventListener('keydown', onEscape)
window.addEventListener('resize', onViewport)
onUnmounted(() => {
  window.removeEventListener('keydown', onEscape)
  window.removeEventListener('resize', onViewport)
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) chrome.runtime.onMessage.removeListener(onActivity)
  dropAgentPort()
  stopLivePump()
  stopWait()
})
</script>

<template>
  <div ref="root" class="agent-dock">
    <button type="button" class="agent-entry" :class="{ on: open }" :aria-expanded="open" aria-haspopup="dialog" @click="open = !open">
      AI 助手
    </button>
  </div>
  <Teleport to="body">
    <section v-show="open" ref="panel" class="agent-float" role="dialog" aria-label="AI 助手" :style="{ left: `${x}px`, top: `${y}px`, width: `${frame.width}px`, height: `${frame.height}px` }">
      <div
        v-for="edge in RESIZE_EDGES"
        :key="edge"
        class="agent-resize"
        :class="edge"
        :role="edge === 'se' ? 'button' : undefined"
        :aria-label="edge === 'se' ? '拖动调整大小' : undefined"
        @pointerdown="onResizeStart(edge, $event)"
        @pointermove="onResizeMove"
        @pointerup="onResizeEnd"
        @pointercancel="onResizeEnd"
      ></div>
      <header @pointerdown="onDragStart" @pointermove="onDragMove" @pointerup="onDragEnd" @pointercancel="onDragEnd">
        <strong>AI 助手</strong>
        <button type="button" aria-label="关闭" @click="open = false">×</button>
      </header>
      <div ref="scroller" class="agent-stream" @scroll="onStreamScroll">
        <div v-if="history.length === 0 && aside.length === 0 && !busy && !note" class="agent-empty">
          <p>输入 / 可以点技能。也可以从下面选一件。</p>
          <div class="agent-starters">
            <button v-for="item in starters" :key="item.label" type="button" @click="useStarter(item)">{{ item.label }}</button>
          </div>
        </div>
        <div v-for="(item, index) in history" :key="index" class="agent-row" :class="[item.role, { skill: item.role === 'user' && item.content.startsWith('/') }]">
          <AgentAnswer v-if="item.role === 'assistant'" :content="item.content" :copied="copied === index" @copy="copyAnswer($event, index)" />
          <p v-else>{{ item.content }}</p>
        </div>
        <div v-for="(item, index) in aside" :key="`aside-${index}`" class="agent-row assistant">
          <p>{{ item }}</p>
        </div>
        <div v-if="busy" class="agent-row assistant pending" role="status" aria-live="polite">
          <div class="agent-trace">
            <div v-if="liveThought" class="think">
              <button type="button" class="think-bar" :aria-expanded="liveThoughtOpen" @click="liveThoughtOpen = !liveThoughtOpen">
                <span class="think-chevron" :class="{ open: liveThoughtOpen }" aria-hidden="true"></span>
                <span class="think-label">正在思考</span>
                <span v-if="!liveThoughtOpen" class="think-lead">{{ thoughtLead(liveThought) }}</span>
              </button>
              <pre v-if="liveThoughtOpen" ref="liveThoughtBox" class="think-body live">{{ liveThought }}</pre>
            </div>
            <ol v-if="liveSteps.length" class="agent-steps">
              <li v-for="(step, index) in liveSteps" :key="`${index}-${step.label}`" :class="step.state">
                <span class="agent-step-mark" aria-hidden="true"></span>
                <span class="agent-step-label">{{ step.label }}</span>
                <span v-if="step.detail" class="agent-step-detail">{{ step.detail }}</span>
              </li>
            </ol>
            <p v-if="liveDraft" class="agent-step-label">正在写</p>
            <pre v-if="liveDraft" class="think-body live">{{ liveDraft }}</pre>
            <p v-if="!liveSteps.length && !liveDraft"><span class="agent-dots" aria-hidden="true"><i></i><i></i><i></i></span>{{ waitLabel }}</p>
          </div>
        </div>
        <div v-if="!busy && note" class="agent-row assistant" :class="{ failed: !calmNote(note) }">
          <p>{{ note }}<button v-if="retryJob" type="button" class="agent-retry" @click="retry">重试</button></p>
        </div>
        <button v-if="!stick" type="button" class="agent-jump" @click="scrollDown(true)">回到最新</button>
      </div>
      <form @submit.prevent="send">
        <div v-if="pendingAsk && askQuestion" class="agent-ask">
          <p class="agent-ask-step">{{ pendingAsk.index + 1 }} / {{ pendingAsk.questions.length }}</p>
          <p class="agent-ask-prompt">{{ askQuestion.prompt }}</p>
          <div v-if="askQuestion.choices.length" class="agent-ask-choices">
            <button
              v-for="choice in askQuestion.choices"
              :key="choice"
              type="button"
              :class="{ on: askPicked.includes(choice) }"
              @click="toggleAsk(choice)"
            >{{ choice }}</button>
          </div>
          <input
            v-if="askQuestion.placeholder || askQuestion.needsText || askQuestion.choices.length === 0"
            v-model="askText"
            type="text"
            :placeholder="askQuestion.placeholder || '写在这里'"
            @keydown.enter.prevent="advanceAsk"
          />
          <div class="agent-ask-actions">
            <button type="button" @click="skipAsk">跳过</button>
            <button type="button" class="primary" :disabled="!askReady" @click="advanceAsk">{{ askLast ? '就这样' : '下一题' }}</button>
          </div>
        </div>
        <div v-if="queue.length" class="agent-queue">
          <ul id="agent-queue-list" class="agent-queue-list">
            <li v-for="(item, index) in queueHead" :key="index"><span>排队</span>{{ item.display }}</li>
            <li v-for="(item, index) in (queueOpen ? queueRest : [])" :key="`rest-${index}`"><span>排队</span>{{ item.display }}</li>
          </ul>
          <button v-if="queueRest.length" type="button" class="agent-queue-head" :aria-expanded="queueOpen" aria-controls="agent-queue-list" @click="queueOpen = !queueOpen">
            <span class="think-chevron" :class="{ open: queueOpen }" aria-hidden="true"></span>
            {{ queueOpen ? '收起后面的' : `还有 ${queueRest.length} 条` }}
          </button>
        </div>
        <div v-if="showPalette" class="agent-palette" role="listbox" aria-label="技能">
          <p v-if="commands.length === 0" class="agent-palette-empty">没有对上的技能</p>
          <template v-for="group in groups" :key="group.group">
            <p class="agent-palette-label">{{ group.group }}</p>
            <button
              v-for="command in group.items"
              :key="command.name"
              type="button"
              role="option"
              :class="{ on: commands[active]?.name === command.name }"
              :aria-selected="commands[active]?.name === command.name"
              @mouseenter="active = commands.findIndex(item => item.name === command.name)"
              @mousedown.prevent="fillCommand(command, true)"
            >
              <span class="agent-cmd">/{{ command.name }}</span>
              <span class="agent-cmd-desc">{{ command.description }}</span>
            </button>
          </template>
          <p class="agent-palette-foot">↑↓ 选择 · Enter 使用 · Esc 收起</p>
        </div>
        <textarea ref="box" v-model="draft" rows="2" placeholder="正在回复时也可以接着发，会按顺序办" @keydown="onKey" />
        <div class="agent-actions">
          <button type="button" class="agent-slash" v-hint="'点这里选技能，也可以直接输入 /'" @click="openPalette">/ 技能</button>
          <button type="button" @click="reset">清空</button>
          <button v-if="busy" type="button" class="primary" @click="halt">停止</button>
          <button v-else type="submit" class="primary" :disabled="!draft.trim()">发送</button>
        </div>
      </form>
    </section>
  </Teleport>
</template>
