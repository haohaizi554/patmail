<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { closeDialog, closeProgress, closeSummary, dialogState, exportSummary, progressDialog, summaryDialog } from '../dialog'

const state = dialogState()
const progress = progressDialog
const dialogRoot = ref<HTMLElement | null>(null)
const progressRoot = ref<HTMLElement | null>(null)
const summaryRoot = ref<HTMLElement | null>(null)
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
  const root = progress.open ? progressRoot.value : summaryDialog.open ? summaryRoot.value : state.open ? dialogRoot.value : null
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
  if (summaryDialog.open) {
    event.preventDefault()
    closeSummary()
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
    <div ref="dialogRoot" class="dialog" :class="{ warn: state.warn, 'with-table': Boolean(state.table) }" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-message" tabindex="-1">
      <header>
        <h3 id="app-dialog-title">{{ state.title }}</h3>
        <button type="button" aria-label="关闭" @click="closeDialog(false)">×</button>
      </header>
      <p id="app-dialog-message" class="app-dialog-gap">{{ state.message }}</p>
      <div v-if="state.table" class="dialog-table">
        <table>
          <thead v-if="state.table.headers?.length">
            <tr><th v-for="(head, index) in state.table.headers" :key="index" scope="col">{{ head }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in state.table.rows" :key="index">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
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
      <ul v-if="progress.notes.length" class="progress-notes">
        <li v-for="(note, index) in progress.notes" :key="index" :class="'is-' + note.kind">{{ note.kind === 'failed' ? '失败' : note.kind === 'abnormal' ? '异常' : '跳过' }} {{ note.label }}：{{ note.reason }}</li>
      </ul>
      <footer v-if="progress.finished">
        <button ref="progressDone" type="button" class="solid" @click="closeProgress">知道了</button>
      </footer>
    </div>
  </div>
  <div v-if="summaryDialog.open" class="mask app-dialog summary-mask" @click.self="closeSummary">
    <div ref="summaryRoot" class="dialog with-table summary-dialog" role="dialog" aria-modal="true" aria-labelledby="summary-title" tabindex="-1">
      <header>
        <h3 id="summary-title">{{ summaryDialog.title }}</h3>
        <button type="button" aria-label="关闭" @click="closeSummary">×</button>
      </header>
      <div class="dialog-table">
        <table>
          <thead>
            <tr><th v-for="(head, index) in summaryDialog.headers" :key="index" scope="col">{{ head }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in summaryDialog.rows" :key="index">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer>
        <button type="button" class="ghost" @click="exportSummary">导出 xlsx</button>
        <button type="button" class="solid" @click="closeSummary">关闭</button>
      </footer>
    </div>
  </div>
</template>
