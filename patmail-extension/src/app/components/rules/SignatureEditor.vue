<script setup lang="ts">
import { computed, ref } from 'vue'
import ThemeSelect from '../../../shell/components/ThemeSelect.vue'
import type { MailSignatureItem } from '../../../mail/easy/signature-read'
import { signatureKey } from '../../../mail/signature-catalog'
import type { OperatorSignature } from '../../../mail/types'

const props = defineProps<{
  signatures: OperatorSignature[]
  items: MailSignatureItem[]
  activeKey: string
  notice: string
}>()
const emit = defineEmits<{
  save: [value: { name: string; content: string }]
  remove: [id: string]
  prefer: [key: string]
  reload: []
}>()
const name = ref('')
const content = ref('')
const choices = computed(() => [
  ...props.items.map(item => ({ value: signatureKey('site', item.id), label: `${item.name}（原站）` })),
  ...props.signatures.filter(item => item.enabled && item.name.trim()).map(item => ({ value: signatureKey('diy', item.id), label: `${item.name}（操作员）` }))
])

function chooseDefault(value: string): void {
  if (!value || value === props.activeKey) return
  emit('prefer', value)
}

function add(): void {
  const nextName = name.value.trim()
  const nextContent = content.value.trim()
  if (!nextName || !nextContent) {
    emit('save', { name: nextName, content: nextContent })
    return
  }
  emit('save', { name: nextName.slice(0, 80), content: nextContent.slice(0, 4000) })
  name.value = ''
  content.value = ''
}
</script>

<template>
  <section class="card">
    <h2>操作员签名</h2>
    <p class="hint">可以沿用原站签名，也可以在下面写一条操作员自己的签名。默认签名从这里选。文件管理发文会按发文页邮件签名下拉的格式把选中的原站签名写进正文。</p>
    <label>默认签名
      <ThemeSelect :model-value="activeKey" placeholder="选择默认签名" empty-text="还没有签名。先读取原站，或在下面添加一条操作员签名。" :options="choices" @update:model-value="chooseDefault(String($event))" />
    </label>
    <p v-if="notice" class="hint">{{ notice }}</p>
    <p class="signature-kind is-site">原站</p>
    <p v-if="items.length === 0" class="empty">还没有读到原站签名。点下面的重新读取。</p>
    <ul v-else class="signature-list">
      <li v-for="item in items" :key="item.id" class="is-site">
        <div class="signature-line">
          <strong>{{ item.name }}</strong>
          <span v-if="activeKey === signatureKey('site', item.id)" class="hint">当前默认</span>
          <button v-else type="button" class="text-button" @click="emit('prefer', signatureKey('site', item.id))">设为默认</button>
        </div>
        <p class="hint">{{ item.content }}</p>
      </li>
    </ul>
    <p class="signature-kind is-diy">操作员</p>
    <div class="rule-fields">
      <label class="span-row">签名名称 <input v-model="name" type="text" maxlength="80" /></label>
      <label class="span-row">签名内容 <textarea v-model="content" rows="6" maxlength="4000"></textarea></label>
      <button type="button" class="solid" @click="add">添加操作员签名</button>
      <button type="button" class="text-button" @click="emit('reload')">重新读取原站签名</button>
    </div>
    <p v-if="signatures.length === 0" class="empty">还没有操作员签名。在上面写好名称和内容，再点添加。</p>
    <ul v-else class="signature-list">
      <li v-for="item in signatures" :key="item.id" class="is-diy">
        <div class="signature-line">
          <span class="signature-mark is-diy">操作员</span>
          <strong>{{ item.name }}</strong>
          <span v-if="activeKey === signatureKey('diy', item.id)" class="hint">当前默认</span>
          <button v-else type="button" class="text-button" @click="emit('prefer', signatureKey('diy', item.id))">设为默认</button>
          <button type="button" class="text-button" @click="emit('remove', item.id)">删除</button>
        </div>
        <p class="hint">{{ item.content }}</p>
      </li>
    </ul>
  </section>
</template>
