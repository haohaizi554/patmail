<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { closeDialog, closeProgress, dialogState, progressDialog } from '../dialog'

const state = dialogState()
const progress = progressDialog
const cancelButton = ref<HTMLButtonElement | null>(null)
const confirmButton = ref<HTMLButtonElement | null>(null)
const progressPercent = computed(() => Math.min(100, Math.round((progress.done / progress.total) * 100)))

function onKey(event: KeyboardEvent): void {
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

watch(() => state.open, open => {
  if (!open) return
  void nextTick(() => (cancelButton.value ?? confirmButton.value)?.focus())
}, { immediate: true })

window.addEventListener('keydown', onKey)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="state.open" class="mask app-dialog" @click.self="closeDialog(false)">
    <div class="dialog" role="dialog" aria-modal="true" :aria-labelledby="'app-dialog-title'" aria-describedby="app-dialog-message">
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
    <div class="dialog progress-dialog" role="dialog" aria-modal="true" aria-labelledby="progress-title">
      <header>
        <h3 id="progress-title">{{ progress.title }}</h3>
        <button v-if="progress.finished" type="button" aria-label="关闭" @click="closeProgress">×</button>
      </header>
      <div class="progress-meter" role="progressbar" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100" :aria-valuetext="`${progressPercent}%`">
        <div class="send-bar"><span :style="{ width: progressPercent + '%' }"></span></div>
        <strong>{{ progressPercent }}%</strong>
      </div>
      <ol class="progress-log">
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
        <button type="button" class="solid" @click="closeProgress">知道了</button>
      </footer>
    </div>
  </div>
</template>
