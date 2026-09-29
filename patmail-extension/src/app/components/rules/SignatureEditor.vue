<script setup lang="ts">
import { ref } from 'vue'
import type { MailSignatureItem } from '../../../mail/easy/signature-read'
import { signatureKey } from '../../../mail/signature-catalog'
import type { OperatorSignature } from '../../../mail/types'

defineProps<{
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
    <p class="hint">原站签名直接使用，不用再存一遍。自己写的签名记在本机，作为暂存。默认用原站；要换的话点「设为默认」。发文任务里会把两边一起列出来。</p>
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
    <p class="signature-kind is-diy">暂存</p>
    <div class="rule-fields">
      <label class="span-row">签名名称 <input v-model="name" type="text" maxlength="80" /></label>
      <label class="span-row">签名内容 <textarea v-model="content" rows="6" maxlength="4000"></textarea></label>
      <button type="button" class="solid" @click="add">添加暂存签名</button>
      <button type="button" class="text-button" @click="emit('reload')">重新读取原站签名</button>
    </div>
    <p v-if="signatures.length === 0" class="empty">还没有暂存签名。在上面写好名称和内容，再点添加。</p>
    <ul v-else class="signature-list">
      <li v-for="item in signatures" :key="item.id" class="is-diy">
        <div class="signature-line">
          <span class="signature-mark is-diy">暂存</span>
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
