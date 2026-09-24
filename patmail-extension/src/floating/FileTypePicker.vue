<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FileTypeNode } from '../api/dictionaries'
import { searchFileTypeNodes } from '../schema'

const props = defineProps<{ nodes: FileTypeNode[]; rootIds: string[]; modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const query = ref('')
const expanded = ref<Record<string, boolean>>({})
const byId = computed(() => new Map(props.nodes.map(node => [node.id, node])))
const selected = computed(() => props.modelValue.split(',').map(item => item.trim()).filter(Boolean))
const matches = computed(() => searchFileTypeNodes(props.nodes, query.value))

function selectedSet(): Set<string> {
  return new Set(selected.value)
}
function emitIds(ids: Set<string>): void {
  emit('update:modelValue', [...ids].join(','))
}
function toggle(id: string): void {
  const next = selectedSet()
  if (next.has(id)) next.delete(id)
  else next.add(id)
  emitIds(next)
}
function label(id: string): string {
  return byId.value.get(id)?.name ?? '未识别的历史 ID'
}
</script>

<template>
  <div class="file-tree">
    <p v-if="selected.length" class="hint">已选：{{ selected.map(label).join('、') }}</p>
    <input v-model="query" type="search" placeholder="搜索文件描述" aria-label="搜索文件描述" />
    <div v-if="query.trim()" class="tree-list">
      <label v-for="id in matches" :key="id" class="check-line">
        <input type="checkbox" :checked="selected.includes(id)" @change="toggle(id)" />
        {{ label(id) }}
      </label>
      <p v-if="matches.length === 0" class="hint">没有匹配的文件描述。</p>
    </div>
    <div v-else class="tree-list">
      <template v-for="id in rootIds" :key="id">
        <div class="tree-row">
          <button v-if="byId.get(id)?.childIds.length" type="button" class="text-button" @click="expanded[id] = !expanded[id]">{{ expanded[id] ? '收起' : '展开' }}</button>
          <label class="check-line">
            <input type="checkbox" :checked="selected.includes(id)" @change="toggle(id)" />
            {{ label(id) }}
          </label>
        </div>
        <div v-if="expanded[id]" class="tree-children">
          <label v-for="childId in byId.get(id)?.childIds ?? []" :key="childId" class="check-line">
            <input type="checkbox" :checked="selected.includes(childId)" @change="toggle(childId)" />
            {{ label(childId) }}
          </label>
        </div>
      </template>
    </div>
  </div>
</template>
