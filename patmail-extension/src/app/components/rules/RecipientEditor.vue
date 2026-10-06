<script setup lang="ts">
import type { CustomerRecipientTemplate } from '../../../mail/types'
import type { CustomerQueryProfile } from '../../../customer/types'
import ThemeSelect from '../../../shell/components/ThemeSelect.vue'
import EmptyGuide from '../EmptyGuide.vue'

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
  <section class="card">
    <h2>收件人</h2>
    <div class="rule-fields">
      <EmptyGuide v-if="customers.length === 0" text="还没有客户，收件人没法配。去客户管理建一个再回来。" action="去创建客户" hash="/customers" />
      <label v-else>客户配置
        <ThemeSelect v-model="profileId" placeholder="选择客户" :options="customers.map(item => ({ value: item.id, label: item.name }))" />
      </label>
      <label>模板名称 <input v-model="name" type="text" /></label>
      <label>收件人 <textarea v-model="to" rows="2"></textarea></label>
      <label>抄送人 <textarea v-model="cc" rows="2"></textarea></label>
      <button type="button" class="solid" @click="submit">保存收件人</button>
    </div>
    <p v-if="recipients.length === 0" class="empty">还没有收件人。在上面选好客户、填上邮箱，再点保存。</p>
    <ul v-else>
      <li v-for="item in recipients" :key="item.id">{{ item.name }} · 收件 {{ item.to.length }} · 抄送 {{ item.cc.length }}</li>
    </ul>
  </section>
</template>
