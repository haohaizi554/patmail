<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { closeDialog, dialogState } from '../dialog'

const state = dialogState()
const cancelButton = ref<HTMLButtonElement | null>(null)
const confirmButton = ref<HTMLButtonElement | null>(null)

function onKey(event: KeyboardEvent): void {
  if (!state.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDialog(false)
  }
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
</template>
