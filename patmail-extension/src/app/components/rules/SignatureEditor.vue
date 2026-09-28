<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ThemeSelect from '../../../../../src/components/ThemeSelect.vue'
import type { MailSignatureItem } from '../../../mail/easy/signature-read'
import type { OperatorSignature } from '../../../mail/types'

const props = defineProps<{
  signatures: OperatorSignature[]
  reserved: MailSignatureItem | null
  items: MailSignatureItem[]
  notice: string
}>()
const emit = defineEmits<{ save: [value: { name: string; content: string }]; reload: [] }>()
const name = defineModel<string>('name', { default: '' })
const content = defineModel<string>('content', { default: '' })
const picked = ref('')

const options = computed(() => props.items.map(item => ({ value: item.id || item.name, label: item.name })))

watch(() => props.reserved, value => {
  if (!value) return
  picked.value = value.id || value.name
  name.value = value.name
  content.value = value.content
})

function choose(value: string): void {
  picked.value = value
  const row = props.items.find(item => (item.id || item.name) === value)
  if (!row) return
  name.value = row.name
  content.value = row.content
}
</script>

<template>
  <section class="card">
    <h2>操作员签名</h2>
    <p class="hint">按默认发件邮箱读取原站预留的签名。一个邮箱只带一条预留签名，正文会一起读回来。保存后这个操作员只保留这一条。</p>
    <p v-if="notice" class="hint">{{ notice }}</p>
    <div class="rule-fields">
      <label v-if="options.length" class="span-row">原站签名
        <ThemeSelect :model-value="picked" placeholder="选择签名" :options="options" @update:model-value="choose(String($event))" />
      </label>
      <label class="span-row">签名名称 <input v-model="name" type="text" /></label>
      <label class="span-row">签名内容 <textarea v-model="content" rows="6"></textarea></label>
      <button type="button" class="solid" @click="emit('save', { name: name.trim(), content })">用作操作员签名</button>
      <button type="button" class="text-button" @click="emit('reload')">重新读取签名</button>
    </div>
    <p v-if="signatures.length === 0" class="empty">尚未设置签名。</p>
    <ul v-else>
      <li v-for="item in signatures" :key="item.id">
        <strong>{{ item.name }}</strong>
        <p class="hint">{{ item.content }}</p>
      </li>
    </ul>
  </section>
</template>
