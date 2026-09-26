<script setup lang="ts">
import type { DescriptionMailTypeMapping } from '../../../mail/types'

defineProps<{ mappings: DescriptionMailTypeMapping[] }>()
const emit = defineEmits<{ save: [mapping: { description: string; mailTypeId: string; mailTypeName: string }] }>()
const description = defineModel<string>('description', { default: '' })
const mailTypeId = defineModel<string>('mailTypeId', { default: '' })
const mailTypeName = defineModel<string>('mailTypeName', { default: '' })

function submit(): void {
  emit('save', { description: description.value.trim(), mailTypeId: mailTypeId.value.trim(), mailTypeName: mailTypeName.value.trim() })
}
</script>

<template>
  <section class="pm-card">
    <h2>文件描述映射</h2>
    <div class="pm-form">
      <label>文件描述 <input v-model="description" type="text" /></label>
      <label>发文类型 GUID <input v-model="mailTypeId" type="text" /></label>
      <label>发文类型名称 <input v-model="mailTypeName" type="text" /></label>
      <button type="button" class="solid" @click="submit">保存描述映射</button>
    </div>
    <p v-if="mappings.length === 0" class="empty">尚未设置文件描述映射。</p>
    <table v-else class="pm-table">
      <thead><tr><th>文件描述</th><th>发文类型</th><th>启用</th></tr></thead>
      <tbody>
        <tr v-for="item in mappings" :key="item.id">
          <td>{{ item.fileDescriptionText || item.fileDescriptionId }}</td>
          <td>{{ item.mailTypeName }}</td>
          <td>{{ item.enabled ? '启用' : '停用' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
