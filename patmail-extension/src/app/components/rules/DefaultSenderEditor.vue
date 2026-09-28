<script setup lang="ts">
import { ref, watch } from 'vue'
import ThemeSelect from '../../../../../src/components/ThemeSelect.vue'
import type { DefaultSender } from '../../../mail/types'

const props = defineProps<{
  senders: Array<{ id: string; label: string }>
  selected: DefaultSender | null
  notice: string
}>()
const emit = defineEmits<{ save: [value: DefaultSender]; reload: [] }>()
const mailsetId = ref(props.selected?.mailsetId ?? '')

watch(() => props.selected, value => { mailsetId.value = value?.mailsetId ?? '' })

function save(): void {
  const row = props.senders.find(item => item.id === mailsetId.value)
  if (row) {
    emit('save', { mailsetId: row.id, label: row.label })
    return
  }
  if (props.selected && props.selected.mailsetId === mailsetId.value) emit('save', props.selected)
}
</script>

<template>
  <section class="card">
    <h2>默认发件人</h2>
    <p class="hint">名单来自原网站的发件邮箱。设成默认后记在本机，以后创建发文任务会直接带上，也可以在任务里再改。</p>
    <p v-if="notice" class="hint">{{ notice }}</p>
    <p v-if="selected" class="hint">当前默认：{{ selected.label }}</p>
    <div class="filters">
      <ThemeSelect v-model="mailsetId" placeholder="选择发件邮箱" :options="senders.map(item => ({ value: item.id, label: item.label }))" />
      <button type="button" class="solid" @click="save">保存默认发件人</button>
      <button type="button" class="text-button" @click="emit('reload')">重新读取发件邮箱</button>
    </div>
  </section>
</template>
