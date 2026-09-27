<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PageHead from '../../../../src/components/PageHead.vue'
import ThemeSelect from '../../../../src/components/ThemeSelect.vue'
import { bg } from '../../../../src/assets'
import type { HistoryQueryOption } from '../../api/query-history'
import { PAGE_OPTIONS, queryBlocks, type QueryCell, type QuerySection } from '../../query/form-layout'
import { hiddenFormFields, pageSelectOptions } from '../../query/form-page'
import { activateOptionFallback, hydrateOptionFallback, optionFallbackEpoch, subscribeOptionFallback } from '../../query/option-fallback'
import { fieldLabel } from '../../query/field-registry'
import { isQueryGuid } from '../../query/query-validator'
import { scopeFromConnection, type ExpectedAccountScope } from '../../shared/connection'
import { MessageType, type MessageBridge } from '../../shared/message'
import { useWorkspace } from '../composables/useWorkspace'

const bridge = inject<MessageBridge>('bridge')
const { connection, customers, templates, accountEpoch, call } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const name = ref('')
const templateId = ref('manual')
const enabled = ref(true)
const editingId = ref('')
const createdAt = ref('')
const keptCustomerId = ref('')
const values = ref<Record<string, string>>({})
const openExtra = ref<Record<string, boolean>>({})
const formMessage = ref('')
const formScope = ref<ExpectedAccountScope | null>(null)
const formRevision = ref(1)
const history = ref<HistoryQueryOption[]>([])
const loadingTemplates = ref(false)
const templateMessage = ref('')
const fallbackTick = ref(0)
const stopFallbackWatch = subscribeOptionFallback(() => { fallbackTick.value = optionFallbackEpoch() })

const templateChoices = computed(() => {
  const local = templates.value.map(item => ({ value: item.id, label: item.name, group: '本机保存的查询' }))
  const remote = history.value
    .filter(item => !local.some(row => row.value === item.id))
    .map(item => ({ value: item.id, label: item.name, group: '账号里的查询' }))
  return [{ value: 'manual', label: '不套用，只用下面填写的条件' }, ...remote, ...local]
})
const formSections = computed(() => queryBlocks(hiddenFormFields()))
function shownCells(block: QuerySection): QueryCell[] {
  return openExtra.value[block.title] ? [...block.cells, ...block.extra] : block.cells
}
function toggleExtra(title: string): void {
  openExtra.value = { ...openExtra.value, [title]: !openExtra.value[title] }
}

function templateName(id: string): string {
  if (!id || id === 'manual') return '自己填写的条件'
  return history.value.find(item => item.id === id)?.name
    || templates.value.find(item => item.id === id)?.name
    || '已选的查询'
}

function shownValue(key: string, value: string): string {
  const option = PAGE_OPTIONS[key]?.find(item => item.value === value)
  if (option) return option.label
  if (isQueryGuid(value) || value.includes(',')) return '已选择'
  if (value === 'on') return '是'
  return value
}

function describe(overrides: Record<string, string>): string {
  const parts = Object.entries(overrides)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `${fieldLabel(key)}：${shownValue(key, value)}`)
  return parts.length ? parts.join('，') : '没有单独填写'
}

function cellTouched(cell: QueryCell, source: Record<string, string>): boolean {
  if (cell.kind === 'download-name') return false
  if (cell.kind === 'dates') return [cell.start, cell.end, cell.empty].some(key => key && source[key]?.trim())
  if (cell.kind === 'checks') return cell.items.some(item => source[item.key]?.trim())
  return Boolean(source[cell.key]?.trim())
}

function edit(id: string): void {
  const profile = customers.value.find(item => item.id === id)
  if (!profile) return
  editingId.value = profile.id
  name.value = profile.name
  templateId.value = profile.baseTemplateId || 'manual'
  enabled.value = profile.enabled
  createdAt.value = profile.createdAt
  keptCustomerId.value = profile.easyCustomerId && isQueryGuid(profile.easyCustomerId) ? profile.easyCustomerId : ''
  values.value = { ...profile.overrides }
  const nextOpen: Record<string, boolean> = {}
  for (const block of queryBlocks(hiddenFormFields())) {
    if (block.extra.some(cell => cellTouched(cell, profile.overrides))) nextOpen[block.title] = true
  }
  openExtra.value = nextOpen
  formScope.value = scopeFromConnection(connection.value)
  formRevision.value = profile.revision ?? 1
  formMessage.value = ''
}

function cancel(): void {
  editingId.value = ''
  name.value = ''
  templateId.value = 'manual'
  enabled.value = true
  createdAt.value = ''
  keptCustomerId.value = ''
  values.value = {}
  openExtra.value = {}
  formScope.value = null
  formMessage.value = ''
}

