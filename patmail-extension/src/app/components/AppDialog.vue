<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { closeDialog, closeProgress, dialogState, progressDialog } from '../dialog'

const state = dialogState()
const progress = progressDialog
const dialogRoot = ref<HTMLElement | null>(null)
const progressRoot = ref<HTMLElement | null>(null)
const progressLog = ref<HTMLOListElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
const confirmButton = ref<HTMLButtonElement | null>(null)
const progressDone = ref<HTMLButtonElement | null>(null)
const progressPercent = computed(() => Math.min(100, Math.round((progress.done / progress.total) * 100)))
const latestLine = computed(() => progress.lines.at(-1)?.text ?? '')
let returnFocus: HTMLElement | null = null

function rememberFocus(): void {
  const active = document.activeElement
  returnFocus = active instanceof HTMLElement ? active : null
}

function restoreFocus(): void {
  const node = returnFocus
  returnFocus = null
  if (node?.isConnected) node.focus()
}

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea'))
    .filter(node => !node.hasAttribute('disabled'))
}

function onKey(event: KeyboardEvent): void {
  const root = progress.open ? progressRoot.value : state.open ? dialogRoot.value : null
  if (event.key === 'Tab' && root) {
    const items = focusable(root)
    if (!items.length) {
      event.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault()
      first.focus()
    }
    return
  }
  if (event.key !== 'Escape') return
  if (progress.open) {
    if (!progress.finished) return
    event.preventDefault()
    closeProgress()
    return
  }
  if (!state.open) return
  event.preventDefault()
  closeDialog(false)
}

watch(() => progress.lines.length, () => {
  void nextTick(() => {
    const node = progressLog.value
    if (node) node.scrollTop = node.scrollHeight
  })
})

watch(() => progress.open, (open, was) => {
  if (open) {
    rememberFocus()
    void nextTick(() => progressRoot.value?.focus())
    return
  }
  if (was && !state.open) restoreFocus()
})

watch(() => progress.finished, finished => {
  if (!finished || !progress.open) return
  void nextTick(() => progressDone.value?.focus())
})

watch(() => state.open, (open, was) => {
  if (open) {
    if (!progress.open) rememberFocus()
    void nextTick(() => (cancelButton.value ?? confirmButton.value)?.focus())
    return
  }
  if (was && !progress.open) restoreFocus()
})

window.addEventListener('keydown', onKey)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="state.open" class="mask app-dialog" @click.self="closeDialog(false)">
    <div ref="dialogRoot" class="dialog" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-message" tabindex="-1">
      <header>
        <h3 id="app-dialog-title">{{ state.title }}</h3>
        <button type="button" aria-label="关闭" @click="closeDialog(false)">×</button>
      </header>
      <p id="app-dialog-message" class="app-dialog-gap">{{ state.message }}</p>
      <footer>
        <button v-if="state.cancelLabel" ref="cancelButton" type="button" class="ghost" @click="closeDialog(false)">{{ state.cancelLabel }}</button>
        <button ref="confirmButton" type="button" class="solid" @click="closeDialog(true)">{{ state.confirmLabel }}</button>
      </footer>
    </div>
  </div>
  <div v-if="progress.open" class="mask app-dialog progress-mask">
    <div ref="progressRoot" class="dialog progress-dialog" role="dialog" aria-modal="true" aria-labelledby="progress-title" aria-describedby="progress-current" tabindex="-1" :aria-busy="!progress.finished">
      <header>
        <h3 id="progress-title">{{ progress.title }}</h3>
        <button v-if="progress.finished" type="button" aria-label="关闭" @click="closeProgress">×</button>
      </header>
      <div class="progress-meter" role="progressbar" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100" :aria-valuetext="`${progressPercent}%`">
        <div class="send-bar"><span :style="{ width: progressPercent + '%' }"></span></div>
        <strong>{{ progressPercent }}%</strong>
      </div>
      <p id="progress-current" class="sr-only" aria-live="polite">{{ latestLine }}</p>
      <ol ref="progressLog" class="progress-log">
        <li v-for="(line, index) in progress.lines" :key="index">
          <time :datetime="line.time">{{ line.time }}</time>
          <span>{{ line.text }}</span>
        </li>
      </ol>
      <p class="progress-tally" role="status">
        <span class="is-success">成功 {{ progress.counts.success }} 件</span>
        <span class="is-failed">失败 {{ progress.counts.failed }} 件</span>
        <span class="is-abnormal">异常 {{ progress.counts.abnormal }} 件</span>
        <span v-if="progress.counts.skipped" class="is-skipped">跳过 {{ progress.counts.skipped }} 件</span>
      </p>
      <footer v-if="progress.finished">
        <button ref="progressDone" type="button" class="solid" @click="closeProgress">知道了</button>
      </footer>
    </div>
  </div>
</template>
