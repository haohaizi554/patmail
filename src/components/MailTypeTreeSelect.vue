<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { buildOptionTree, searchOptionTree, type TreeOption } from '../../patmail-extension/src/query/option-tree'
import { placeMenu } from './theme-select'
import MailTypeTreeNode from './MailTypeTreeNode.vue'

const props = withDefaults(defineProps<{
  modelValue?: string
  options: TreeOption[]
  disabled?: boolean
  placeholder?: string
}>(), { modelValue: '', disabled: false, placeholder: '选择发文类型' })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const searchBox = ref<HTMLInputElement | null>(null)
const opened = ref(false)
const portal = ref<HTMLElement | string>('body')
const menuStyle = ref<Record<string, string>>({})
const draft = ref('')
const applied = ref('')
const manualExpanded = ref<Record<string, boolean>>({})
const owner = Symbol('mail-type-tree')
const tree = computed(() => buildOptionTree(props.options.filter(item => item.value)))
const found = computed(() => applied.value.trim() ? searchOptionTree(tree.value, applied.value) : null)
const expanded = computed(() => found.value ? { ...manualExpanded.value, ...Object.fromEntries([...found.value.expand].map(id => [id, true])) } : manualExpanded.value)
const summary = computed(() => tree.value.byId.get(props.modelValue)?.label || props.placeholder)

function resolvePortal(): HTMLElement | string {
  const node = root.value?.getRootNode()
  if (node instanceof ShadowRoot) {
    let holder = node.querySelector<HTMLElement>('#theme-select-portal')
    if (!holder) {
      holder = document.createElement('div')
      holder.id = 'theme-select-portal'
      node.appendChild(holder)
    }
    return holder
  }
  return 'body'
}

function updatePosition(): void {
  const el = trigger.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const placed = placeMenu(
    { top: rect.top, bottom: rect.bottom, left: rect.left, width: Math.max(rect.width, 280) },
    { width: window.innerWidth, height: window.innerHeight },
    320
  )
  menuStyle.value = {
    top: `${placed.top}px`,
    left: `${placed.left}px`,
    width: `${placed.width}px`,
    maxHeight: `${placed.maxHeight}px`
  }
}

function ancestorsOf(id: string): Record<string, boolean> {
  const parentOf = new Map<string, string>()
  for (const node of tree.value.byId.values()) {
    for (const childId of node.childIds) parentOf.set(childId, node.value)
  }
  const openedNodes: Record<string, boolean> = {}
  let parent = parentOf.get(id)
  const trail = new Set<string>([id])
  while (parent && !trail.has(parent)) {
    openedNodes[parent] = true
    trail.add(parent)
    parent = parentOf.get(parent)
  }
  return openedNodes
}

function show(): void {
  if (props.disabled || opened.value) return
  portal.value = resolvePortal()
  opened.value = true
  if (props.modelValue) manualExpanded.value = { ...manualExpanded.value, ...ancestorsOf(props.modelValue) }
  window.dispatchEvent(new CustomEvent('theme-select-open', { detail: owner }))
  void nextTick(() => {
    updatePosition()
    searchBox.value?.focus()
  })
}

function close(): void {
  opened.value = false
}

function search(): void {
  applied.value = draft.value.trim()
}

function pick(id: string): void {
  emit('update:modelValue', id)
  close()
}

function expand(id: string): void {
  manualExpanded.value = { ...manualExpanded.value, [id]: !manualExpanded.value[id] }
}

function onPointer(event: Event): void {
  if (!opened.value) return
  const path = event.composedPath()
  if ((root.value && path.includes(root.value)) || (menu.value && path.includes(menu.value))) return
  close()
}

function onAnother(event: Event): void {
  if ((event as CustomEvent).detail !== owner) close()
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape' && opened.value) {
    event.preventDefault()
    close()
    trigger.value?.focus()
  }
}

watch(opened, (value) => {
  if (value) {
    document.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('theme-select-open', onAnother)
    return
  }
  document.removeEventListener('pointerdown', onPointer, true)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('theme-select-open', onAnother)
})

onBeforeUnmount(() => {
  opened.value = false
  document.removeEventListener('pointerdown', onPointer, true)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('theme-select-open', onAnother)
})
</script>

<template>
  <span ref="root" class="theme-select" @keydown="onKey">
    <button ref="trigger" type="button" class="theme-select-trigger" :class="{ 'is-open': opened }" :disabled="disabled" aria-haspopup="tree" :aria-expanded="opened" @click="opened ? close() : show()">
      <span class="theme-select-value" :class="{ 'is-placeholder': summary === placeholder }">{{ summary }}</span>
      <svg class="theme-select-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.2 6 8l4-3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <Teleport :to="portal">
      <div v-if="opened" ref="menu" class="theme-select-menu theme-tree-menu" role="tree" :style="menuStyle">
        <div class="theme-tree-search">
          <input ref="searchBox" v-model="draft" type="search" placeholder="搜索" aria-label="搜索发文类型" @keydown.enter.prevent="search" />
          <button type="button" class="theme-tree-query" @click="search">查询</button>
        </div>
        <div class="theme-tree-list">
          <MailTypeTreeNode v-for="id in tree.roots" :key="id" :node-id="id" :by-id="tree.byId" :selected="modelValue" :expanded="expanded" :visible="found ? found.visible : null" :trail="[]" @pick="pick" @expand="expand" />
          <p v-if="found && found.visible.size === 0" class="theme-select-empty">没有匹配的发文类型。</p>
        </div>
      </div>
    </Teleport>
  </span>
</template>
