<script setup lang="ts">
import { computed } from 'vue'
import type { PageSnapshot } from '../shared/types'

const props = defineProps<{ snapshot: PageSnapshot }>()
const PREVIEW_CONTROL_LIMIT = 20
const PREVIEW_CHAR_LIMIT = 12_000

/** 预览只序列化少量控件；完整快照由用户点击“复制 JSON”时按需生成。 */
const preview = computed(() => {
  const excerpt = {
    version: props.snapshot.version,
    page: props.snapshot.page,
    stats: props.snapshot.stats,
    iframes: props.snapshot.iframes,
    controls: props.snapshot.controls.slice(0, PREVIEW_CONTROL_LIMIT)
  }
  const formatted = JSON.stringify(excerpt, null, 2)
  return formatted.length > PREVIEW_CHAR_LIMIT ? `${formatted.slice(0, PREVIEW_CHAR_LIMIT)}\n…预览已截断` : formatted
})
</script>

<template>
  <section class="card dom" aria-label="DOM 结构化预览">
    <div class="section-heading"><span class="eyebrow">SCANNER DEBUG</span><span class="result-note">V2</span></div>
    <p class="preview-note">预览前 {{ Math.min(snapshot.controls.length, PREVIEW_CONTROL_LIMIT) }} / {{ snapshot.controls.length }} 个控件，复制可取得完整 JSON。</p>
    <pre>{{ preview }}</pre>
  </section>
</template>