function formValue(key: string): string {
  return values.value[key] ?? ''
}

function setValue(key: string, value: string): void {
  values.value = { ...values.value, [key]: value }
}

function checked(key: string): boolean {
  const value = formValue(key)
  return value === 'on' || value === '1' || value === 'true' || value === '是'
}

function optionsFor(key: string): { value: string; label: string }[] {
  fallbackTick.value
  const known = pageSelectOptions(key) ?? PAGE_OPTIONS[key] ?? []
  const current = formValue(key)
  const extra = current && !known.some(item => item.value === current)
    ? [{ value: current, label: isQueryGuid(current) ? '已选择' : current }]
    : []
  return [{ value: '', label: '不指定' }, ...extra, ...known]
}

function collected(): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [key, value] of Object.entries(values.value)) {
    if (value.trim()) output[key] = value.trim()
  }
  return output
}

async function loadTemplates(): Promise<void> {
  if (!ready.value || !bridge) {
    templateMessage.value = '登录后才能读取已经保存的查询。'
    return
  }
  loadingTemplates.value = true
  templateMessage.value = ''
  try {
    const response = await bridge.request({ type: MessageType.ListHistoryQueries, payload: { force: false, surface: 'file' } })
    if (response.type !== MessageType.HistoryQueriesResult || !response.payload.ok) {
      history.value = []
      templateMessage.value = '账号里的查询暂时没读到。可以直接在下面填写条件。'
      return
    }
    history.value = response.payload.data
    if (response.payload.data.length === 0 && templates.value.length === 0) {
      templateMessage.value = '还没有保存过查询。可以先到「文件查询模板」存一套，也可以直接在下面填写。'
    }
  } catch {
    history.value = []
    templateMessage.value = '账号里的查询暂时没读到。可以直接在下面填写条件。'
  } finally {
    loadingTemplates.value = false
  }
}

async function save(): Promise<void> {
  formMessage.value = ''
  if (!name.value.trim()) { formMessage.value = '请先填写客户称呼。'; return }
  const scope = editingId.value ? formScope.value : scopeFromConnection(connection.value)
  if (!scope) { formMessage.value = '还没确认当前登录的人，没有保存。'; return }
  const now = new Date().toISOString()
  const result = await call({
    action: 'saveCustomer',
    profile: {
      id: editingId.value || `customer-${crypto.randomUUID()}`,
      name: name.value.trim(),
      ...(keptCustomerId.value ? { easyCustomerId: keptCustomerId.value } : {}),
      baseTemplateId: templateId.value.trim() || 'manual',
      overrides: collected(),
      enabled: enabled.value,
      createdAt: createdAt.value || now,
      updatedAt: now,
      ...(editingId.value ? { revision: formRevision.value } : {})
    },
    expectedScope: scope,
    ...(editingId.value ? { expectedRevision: formRevision.value } : {})
  })
  if (!result?.ok) {
    formMessage.value = result?.message || '这套客户配置没有保存。'
    return
  }
  cancel()
  formMessage.value = '客户配置已保存。'
}

watch(accountEpoch, () => {
  if (!editingId.value && !name.value) return
  cancel()
  formMessage.value = '登录的账号变了，没保存的内容已清掉。'
})
watch(ready, (ok) => { if (ok) void loadTemplates() })
onMounted(() => { if (ready.value) void loadTemplates() })
watch(() => connection.value.operatorId, userId => {
  if (!userId) return
  activateOptionFallback(userId)
  void hydrateOptionFallback(userId)
}, { immediate: true })
onBeforeUnmount(stopFallbackWatch)
</script>

