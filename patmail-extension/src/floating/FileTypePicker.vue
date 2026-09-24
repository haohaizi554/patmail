<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FileTypeNode } from '../api/dictionaries'
import { resolveFileDescriptionDisplay, searchFileTypeNodes } from '../schema'
import FileTypeNodeRow from './FileTypeNodeRow.vue'

const props = defineProps<{ nodes: FileTypeNode[]; rootIds: string[]; modelValue: string; historyText?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const query = ref('')
const expanded = ref<Record<string, boolean>>({})
const byId = computed(() => new Map(props.nodes.map(node => [node.id, node])))
const selected = computed(() => props.modelValue.split(',').map(item => item.trim()).filter(Boolean))
const matches = computed(() => searchFileTypeNodes(props.nodes, query.value))
const display = computed(() => resolveFileDescriptionDisplay({
  savedIds: props.modelValue, descriptions: props.nodes, historyText: props.historyText
}))

function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  emit('update:modelValue', [...next].join(','))
}
function expand(id: string): void {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] }
}
</script>

<template>
  <div class="file-tree">
    <p v-if="selected.length" class="hint">已选：{{ display.text }}</p>
    <input v-model="query" type="search" placeholder="搜索文件描述" aria-label="搜索文件描述" />
    <div v-if="query.trim()" class="tree-list">
      <label v-for="id in matches" :key="id" class="check-line">
        <input type="checkbox" :checked="selected.includes(id)" @change="toggle(id)" />
        {{ byId.get(id)?.name ?? '未识别的历史 ID' }}
      </label>
      <p v-if="matches.length === 0" class="hint">没有匹配的文件描述。</p>
    </div>
    <div v-else class="tree-list">
      <FileTypeNodeRow v-for="id in rootIds" :key="id" :node-id="id" :by-id="byId" :selected="selected" :expanded="expanded" :trail="[]" @toggle="toggle" @expand="expand" />
    </div>
  </div>
</template>
