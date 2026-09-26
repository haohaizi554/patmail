<script setup lang="ts">
import { computed, ref } from 'vue'
import { isFileSearchBusinessField } from '../../api/file-search-params'
import { isQueryGuid } from '../../query/query-validator'
import { useWorkspace } from '../composables/useWorkspace'

const { connection, customers, call } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const name = ref('')
const easyId = ref('')
const templateId = ref('manual')
const enabled = ref(true)
const editingId = ref('')
const createdAt = ref('')
const overrides = ref<Record<string, string>>({})
const overrideText = ref('')
const resetOverrides = ref(false)
const formMessage = ref('')

const preview = computed(() => Object.entries(overrides.value))

function edit(id: string): void {
  const profile = customers.value.find(item => item.id === id)
  if (!profile) return
  editingId.value = profile.id
  name.value = profile.name
  easyId.value = profile.easyCustomerId ?? ''
  templateId.value = profile.baseTemplateId
  enabled.value = profile.enabled
  createdAt.value = profile.createdAt
  overrides.value = { ...profile.overrides }
  overrideText.value = Object.entries(profile.overrides).map(([key, value]) => `${key}=${value}`).join('\n')
  resetOverrides.value = false
  formMessage.value = ''
}

function cancel(): void {
  editingId.value = ''
  name.value = ''
  easyId.value = ''
  templateId.value = 'manual'
  enabled.value = true
  createdAt.value = ''
  overrides.value = {}
  overrideText.value = ''
  resetOverrides.value = false
  formMessage.value = ''
}

function parseOverrides(text: string): Record<string, string> | null {
  const output: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) return null
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim()
    if (!isFileSearchBusinessField(key)) return null
    output[key] = value
  }
  return output
}

async function save(): Promise<void> {
  formMessage.value = ''
  if (!name.value.trim()) { formMessage.value = '请填写客户名称。'; return }
  if (easyId.value.trim() && !isQueryGuid(easyId.value.trim())) { formMessage.value = 'EASY 客户 GUID 还没有确认。'; return }
  const parsed = parseOverrides(overrideText.value)
  if (!parsed) { formMessage.value = '查询覆盖只能使用已登记的文件查询字段，格式为 字段=值。'; return }
  const now = new Date().toISOString()
  const nextOverrides = !editingId.value || resetOverrides.value ? (resetOverrides.value ? {} : parsed) : { ...overrides.value, ...parsed }
  const result = await call({
    action: 'saveCustomer',
    profile: {
      id: editingId.value || `customer-${crypto.randomUUID()}`,
      name: name.value.trim(),
      ...(easyId.value.trim() ? { easyCustomerId: easyId.value.trim() } : {}),
      baseTemplateId: templateId.value.trim() || 'manual',
      overrides: nextOverrides,
      enabled: enabled.value,
      createdAt: createdAt.value || now,
      updatedAt: now
    }
  })
  if (!result?.ok) {
    formMessage.value = result?.message || '客户没有保存。'
    return
  }
  formMessage.value = '客户配置已保存。'
  cancel()
  formMessage.value = '客户配置已保存。'
}
</script>

<template>
  <section v-if="!ready" class="pm-card"><p class="empty">尚未确认 EASY 用户，不能读取客户配置。</p></section>
  <template v-else>
    <section class="pm-card">
      <h2>客户配置</h2>
      <p class="hint">左侧 ID 是 PatMail 本地配置。EASY 客户 GUID 单独保存，两者不会混用。</p>
      <p v-if="customers.length === 0" class="empty">暂无客户</p>
      <table v-else class="pm-table">
        <thead><tr><th>本地配置</th><th>名称</th><th>EASY GUID</th><th>模板</th><th>查询覆盖</th><th>状态</th><th></th></tr></thead>
        <tbody>
          <tr v-for="item in customers" :key="item.id">
            <td>{{ item.id }}</td>
            <td>{{ item.name }}</td>
            <td>{{ item.easyCustomerId || '未绑定' }}</td>
            <td>{{ item.baseTemplateId }}</td>
            <td>{{ Object.keys(item.overrides).length ? Object.entries(item.overrides).map(([key, value]) => `${key}=${value}`).join('，') : '无' }}</td>
            <td>{{ item.enabled ? '启用' : '停用' }}</td>
            <td><button type="button" class="ghost" @click="edit(item.id)">编辑</button></td>
          </tr>
        </tbody>
      </table>
    </section>
    <form class="pm-card pm-form" @submit.prevent="save">
      <h2>{{ editingId ? '编辑客户' : '新增客户' }}</h2>
      <label>名称 <input v-model="name" type="text" maxlength="80" /></label>
      <label>EASY 客户 GUID <input v-model="easyId" type="text" /></label>
      <label>查询模板 ID <input v-model="templateId" type="text" /></label>
      <label>查询覆盖 <textarea v-model="overrideText" rows="3" placeholder="case_volume=ABC"></textarea></label>
      <p class="hint">查询覆盖预览：{{ preview.length ? preview.map(([key, value]) => `${key}=${value}`).join('，') : '空' }}</p>
      <label v-if="editingId"><input v-model="resetOverrides" type="checkbox" /> 重置查询条件</label>
      <label><input v-model="enabled" type="checkbox" /> 启用</label>
      <p v-if="formMessage" class="hint">{{ formMessage }}</p>
      <div class="pm-row">
        <button class="solid" type="submit">保存到当前账号</button>
        <button v-if="editingId" class="ghost" type="button" @click="cancel">取消编辑</button>
      </div>
    </form>
  </template>
</template>