<template>
  <PageHead title="客户管理" desc="给每位客户存一套常用查询。自动发文时选中这位客户，就会按这套条件找文件。" :art="bg('靠近成功的一步.png')" />
  <section v-if="!ready" class="card"><p class="empty">还没确认当前登录的人，暂时不能保存客户。</p></section>
  <template v-else>
    <section class="card">
      <h2>已保存的客户</h2>
      <p class="hint">这里保存的是整套客户配置。之后在发文和自动流程里，直接选这位客户就能用。</p>
      <p v-if="customers.length === 0" class="empty">还没有保存过客户。在下面填好后保存即可。</p>
      <table v-else class="grid">
        <thead><tr><th>客户</th><th>套用的查询</th><th>这位客户单独的条件</th><th>状态</th><th></th></tr></thead>
        <tbody>
          <tr v-for="item in customers" :key="item.id">
            <td>{{ item.name }}</td>
            <td>{{ templateName(item.baseTemplateId) }}</td>
            <td>{{ describe(item.overrides) }}</td>
            <td>{{ item.enabled ? '启用中' : '已停用' }}</td>
            <td><button type="button" class="ghost" @click="edit(item.id)">修改</button></td>
          </tr>
        </tbody>
      </table>
    </section>
    <form class="card" @submit.prevent="save">
      <h2>{{ editingId ? '修改这套客户配置' : '保存一套客户配置' }}</h2>
      <div class="stack-form">
        <p class="hint">客户称呼用来在发文流程里找到这位客户。下面的条件会和所选查询一起保存。</p>
        <label>客户称呼 <input v-model="name" type="text" maxlength="80" /></label>
        <label>套用哪套查询
          <ThemeSelect v-model="templateId" :disabled="loadingTemplates" :options="templateChoices" />
        </label>
        <p v-if="loadingTemplates" class="hint">正在读取已经保存的查询…</p>
        <p v-else-if="templateMessage" class="hint">{{ templateMessage }}</p>
        <button type="button" class="ghost" :disabled="loadingTemplates" @click="loadTemplates">重新读取查询</button>
      </div>
      <div class="section-heading">
        <strong>这位客户自己的查询条件</strong>
      </div>
      <p class="hint">留空的项不会单独指定。已经套用的查询仍然生效。</p>
      <section v-for="block in formSections" :key="block.title" class="query-block">
        <div class="section-heading">
          <strong>{{ block.title }}</strong>
          <button v-if="block.extra.length" type="button" class="text-button" @click="toggleExtra(block.title)">{{ openExtra[block.title] ? '收起' : '展开' }}</button>
        </div>
        <div class="query-grid">
          <template v-for="(cell, index) in shownCells(block)" :key="block.title + index">
            <label v-if="cell.kind === 'named' && optionsFor(cell.key).length > 1" class="query-cell">
              <span>{{ cell.label }}</span>
              <ThemeSelect :model-value="formValue(cell.key)" :options="optionsFor(cell.key)" @update:model-value="setValue(cell.key, String($event))" />
            </label>
            <label v-else-if="cell.kind === 'text' || cell.kind === 'named' || cell.kind === 'files'" :class="cell.kind === 'files' ? 'query-cell span-all' : 'query-cell'">
              <span>{{ cell.label }}</span>
              <input v-if="!isQueryGuid(formValue(cell.key)) && !formValue(cell.key).includes(',')" :value="formValue(cell.key)" type="text" @input="setValue(cell.key, ($event.target as HTMLInputElement).value)" />
              <span v-else class="file-summary">已选择 <button type="button" class="text-button" @click="setValue(cell.key, '')">清除</button></span>
            </label>
            <label v-else-if="cell.kind === 'select'" class="query-cell">
              <span>{{ cell.label }}</span>
              <ThemeSelect :model-value="formValue(cell.key)" :options="optionsFor(cell.key)" @update:model-value="setValue(cell.key, String($event))" />
            </label>
            <template v-else-if="cell.kind === 'download-name'"></template>
            <div v-else-if="cell.kind === 'dates'" class="query-cell">
              <span>{{ cell.label }}</span>
              <span class="date-pair">
                <input :value="formValue(cell.start)" type="text" placeholder="起" @input="setValue(cell.start, ($event.target as HTMLInputElement).value)" />
                <em>到</em>
                <input :value="formValue(cell.end)" type="text" placeholder="止" @input="setValue(cell.end, ($event.target as HTMLInputElement).value)" />
                <label v-if="cell.empty" class="empty-check"><input :checked="checked(cell.empty)" type="checkbox" @change="setValue(cell.empty, ($event.target as HTMLInputElement).checked ? 'on' : '')" />为空</label>
              </span>
            </div>
            <div v-else class="query-cell span-all">
              <span>{{ cell.label }}</span>
              <span class="check-group">
                <label v-for="item in cell.items" :key="item.key"><input :checked="checked(item.key)" type="checkbox" @change="setValue(item.key, ($event.target as HTMLInputElement).checked ? 'on' : '')" />{{ item.label }}</label>
              </span>
            </div>
          </template>
        </div>
      </section>
      <label class="check-line"><input v-model="enabled" type="checkbox" />以后发文时可以使用这位客户</label>
      <p v-if="formMessage" class="hint">{{ formMessage }}</p>
      <div class="filters">
        <button class="solid" type="submit">保存这套配置</button>
        <button v-if="editingId" class="ghost" type="button" @click="cancel">取消</button>
      </div>
    </form>
  </template>
</template>
