<script setup lang="ts">
import { computed } from 'vue'
import type { FileTypeNode } from '../api/dictionaries'

const props = defineProps<{
  nodeId: string
  byId: Map<string, FileTypeNode>
  selected: string[]
  expanded: Record<string, boolean>
  trail: string[]
}>()
const emit = defineEmits<{ toggle: [id: string]; expand: [id: string] }>()
const node = computed(() => props.byId.get(props.nodeId))
const cyclic = computed(() => props.trail.includes(props.nodeId))
const children = computed(() => cyclic.value ? [] : node.value?.childIds ?? [])
</script>

<template>
  <div v-if="node" class="tree-node">
    <div class="tree-row">
      <button v-if="children.length" type="button" class="text-button" @click="emit('expand', nodeId)">{{ expanded[nodeId] ? '收起' : '展开' }}</button>
      <label class="check-line">
        <input type="checkbox" :checked="selected.includes(nodeId)" @change="emit('toggle', nodeId)" />
        {{ node.name }}
      </label>
    </div>
    <p v-if="cyclic" class="hint">该节点已在上层出现，已停止继续展开。</p>
    <div v-else-if="expanded[nodeId]" class="tree-children">
      <FileTypeNodeRow v-for="childId in children" :key="childId" :node-id="childId" :by-id="byId" :selected="selected" :expanded="expanded" :trail="[...trail, nodeId]" @toggle="emit('toggle', $event)" @expand="emit('expand', $event)" />
    </div>
  </div>
</template>
