<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { BodyRule } from '../../../mail/types'
import { TEMPLATE_TOKENS } from '../../../mail/rules/subject-builder'

const model = defineModel<BodyRule>({ required: true })
const box = ref<HTMLTextAreaElement | null>(null)

async function insert(name: string): Promise<void> {
  const token = `{${name}}`
  const current = model.value.template
  const start = box.value?.selectionStart ?? current.length
  const end = box.value?.selectionEnd ?? current.length
  model.value.template = `${current.slice(0, start)}${token}${current.slice(end)}`
  await nextTick()
  const cursor = start + token.length
  box.value?.focus()
  box.value?.setSelectionRange(cursor, cursor)
}
</script>

<template>
  <div class="template-editor">
    <label>正文模板 <textarea ref="box" v-model="model.template" rows="5"></textarea></label>
    <div class="token-row">
      <button v-for="item in TEMPLATE_TOKENS" :key="item.name" type="button" class="text-button" :title="item.hint" @click="insert(item.name)">{{ '{' + item.name + '}' }}</button>
    </div>
    <p class="hint">正文和标题用同一套占位符。不需要的直接删，想固定的句子直接写。</p>
  </div>
</template>
