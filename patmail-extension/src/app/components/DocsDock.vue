<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { DOC_GROUPS, type DocEntry } from '../docs'
import { renderAgentMarkdown } from '../../agent/markdown'

const open = ref(false)
const active = ref<DocEntry | null>(null)
const html = ref('')
const loading = ref(false)
const body = ref<HTMLElement | null>(null)
let loadToken = 0

async function show(entry: DocEntry): Promise<void> {
  active.value = entry
  loading.value = true
  html.value = ''
  const token = ++loadToken
  void nextTick(() => body.value?.scrollTo({ top: 0 }))
  try {
    const text = await entry.load()
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

function toggle(): void {
  open.value = !open.value
  if (open.value && !active.value) {
    const first = DOC_GROUPS[0]?.entries[0]
    if (first) void show(first)
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
              <button
                v-for="entry in group.entries"
                :key="entry.title"
                type="button"
                class="docs-leaf"
                :class="{ on: active?.title === entry.title }"
                @click="show(entry)"
              >{{ entry.title }}</button>
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