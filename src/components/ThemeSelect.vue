<script setup lang="ts" generic="T extends string | number">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { filterSelectOptions, highlightAfterKey, menuWidthForLabels, placeMenu, selectNeedsSearch, showsGroup, type ThemeSelectOption } from './theme-select'

interface Option extends ThemeSelectOption { value: T }

const props = withDefaults(defineProps<{
  modelValue?: T
  options: Option[]
  disabled?: boolean
  placeholder?: string
}>(), {
  disabled: false,
  placeholder: '请选择'
})

const emit = defineEmits<{
  'update:modelValue': [value: T]
  change: [value: T]
  open: []
}>()

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const searchBox = ref<HTMLInputElement | null>(null)
const opened = ref(false)
const query = ref('')
const highlight = ref(-1)
const portal = ref<HTMLElement | string>('body')
const menuStyle = ref<Record<string, string>>({})
const internal = ref<T | undefined>(props.modelValue ?? props.options[0]?.value)
const listId = `theme-select-${Math.random().toString(36).slice(2, 9)}`
const owner = Symbol('theme-select')

const current = computed(() => props.modelValue !== undefined ? props.modelValue : internal.value)
const selected = computed(() => props.options.find(item => item.value === current.value))
const searchable = computed(() => selectNeedsSearch(props.options.length))
const listed = computed(() => searchable.value ? filterSelectOptions(props.options, query.value) : props.options)
const shown = computed(() => selected.value?.label || (current.value === '' || current.value == null ? props.placeholder : String(current.value)))
const placeholderShown = computed(() => !selected.value || selected.value.value === '')

function optionId(index: number): string {
  return `${listId}-${index}`
}

function toneClass(tone: string | undefined): string {
  return tone === 'site' || tone === 'diy' ? `is-tone-${tone}` : ''
}

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
  const labels = props.options.flatMap(item => {
    const text = item.badge ? `${item.badge} ${item.label}` : item.label
    return item.group ? [text, item.group] : [text]
  })
  const placed = placeMenu(
    { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
    { width: window.innerWidth, height: window.innerHeight },
    240,
    menuWidthForLabels(labels)
  )
  menuStyle.value = {
    top: `${placed.top}px`,
    left: `${placed.left}px`,
    width: `${placed.width}px`,
    maxHeight: `${placed.maxHeight}px`
  }
}

function scrollHighlight(): void {
  if (highlight.value < 0) return
  menu.value?.querySelector(`#${CSS.escape(optionId(highlight.value))}`)?.scrollIntoView({ block: 'nearest' })
}

function closeOthers(): void {
  window.dispatchEvent(new CustomEvent('theme-select-open', { detail: owner }))
}

function show(): void {
  if (props.disabled || opened.value) return
  portal.value = resolvePortal()
  query.value = ''
  const index = props.options.findIndex(item => item.value === current.value && item.value !== '')
  highlight.value = index >= 0 ? index : 0
  opened.value = true
  closeOthers()
  emit('open')
  void nextTick(() => {
    updatePosition()
    if (searchable.value) searchBox.value?.focus()
    scrollHighlight()
  })
}

function close(): void {
  opened.value = false
}

function choose(option: Option): void {
  if (option.disabled) return
  internal.value = option.value
  emit('update:modelValue', option.value)
  emit('change', option.value)
  close()
  trigger.value?.focus()
}

function onKey(event: KeyboardEvent): void {
  if (props.disabled) return
  const result = highlightAfterKey(highlight.value, listed.value.length, event.key, opened.value)
  if (result.action === 'none') return
  if (result.action === 'open') {
    event.preventDefault()
    show()
    return
  }
  if (result.action === 'close') {
    event.preventDefault()
    close()
    return
  }
  event.preventDefault()
  highlight.value = result.highlight
  if (result.action === 'select') {
    const option = listed.value[result.highlight]
    if (option) choose(option)
    return
  }
  void nextTick(scrollHighlight)
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

function onSearchKey(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End' || event.key === 'Enter' || event.key === 'Escape') onKey(event)
}

watch(query, (value) => {
  if (!opened.value || !value.trim()) return
  highlight.value = listed.value.length ? 0 : -1
})

watch(() => props.modelValue, (value) => {
  if (value !== undefined) internal.value = value
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
  <span ref="root" class="theme-select">
    <button
      ref="trigger"
      type="button"
      class="theme-select-trigger"
      :class="{ 'is-open': opened }"
      role="combobox"
      :aria-expanded="opened"
      aria-haspopup="listbox"
      :aria-controls="listId"
      :aria-activedescendant="opened && highlight >= 0 ? optionId(highlight) : undefined"
      :disabled="disabled"
      @click="opened ? close() : show()"
      @keydown="onKey"
    >
      <span class="theme-select-value" :class="{ 'is-placeholder': placeholderShown }">
        <span v-if="selected?.badge && !placeholderShown" class="theme-select-badge" :class="toneClass(selected.tone)">{{ selected.badge }}</span>
        <span class="theme-select-label">{{ shown }}</span>
      </span>
      <svg class="theme-select-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.2 6 8l4-3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <Teleport :to="portal">
      <ul v-if="opened" :id="listId" ref="menu" class="theme-select-menu" role="listbox" :style="menuStyle" @mousedown.prevent>
        <li v-if="searchable" class="theme-select-search" role="presentation" @mousedown.stop>
          <input ref="searchBox" v-model="query" type="search" placeholder="搜索" aria-label="搜索选项" @keydown="onSearchKey" />
        </li>
        <template v-for="(option, index) in listed" :key="`${option.group ?? ''}:${String(option.value)}:${index}`">
          <li v-if="showsGroup(listed, index)" class="theme-select-group" role="presentation">{{ option.group }}</li>
          <li
            :id="optionId(index)"
            role="option"
            :aria-selected="option.value === current"
            :class="[toneClass(option.tone), { 'is-selected': option.value === current, 'is-active': index === highlight, 'is-disabled': option.disabled }]"
            @mouseenter="highlight = index"
            @click="choose(option)"
          >
            <span v-if="option.badge" class="theme-select-badge" :class="toneClass(option.tone)">{{ option.badge }}</span>
            <span class="theme-select-label">{{ option.label }}</span>
          </li>
        </template>
        <li v-if="listed.length === 0" class="theme-select-empty" role="presentation">{{ query.trim() ? '没有匹配的选项' : '没有可选项' }}</li>
      </ul>
    </Teleport>
  </span>
</template>
