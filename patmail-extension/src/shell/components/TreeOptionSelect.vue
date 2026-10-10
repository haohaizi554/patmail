<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { buildOptionTree, searchOptionTree, type TreeOption } from '../../query/option-tree'
import { menuBoxStyle, placeMenu, treeMenuWidth } from './theme-select'
import TreeOptionNode from './TreeOptionNode.vue'

const props = withDefaults(defineProps<{
  modelValue?: string
  options: TreeOption[]
  disabled?: boolean
}>(), { modelValue: '', disabled: false })
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
const owner = Symbol('tree-option-select')
const tree = computed(() => buildOptionTree(props.options.filter(item => item.value)))
const selected = computed(() => props.modelValue.split(',').map(item => item.trim()).filter(Boolean))
const found = computed(() => applied.value.trim() ? searchOptionTree(tree.value, applied.value) : null)
const expanded = computed(() => found.value ? { ...manualExpanded.value, ...Object.fromEntries([...found.value.expand].map(id => [id, true])) } : manualExpanded.value)
const summary = computed(() => {
  const names = selected.value.map(id => tree.value.byId.get(id)?.label).filter((item): item is string => Boolean(item))
  if (names.length === 0) return selected.value.length ? `已选 ${selected.value.length} 项` : '不限'
  if (names.length <= 2) return names.join('、')
  return `${names.slice(0, 2).join('、')} 等 ${names.length} 项`
})

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

function show(): void {
  if (props.disabled || opened.value) return
  portal.value = resolvePortal()
  opened.value = true
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

function clearSelection(): void {
  emit('update:modelValue', '')
}

function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  emit('update:modelValue', [...next].join(','))
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
      <span class="theme-select-value" :class="{ 'is-placeholder': summary === '不限' }">{{ summary }}</span>
      <svg class="theme-select-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.2 6 8l4-3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <Teleport :to="portal">
      <div v-if="opened" ref="menu" class="theme-select-menu theme-tree-menu" role="tree" :style="menuStyle">
        <div class="theme-tree-search">
          <input ref="searchBox" v-model="draft" type="search" placeholder="搜索" aria-label="搜索" @keydown.enter.prevent="search" />
          <button type="button" class="theme-tree-query" @click="search">查询</button>
        </div>
        <div class="theme-tree-list">
          <TreeOptionNode v-for="id in tree.roots" :key="id" :node-id="id" :by-id="tree.byId" :selected="selected" :expanded="expanded" :visible="found ? found.visible : null" :trail="[]" @toggle="toggle" @expand="expand" />
          <p v-if="found && found.visible.size === 0" class="theme-select-empty">没有匹配的选项。</p>
        </div>
        <button type="button" class="theme-tree-clear" @click="clearSelection">清除</button>
      </div>
    </Teleport>
  </span>
</template>
