<script setup lang="ts">
import { ref, watch } from 'vue'
import ThemeSelect from '../../../../../src/components/ThemeSelect.vue'
import type { DefaultReviewer } from '../../../mail/types'

const props = defineProps<{
  reviewers: Array<{ id: string; name: string }>
  currentId: string
  selected: DefaultReviewer | null
  notice: string
}>()
const emit = defineEmits<{ save: [value: DefaultReviewer] }>()
const userId = ref(props.selected?.userId ?? '')

watch(() => props.selected, value => { userId.value = value?.userId ?? '' })

function label(row: { id: string; name: string }): string {
  return row.id.toLowerCase() === props.currentId.toLowerCase() ? `${row.name}（当前账号）` : row.name
}
function useSelf(): void {
  const self = props.reviewers.find(item => item.id.toLowerCase() === props.currentId.toLowerCase())
  if (self) userId.value = self.id
}
function save(): void {
  const row = props.reviewers.find(item => item.id === userId.value)
  if (!row) return
  emit('save', { userId: row.id, name: row.name })
}
</script>

<template>
  <section class="card">
    <h2>默认审核人</h2>
    <p class="hint">名单来自原网站的人员树，没有进行中的发文也能选。一般选自己，拼发文任务时会直接带上，不用再选一次。</p>
    <p v-if="notice" class="hint">{{ notice }}</p>
    <p v-if="selected" class="hint">当前默认：{{ selected.name }}</p>
    <div class="filters">
      <ThemeSelect v-model="userId" placeholder="选择审核人" :options="reviewers.map(item => ({ value: item.id, label: label(item) }))" />
      <button type="button" class="ghost" @click="useSelf">设为当前账号</button>
      <button type="button" class="solid" @click="save">保存默认审核人</button>
    </div>
  </section>
</template>
