<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { SubjectRule } from '../../../mail/types'
import { TEMPLATE_TOKENS } from '../../../mail/rules/subject-builder'

const model = defineModel<SubjectRule>({ required: true })
const box = ref<HTMLTextAreaElement | null>(null)

const samples = [
  { label: '原站默认', template: '{贵方案号}-{我方文号}-{案件名称}{发文类型}' },
  { label: '文号范围', template: '关于转达{贵方案号范围}{发文类型}-{客户名称}-{日期}' },
  { label: '按件数', template: '关于转达{文件数量}件{发文类型}-{客户名称}-{日期}' }
]

function useSample(template: string): void {
  model.value.template = template
  model.value.countInjection = false
}

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
    <label>标题模板 <textarea ref="box" v-model="model.template" rows="3"></textarea></label>
    <div class="sample-row">
      <button v-for="sample in samples" :key="sample.label" type="button" class="text-button" @click="useSample(sample.template)">套用{{ sample.label }}</button>
    </div>
    <div class="token-row">
      <button v-for="item in TEMPLATE_TOKENS" :key="item.name" type="button" class="text-button" :title="item.hint" @click="insert(item.name)">{{ '{' + item.name + '}' }}</button>
    </div>
    <label class="check-line"><input v-model="model.countInjection" type="checkbox" />多个文件时，在「关于」后面自动加上件数，例如「关于2个」</label>
    <p class="hint">原站默认是「客户文号-我方文号-案件名称+发文类型」，没有内容的那一段会连同后面的 - 一起去掉。机构简称、转达这类字自己写在句子里，不需要的段直接删。</p>
  </div>
</template>
