<script setup lang="ts">
import type { CustomerRecipientTemplate } from '../../../mail/types'
import type { CustomerQueryProfile } from '../../../customer/types'

defineProps<{ recipients: CustomerRecipientTemplate[]; customers: CustomerQueryProfile[] }>()
const emit = defineEmits<{ save: [value: { profileId: string; name: string; to: string; cc: string }] }>()
const profileId = defineModel<string>('profileId', { default: '' })
const name = defineModel<string>('name', { default: '' })
const to = defineModel<string>('to', { default: '' })
const cc = defineModel<string>('cc', { default: '' })

function submit(): void {
  emit('save', { profileId: profileId.value, name: name.value.trim(), to: to.value, cc: cc.value })
}
</script>

<template>
  <section class="pm-card">
    <h2>收件人</h2>
    <div class="pm-form">
      <label>客户配置
        <select v-model="profileId">
          <option value="">选择客户</option>
          <option v-for="item in customers" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
      </label>
      <label>模板名称 <input v-model="name" type="text" /></label>
      <label>收件人 <textarea v-model="to" rows="2"></textarea></label>
      <label>抄送人 <textarea v-model="cc" rows="2"></textarea></label>
      <button type="button" class="solid" @click="submit">保存收件人</button>
    </div>
    <p v-if="recipients.length === 0" class="empty">尚未设置收件人。</p>
    <ul v-else>
      <li v-for="item in recipients" :key="item.id">{{ item.name }} · 收件 {{ item.to.length }} · 抄送 {{ item.cc.length }}</li>
    </ul>
  </section>
</template>
