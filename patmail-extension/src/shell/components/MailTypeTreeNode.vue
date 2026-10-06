<script setup lang="ts">
import { computed } from 'vue'
import type { OptionTreeNode } from '../../query/option-tree'

const props = defineProps<{
  nodeId: string
  byId: Map<string, OptionTreeNode>
  selected: string
  expanded: Record<string, boolean>
  visible: Set<string> | null
  trail: string[]
}>()
const emit = defineEmits<{ pick: [id: string]; expand: [id: string] }>()
const node = computed(() => props.byId.get(props.nodeId))
const cyclic = computed(() => props.trail.includes(props.nodeId))
const children = computed(() => cyclic.value ? [] : (node.value?.childIds ?? []).filter(id => !props.visible || props.visible.has(id)))
const open = computed(() => Boolean(props.expanded[props.nodeId]))
</script>

<template>
  <div v-if="node && (!visible || visible.has(nodeId))" class="theme-tree-node" role="treeitem" :aria-expanded="children.length ? open : undefined" :aria-selected="selected === nodeId">
    <div class="theme-tree-row">
      <button v-if="children.length" type="button" class="theme-tree-toggle" :aria-label="open ? '收起' : '展开'" @click="emit('expand', nodeId)">{{ open ? '−' : '+' }}</button>
      <span v-else class="theme-tree-leaf" aria-hidden="true"></span>
      <button type="button" class="theme-tree-pick" :class="{ 'is-selected': selected === nodeId }" @click="emit('pick', nodeId)">{{ node.label }}</button>
    </div>
    <div v-if="open && children.length" class="theme-tree-children" role="group">
      <MailTypeTreeNode v-for="childId in children" :key="childId" :node-id="childId" :by-id="byId" :selected="selected" :expanded="expanded" :visible="visible" :trail="[...trail, nodeId]" @pick="emit('pick', $event)" @expand="emit('expand', $event)" />
    </div>
  </div>
</template>
