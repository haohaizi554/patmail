<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorkspace } from '../composables/useWorkspace'

const { connection, rules, call } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const subject = ref('')
const body = ref('')
watch(rules, (bundle) => {
  if (!bundle) return
  subject.value = bundle.subject.template
  body.value = bundle.body.template
}, { immediate: true })

async function save(): Promise<void> {
  if (!rules.value) return
  await call({
    action: 'saveRules',
    bundle: {
      ...rules.value,
      ownerId: connection.value.operatorId,
      subject: { ...rules.value.subject, template: subject.value },
      body: { ...rules.value.body, template: body.value }
    }
  })
}
</script>

<template>
  <section v-if="!ready || !rules" class="pm-card"><p class="empty">尚未确认 EASY 用户，不能读取发文规则。</p></section>
  <form v-else class="pm-card pm-form" @submit.prevent="save">
    <h2>发文规则</h2>
    <p class="hint">保存到当前账号的版本化配置。内容变化后，未发出的旧任务会标记为过期。</p>
    <p class="hint">当前版本 {{ rules.revision }} · 映射 {{ rules.mappings.length }} · 收件人 {{ rules.recipients.length }} · 签名 {{ rules.signatures.length }}</p>
    <label>标题模板 <textarea v-model="subject" rows="3"></textarea></label>
    <label>正文模板 <textarea v-model="body" rows="5"></textarea></label>
    <table v-if="rules.mappings.length" class="pm-table">
      <thead><tr><th>文件描述</th><th>发文类型</th><th>启用</th></tr></thead>
      <tbody>
        <tr v-for="item in rules.mappings" :key="item.id">
          <td>{{ item.fileDescriptionText || item.fileDescriptionId || '未命名' }}</td>
          <td>{{ item.mailTypeName }}</td>
          <td>{{ item.enabled ? '启用' : '停用' }}</td>
        </tr>
      </tbody>
    </table>
    <button class="solid" type="submit">保存规则</button>
  </form>
</template>
