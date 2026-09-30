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
      <div class="send-bar" aria-hidden="true"><span :style="{ width: progressPercent + '%' }"></span></div>
      <ol class="progress-log">
        <li v-for="(line, index) in progress.lines" :key="index">{{ line }}</li>
      </ol>
      <footer v-if="progress.finished">
        <button type="button" class="solid" @click="closeProgress">知道了</button>
      </footer>
    </div>
  </div>
</template>
