<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { DOC_GROUPS, type DocEntry } from '../docs'
import { renderAgentMarkdown } from '../../agent/markdown'

const open = ref(false)
const active = ref<DocEntry | null>(null)
const html = ref('')
const loading = ref(false)
const body = ref<HTMLElement | null>(null)
const openSections = ref<DocEntry[]>([])
let loadToken = 0

async function show(entry: DocEntry): Promise<void> {
  const loader = entry.load
  if (!loader) return
  active.value = entry
  loading.value = true
  html.value = ''
  const token = ++loadToken
  void nextTick(() => body.value?.scrollTo({ top: 0 }))
  try {
    const text = await loader()
    if (token !== loadToken) return
    html.value = renderAgentMarkdown(text.trim()
      ? text
      : '# 这一篇是空的\n\n文件没有内容，或文件被移走、改名了。重新构建扩展后再试。')
  } catch {
    if (token === loadToken) html.value = renderAgentMarkdown('# 这一篇没有读到\n\n文件可能被移走或改名了。重新构建扩展后再试。')
  } finally {
    if (token === loadToken) loading.value = false
  }
}

function sectionOpen(entry: DocEntry): boolean {
  return openSections.value.includes(entry)
}

function toggleSection(entry: DocEntry): void {
  openSections.value = sectionOpen(entry)
    ? openSections.value.filter(item => item !== entry)
    : [...openSections.value, entry]
}

function toggle(): void {
  open.value = !open.value
  if (open.value && !active.value) {
    const first = DOC_GROUPS[0]?.entries[0]
    if (first?.load) void show(first)
  }
}

function onKey(event: KeyboardEvent): void {
  if (!open.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    open.value = false
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <button type="button" class="docs-entry" :class="{ on: open }" :aria-expanded="open" aria-haspopup="dialog" @click="toggle">
    文档
  </button>
  <Teleport to="body">
    <div v-if="open" class="docs-mask" @click.self="open = false">
      <section class="docs-float" role="dialog" aria-modal="true" aria-label="PatMail 文档">
        <header class="docs-head">
          <h3>PatMail 文档</h3>
          <span class="docs-head-sub">{{ active?.title }}</span>
          <button type="button" aria-label="关闭" @click="open = false">×</button>
        </header>
        <div class="docs-layout">
          <nav class="docs-tree" aria-label="文档目录">
            <div v-for="group in DOC_GROUPS" :key="group.name" class="docs-group">
              <p class="docs-group-name">{{ group.name }}</p>
              <template v-for="entry in group.entries" :key="entry.title">
                <button
                  v-if="entry.children"
                  type="button"
                  class="docs-leaf docs-section"
                  :class="{ open: sectionOpen(entry) }"
                  :aria-expanded="sectionOpen(entry)"
                  @click="toggleSection(entry)"
                >{{ entry.title }}</button>
                <button
                  v-else
                  type="button"
                  class="docs-leaf"
                  :class="{ on: active === entry }"
                  @click="show(entry)"
                >{{ entry.title }}</button>
                <template v-if="entry.children && sectionOpen(entry)">
                  <button
                    v-for="leaf in entry.children"
                    :key="leaf.title"
                    type="button"
                    class="docs-leaf docs-sub"
                    :class="{ on: active === leaf }"
                    @click="show(leaf)"
                  >{{ leaf.title }}</button>
                </template>
              </template>
            </div>
          </nav>
          <div ref="body" class="docs-body">
            <p v-if="loading" class="docs-loading">正在读取这一篇…</p>
            <div class="docs-md" v-html="html"></div>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>