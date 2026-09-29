<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { buildOptionTree, searchOptionTree, type TreeOption } from '../../patmail-extension/src/query/option-tree'
import { menuBoxStyle, placeMenu, treeMenuWidth } from './theme-select'
import MailTypeTreeNode from './MailTypeTreeNode.vue'

const props = withDefaults(defineProps<{
  modelValue?: string
  options: TreeOption[]
  disabled?: boolean
  placeholder?: string
  emptyText?: string
  searchLabel?: string
  /** 分类节点只负责展开，点名字不会选中。 */
  leavesOnly?: boolean
}>(), {
  modelValue: '',
  disabled: false,
  placeholder: '选择发文类型',
  emptyText: '没有匹配的发文类型。',
  searchLabel: '搜索发文类型',
  leavesOnly: false
})
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

watch(draft, value => {
  applied.value = value.trim()
})
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
    { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
    { width: window.innerWidth, height: window.innerHeight },
    320,
    treeMenuWidth(props.options)
  )
  menuStyle.value = menuBoxStyle(placed)
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
  draft.value = ''
}

function search(): void {
  applied.value = draft.value.trim()
}

function pick(id: string): void {
  if (props.leavesOnly && (tree.value.byId.get(id)?.childIds.length ?? 0) > 0) {
    expand(id)
    return
  }
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
          <input ref="searchBox" v-model="draft" type="search" placeholder="搜索" :aria-label="searchLabel" @keydown.enter.prevent="search" />
        </div>
        <div class="theme-tree-list">
          <MailTypeTreeNode v-for="id in tree.roots" :key="id" :node-id="id" :by-id="tree.byId" :selected="modelValue" :expanded="expanded" :visible="found ? found.visible : null" :trail="[]" @pick="pick" @expand="expand" />
          <p v-if="found && found.visible.size === 0" class="theme-select-empty">{{ emptyText }}</p>
        </div>
      </div>
    </Teleport>
  </span>
</template>
