<script setup lang="ts">
import type { OperatorSignature } from '../../../mail/types'

defineProps<{ signatures: OperatorSignature[] }>()
const emit = defineEmits<{ save: [value: { name: string; content: string }] }>()
const name = defineModel<string>('name', { default: '' })
const content = defineModel<string>('content', { default: '' })
</script>

<template>
  <section class="card">
    <h2>操作员签名</h2>
    <div class="stack-form">
      <label>签名名称 <input v-model="name" type="text" /></label>
      <label>签名内容 <textarea v-model="content" rows="3"></textarea></label>
      <button type="button" class="solid" @click="emit('save', { name: name.trim(), content })">保存签名</button>
    </div>
    <p v-if="signatures.length === 0" class="empty">尚未设置签名。</p>
    <ul v-else>
      <li v-for="item in signatures" :key="item.id">{{ item.name }}</li>
    </ul>
  </section>
</template>
