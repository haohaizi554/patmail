<script setup lang="ts">
import type { CustomerMailPolicy, SendMode } from '../../../mail/types'
import type { CustomerQueryProfile } from '../../../customer/types'
import ThemeSelect from '../../../../../src/components/ThemeSelect.vue'

defineProps<{ policies: CustomerMailPolicy[]; customers: CustomerQueryProfile[] }>()
const emit = defineEmits<{ save: [policy: CustomerMailPolicy] }>()
const profileId = defineModel<string>('profileId', { default: '' })
const sendMode = defineModel<SendMode>('sendMode', { default: 'merge_by_customer_description' })

function submit(): void {
  if (!profileId.value) return
  emit('save', {
    customerProfileId: profileId.value,
    sendMode: sendMode.value,
    enabled: true,
    version: 1,
    updatedAt: new Date().toISOString()
  })
}
</script>

<template>
  <section class="card">
    <h2>客户发文方式</h2>
    <div class="stack-form">
      <label>客户配置
        <ThemeSelect v-model="profileId" :options="[{ value: '', label: '选择客户' }, ...customers.map(item => ({ value: item.id, label: item.name }))]" />
      </label>
      <label>发文方式
        <ThemeSelect v-model="sendMode" :options="[{ value: 'merge_by_customer_description', label: '按客户和文件描述合并' }, { value: 'single_file', label: '一文件一封' }]" />
      </label>
      <button type="button" class="solid" @click="submit">保存发文方式</button>
    </div>
    <p v-if="policies.length === 0" class="empty">尚未设置发文方式。</p>
    <table v-else class="grid">
      <thead><tr><th>客户配置</th><th>方式</th><th>启用</th></tr></thead>
      <tbody>
        <tr v-for="item in policies" :key="item.customerProfileId">
          <td>{{ item.customerProfileId }}</td>
          <td>{{ item.sendMode === 'single_file' ? '一文件一封' : '按客户和文件描述合并' }}</td>
          <td>{{ item.enabled ? '启用' : '停用' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
