<script setup lang="ts">
import { computed, inject, onActivated, onMounted, ref } from 'vue'
import { PCL_ORIGIN } from '../../api/config'
import { downloadContactWorkbook } from '../../case-contact/xlsx'
import type { CaseContactRow } from '../../case-contact/query'
import { CASE_CONTACT_CUSTOMER_NAME, hasCaseContactSkill, rememberedCaseContactCustomer } from '../../customer/skills'
import { splitCaseVolumes } from '../../customer/volume-list'
import { MessageType, type MessageBridge } from '../../shared/message'
import { useWorkspace } from '../composables/useWorkspace'

const bridge = inject<MessageBridge>('bridge')
const { connection, customers, call } = useWorkspace()
const customerId = ref('')
function syncCustomer(): void {
  customerId.value = rememberedCaseContactCustomer()
}
const customer = computed(() => customers.value.find(item => item.id === customerId.value && hasCaseContactSkill(item)) ?? null)
const onPcl = computed(() => connection.value.easyOrigin === PCL_ORIGIN)
const ready = computed(() => Boolean(customer.value) && onPcl.value && connection.value.sessionStatus === 'authenticated')
const who = computed(() => connection.value.displayName || '当前账号')
const text = ref('')
const rows = ref<CaseContactRow[]>([])
const message = ref('')
const loading = ref(false)

onMounted(() => {
  syncCustomer()
  void call({ action: 'refreshSession' })
})
onActivated(syncCustomer)

async function run(): Promise<void> {
  const volumes = splitCaseVolumes(text.value)
  if (!bridge || !ready.value) {
    message.value = onPcl.value ? `还没有读到${CASE_CONTACT_CUSTOMER_NAME}的登录。请刷新那个 EASY 页面。` : `请先打开${CASE_CONTACT_CUSTOMER_NAME}的 EASY 并刷新页面。`
    return
  }
  if (volumes.length === 0) {
    message.value = '先贴上客户案号。'
    return
  }
  loading.value = true
  message.value = ''
  rows.value = []
  const response = await bridge.request({ type: MessageType.ExportCaseContacts, payload: { volumes } })
  loading.value = false
  if (response.type === MessageType.Error) {
    message.value = response.payload.message
    if (response.payload.message.includes('登录')) void call({ action: 'refreshSession' })
    return
  }
  if (response.type !== MessageType.ExportCaseContactsResult) {
    message.value = '导出返回了意外结果。'
    return
  }
  if (!response.payload.ok) {
    message.value = response.payload.error.message
    if (response.payload.error.code === 'SESSION_EXPIRED') void call({ action: 'refreshSession' })
    return
  }
  rows.value = response.payload.data.rows
  const { unmatched, failed } = response.payload.data
  const notes = [`${rows.value.length} 件`]
  if (unmatched.length) notes.push(`${unmatched.length} 件没有查到`)
  if (failed.length) notes.push(`${failed.length} 件没有读全`)
  message.value = notes.join('，') + '。'
  downloadContactWorkbook(rows.value)
}
</script>

<template>
  <section v-if="!customer" class="card contact-sheet">
    <p class="crumb"><a href="#/customers">客户管理</a></p>
    <h1>导出联系人还没打开</h1>
    <p class="empty">先创建客户「{{ CASE_CONTACT_CUSTOMER_NAME }}」并保存。改成别的名字后，这项会关掉。</p>
  </section>
  <section v-else class="card contact-sheet">
    <p class="crumb"><a href="#/customers">客户管理</a> / {{ customer.name }}</p>
    <h1>导出技术负责人和第一发明人邮箱</h1>
    <p v-if="ready" class="hint">已检测到登录：{{ who }}。邮箱取著录项目里第一位发明人。</p>
    <p v-else-if="onPcl" class="empty">{{ CASE_CONTACT_CUSTOMER_NAME }}页面已打开，还没有读到登录。请刷新那个页面。</p>
    <p v-else class="empty">请先打开{{ CASE_CONTACT_CUSTOMER_NAME }}的 EASY 并刷新页面，这里才会读到登录。</p>
    <form class="stack-form" @submit.prevent="run">
      <label>客户案号
        <textarea v-model="text" rows="8" placeholder="一行一个。也可以用分号或空格分开。" />
      </label>
      <button class="solid" type="submit" :disabled="loading || !ready">{{ loading ? '读取中' : '导出 Excel' }}</button>
      <p v-if="message" class="hint">{{ message }}</p>
    </form>
  </section>
  <section v-if="rows.length" class="card">
    <table class="grid">
      <thead>
        <tr><th>客户案号</th><th>技术负责人</th><th>邮箱</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.volume">
          <td>{{ row.volume }}</td>
          <td>{{ row.tech }}</td>
          <td>{{ row.email }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
