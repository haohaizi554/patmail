<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { hasExplicitFileSearchFilter, isFileSearchBusinessField, FILE_SEARCH_REQUEST_FIELDS, FILE_SEARCH_SYSTEM_FIELDS, type FileSearchQuery } from '../api/file-search-params'
import type { NormalizedDictionary } from '../api/dictionaries'
import type { HistoryQueryOption } from '../api/query-history'
import { CustomerQueryService, BundleCustomerRepository, type CustomerQueryProfile } from '../customer'
import { fieldLabel, parseQueryXml, resolveQueryTemplate } from '../query'
import { TemplateLoadCoordinator } from '../query/load-coordinator'
import { optionsForCaseType, resolveInternalIdDisplay } from '../schema'
import { BundleTemplateRepository } from '../query/repository'
import type { QueryTemplate } from '../query/query-types'
import { ChromeBundleRepository, MemoryBundleRepository, storageKey, type QueryBundleRepository } from '../storage/query-bundle'
import { MessageType, type MessageBridge } from '../shared/message'

const props = defineProps<{
  bridge?: MessageBridge
  canSearch: boolean
  userId: string
  mode: 'history' | 'customer'
  pageSize: number
}>()
const emit = defineEmits<{ search: [query: FileSearchQuery] }>()

const historyOptions = ref<HistoryQueryOption[]>([])
const localTemplates = ref<QueryTemplate[]>([])
const customers = ref<CustomerQueryProfile[]>([])
const historyMessage = ref('')
const storageMessage = ref('')
const selectedBaseId = ref('')
const selectedCustomerId = ref('')
const baseFields = ref<Record<string, string>>({})
const displayValues = ref<Record<string, string>>({})
const unknownFields = ref<Record<string, string>>({})
const parseWarnings = ref<string[]>([])
const baseMissing = ref(false)
const baseName = ref('')
const temporary = ref<Record<string, string>>({})
const temporaryActive = ref<Record<string, boolean>>({})
const showAll = ref(false)
const changedOnly = ref(false)
const showSources = ref(true)
const editingTemplate = ref(false)
const editingCustomer = ref(false)
const draftName = ref('')
const draftFields = ref<Array<{ key: string; value: string }>>([])
const draftBaseId = ref('')
const draftEnabled = ref(true)
const draftEasyId = ref('')
const draftCustomerId = ref('')
const editingTemplateId = ref('')
const loadingHistory = ref(false)
const basicDictionaries = ref<Record<string, NormalizedDictionary>>({})
const flowDictionaries = ref<Record<string, NormalizedDictionary>>({})
const loads = new TemplateLoadCoordinator()
onBeforeUnmount(() => loads.dispose())

const TEMP_FIELDS = [
  ['case_volume', '我方文号'],
  ['app_no', '申请号'],
  ['file_name', '附件名称']
] as const
const PREVIEW_FIELDS = ['case_type', 'filetype', 'customer_name_vague', 'case_volume', 'app_no']
const businessFields = FILE_SEARCH_REQUEST_FIELDS.filter(field => !FILE_SEARCH_SYSTEM_FIELDS.has(field))

const bundles = computed<QueryBundleRepository>(() => {
  const key = storageKey(location.origin, props.userId || null)
  if (typeof chrome !== 'undefined' && chrome.storage?.local) return new ChromeBundleRepository(key)
  return new MemoryBundleRepository()
})
const templates = computed(() => new BundleTemplateRepository(bundles.value))
const customerService = computed(() => new CustomerQueryService(new BundleCustomerRepository(bundles.value)))
const scopedUser = computed(() => Boolean(props.userId))
const devMode = import.meta.env.DEV
const canSubmit = computed(() => props.canSearch && !baseMissing.value &&
  (props.mode !== 'customer' || Boolean(selectedCustomer.value?.enabled)) &&
  hasExplicitFileSearchFilter(resolved.value.fields))

const baseChoices = computed(() => [
  ...historyOptions.value.map(item => ({ id: item.id, name: item.name, source: 'easy' as const })),
  ...localTemplates.value.map(item => ({ id: item.id, name: item.name, source: 'local' as const }))
])
const selectedCustomer = computed(() => customers.value.find(item => item.id === selectedCustomerId.value) ?? null)
const selectedLocal = computed(() => localTemplates.value.find(item => item.id === selectedBaseId.value) ?? null)

const temporaryFields = computed(() => {
  const fields: Record<string, string> = {}
  for (const [key] of TEMP_FIELDS) {
    if (temporaryActive.value[key]) fields[key] = temporary.value[key] ?? ''
  }
  return fields
})
const resolved = computed(() => resolveQueryTemplate(
  baseMissing.value ? {} : baseFields.value,
  props.mode === 'customer' ? selectedCustomer.value?.overrides : {},
  temporaryFields.value
))
const previewKeys = computed(() => {
  const keys = showAll.value ? Object.keys(resolved.value.fields) : [...PREVIEW_FIELDS]
  return changedOnly.value ? keys.filter(key => resolved.value.sources[key] && resolved.value.sources[key] !== 'base') : keys
})

function sourceLabel(source: string | undefined): string {
  if (source === 'customer') return '客户配置'
  if (source === 'temporary') return '临时输入'
  if (source === 'base') return '基础模板'
  return '未设置'
}
function dictionaryFor(key: string): { name: string; dictionary: NormalizedDictionary } | undefined {
  const flowKey = key === 'file_status' ? 'fileStatus' : key === 'flow_direction' ? 'caseDirection' : key === 'proc_status' ? 'procStatus' : ''
  if (flowKey && flowDictionaries.value[flowKey]) return { name: flowKey, dictionary: flowDictionaries.value[flowKey] }
  const basicKey = key === 'case_type' ? 'caseType' : key === 'apply_type' ? 'applyType' : key === 'case_status' ? 'caseStatus'
    : key === 'business_type_id' ? 'bussType' : key === 'country' ? 'country' : ''
  if (basicKey && basicDictionaries.value[basicKey]) return { name: basicKey, dictionary: basicDictionaries.value[basicKey] }
  return undefined
}
function previewText(key: string): string {
  if (!Object.prototype.hasOwnProperty.call(resolved.value.fields, key)) return '未设置'
  const value = resolved.value.fields[key] ?? ''
  if (!value) return '（空）'
  const dictionary = dictionaryFor(key)
  if (dictionary) {
    const options = dictionary.dictionary.options[0]?.metadata?.caseTypeId
      ? optionsForCaseType(dictionary.name, dictionary.dictionary.options, resolved.value.fields.case_type ?? '')
      : dictionary.dictionary.options
    const display = resolveInternalIdDisplay(value, options, key === 'filetype')
    if (!display.unresolved) return display.text
    return '未识别的历史 ID'
  }
  if (resolved.value.sources[key] === 'base' && displayValues.value[key]) return displayValues.value[key]
  return value
}

async function reloadLocal(): Promise<void> {
  try {
    const loaded = await bundles.value.load()
    localTemplates.value = loaded.bundle.templates
    customers.value = loaded.bundle.customers
    storageMessage.value = loaded.warning ?? (scopedUser.value ? '' : '当前会话没有稳定用户 ID，本地模板保存在未分区的本机空间。')
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      storageMessage.value = '当前环境不能使用扩展本地存储，模板只留在本次页面内存中。'
    }
  } catch {
    storageMessage.value = '读取本地模板失败。'
  }
}

async function loadDictionaries(ticketId: number, signal: AbortSignal): Promise<void> {
  if (!props.bridge) return
  const responses = await Promise.all((['basic', 'flow'] as const).map(kind => props.bridge!.request({
    type: MessageType.LoadDictionary, payload: { kind, force: false }
  }, signal)))
  if (!loads.isCurrent(ticketId)) return
  for (const response of responses) {
    if (response.type !== MessageType.DictionaryResult || !response.payload.ok) continue
    if (response.payload.data.kind === 'basic') basicDictionaries.value = response.payload.data.dictionaries
    if (response.payload.data.kind === 'flow') flowDictionaries.value = response.payload.data.dictionaries
  }
}
async function loadHistory(force: boolean): Promise<void> {
  const ticket = loads.begin()
  if (!props.bridge || !props.canSearch) {
    historyMessage.value = '请先确认 EASY 已登录。'
    return
  }
  loadingHistory.value = true
  historyMessage.value = ''
  try {
    const response = await props.bridge.request({ type: MessageType.ListHistoryQueries, payload: { force } }, ticket.signal)
    if (!loads.isCurrent(ticket.id)) return
    if (response.type !== MessageType.HistoryQueriesResult) {
      historyMessage.value = '历史模板返回了意外结果。'
      return
    }
    if (!response.payload.ok) {
      historyOptions.value = []
      historyMessage.value = response.payload.error.message
      return
    }
    historyOptions.value = response.payload.data
    if (response.payload.data.length === 0) historyMessage.value = '原网站没有已保存的文件查询模板。'
    await loadDictionaries(ticket.id, ticket.signal)
    if (!loads.isCurrent(ticket.id)) return
    if (props.mode === 'customer' && selectedCustomer.value) await applyBase(selectedCustomer.value.baseTemplateId, ticket)
    else if (selectedBaseId.value) await applyBase(selectedBaseId.value, ticket)
  } catch {
    if (loads.isCurrent(ticket.id)) historyMessage.value = '读取历史模板失败。'
  } finally {
    if (loads.isCurrent(ticket.id)) loadingHistory.value = false
  }
}

function resetBase(): void {
  baseMissing.value = false
  parseWarnings.value = []
  unknownFields.value = {}
  displayValues.value = {}
  baseFields.value = {}
  baseName.value = ''
}
function startApply(id: string): void {
  void applyBase(id, loads.begin())
}
async function applyBase(id: string, ticket: { id: number; signal: AbortSignal } = loads.begin()): Promise<void> {
  selectedBaseId.value = id
  resetBase()
  if (!loads.isCurrent(ticket.id) || !id) return
  const local = localTemplates.value.find(item => item.id === id)
  if (local) {
    baseFields.value = { ...local.fields }
    displayValues.value = { ...(local.displayValues ?? {}) }
    unknownFields.value = { ...(local.unknownFields ?? {}) }
    baseName.value = local.name
    return
  }
  const easy = historyOptions.value.find(item => item.id === id)
  if (!easy || !props.bridge) {
    baseMissing.value = true
    baseName.value = '基础模板不存在'
    return
  }
  const response = await props.bridge.request({ type: MessageType.GetHistoryQuery, payload: { queryId: id } }, ticket.signal)
  if (!loads.isCurrent(ticket.id)) return
  if (response.type !== MessageType.HistoryQueryResult || !response.payload.ok) {
    baseMissing.value = true
    historyMessage.value = response.type === MessageType.HistoryQueryResult && !response.payload.ok
      ? response.payload.error.message : '读取历史模板详情失败。'
    return
  }
  const parsed = parseQueryXml(response.payload.data.queryXml, response.payload.data.name)
  if (!loads.isCurrent(ticket.id)) return
  if (!parsed.ok) {
    baseMissing.value = true
    historyMessage.value = parsed.error.message
    return
  }
  baseFields.value = parsed.data.fields
  displayValues.value = parsed.data.displayValues
  unknownFields.value = parsed.data.unknownFields
  parseWarnings.value = parsed.data.warnings
  baseName.value = response.payload.data.name
}

function openTemplateEditor(template?: QueryTemplate): void {
  editingCustomer.value = false
  editingTemplate.value = true
  editingTemplateId.value = template?.id ?? ''
  draftName.value = template?.name ?? ''
  draftFields.value = Object.entries(template?.fields ?? {}).map(([key, value]) => ({ key, value }))
  if (draftFields.value.length === 0) draftFields.value = [{ key: 'case_type', value: '' }, { key: 'filetype', value: '' }]
}
async function saveTemplate(): Promise<void> {
  const fields: Record<string, string> = {}
  for (const row of draftFields.value) {
    if (!isFileSearchBusinessField(row.key)) {
      storageMessage.value = '模板包含未注册字段，未保存。'
      return
    }
    fields[row.key] = row.value
  }
  const name = draftName.value.trim()
  if (!name) {
    storageMessage.value = '请填写模板名称。'
    return
  }
  const now = new Date().toISOString()
  const current = localTemplates.value.find(item => item.id === editingTemplateId.value && item.source === 'local')
  const template: QueryTemplate = current ? {
    ...current,
    name,
    fields,
    version: current.version + 1,
    updatedAt: now
  } : {
    id: `local-${crypto.randomUUID()}`,
    name,
    source: 'local',
    queryType: 'FileSearch',
    fields,
    version: 1,
    createdAt: now,
    updatedAt: now
  }
  await templates.value.save(template)
  editingTemplate.value = false
  await reloadLocal()
  await applyBase(template.id)
}
async function importCurrent(): Promise<void> {
  if (!selectedBaseId.value || baseMissing.value) return
  const now = new Date().toISOString()
  const template: QueryTemplate = {
    id: `local-${crypto.randomUUID()}`,
    name: `${baseName.value || '历史模板'} 的本地副本`.slice(0, 80),
    source: 'local',
    sourceQueryId: historyOptions.value.some(item => item.id === selectedBaseId.value) ? selectedBaseId.value : undefined,
    queryType: 'FileSearch',
    fields: { ...baseFields.value },
    displayValues: { ...displayValues.value },
    unknownFields: { ...unknownFields.value },
    version: 1,
    createdAt: now,
    updatedAt: now
  }
  await templates.value.save(template)
  await reloadLocal()
  storageMessage.value = '已导入为本地模板，刷新原网站模板不会覆盖这份副本。'
}
async function copySelected(): Promise<void> {
  if (!selectedBaseId.value || baseMissing.value) return
  const now = new Date().toISOString()
  await templates.value.save({
    id: `local-${crypto.randomUUID()}`,
    name: `${baseName.value || '模板'} 副本`.slice(0, 80),
    source: 'local',
    queryType: 'FileSearch',
    fields: { ...baseFields.value },
    displayValues: { ...displayValues.value },
    unknownFields: { ...unknownFields.value },
    version: 1,
    createdAt: now,
    updatedAt: now
  })
  await reloadLocal()
}
async function deleteSelectedLocal(): Promise<void> {
  if (!selectedLocal.value) return
  await templates.value.delete(selectedLocal.value.id)
  selectedBaseId.value = ''
  baseFields.value = {}
  await reloadLocal()
}

function openCustomerEditor(profile?: CustomerQueryProfile): void {
  editingTemplate.value = false
  editingCustomer.value = true
  draftCustomerId.value = profile?.id ?? ''
  draftName.value = profile?.name ?? ''
  draftBaseId.value = profile?.baseTemplateId ?? selectedBaseId.value
  draftEnabled.value = profile?.enabled ?? true
  draftEasyId.value = profile?.easyCustomerId ?? ''
  draftFields.value = Object.entries(profile?.overrides ?? { customer_name_vague: '' }).map(([key, value]) => ({ key, value }))
}
async function saveCustomer(): Promise<void> {
  const overrides: Record<string, string> = {}
  for (const row of draftFields.value) {
    if (!isFileSearchBusinessField(row.key)) {
      storageMessage.value = '客户覆盖包含未注册字段，未保存。'
      return
    }
    overrides[row.key] = row.value
  }
  try {
    const saved = await customerService.value.save({
      ...(draftCustomerId.value ? { id: draftCustomerId.value } : {}),
      name: draftName.value,
      ...(draftEasyId.value.trim() ? { easyCustomerId: draftEasyId.value.trim() } : {}),
      baseTemplateId: draftBaseId.value,
      overrides,
      enabled: draftEnabled.value
    })
    editingCustomer.value = false
    await reloadLocal()
    selectedCustomerId.value = saved.id
    await applyBase(saved.baseTemplateId)
  } catch (error) {
    storageMessage.value = error instanceof Error ? error.message : '保存客户配置失败。'
  }
}
async function deleteCustomer(): Promise<void> {
  if (!selectedCustomer.value) return
  await customerService.value.delete(selectedCustomer.value.id)
  selectedCustomerId.value = ''
  await reloadLocal()
}

function search(): void {
  if (!canSubmit.value) return
  emit('search', { resolvedFields: { ...resolved.value.fields }, pageIndex: 1, pageSize: props.pageSize })
}

watch(() => [props.userId, props.canSearch, props.mode] as const, () => {
  historyOptions.value = []
  basicDictionaries.value = {}
  flowDictionaries.value = {}
  resetBase()
  selectedBaseId.value = ''
  void reloadLocal()
  if (props.canSearch) void loadHistory(false)
}, { immediate: true })
watch(selectedCustomerId, () => {
  const profile = selectedCustomer.value
  resetBase()
  if (!profile) return
  void applyBase(profile.baseTemplateId)
})
</script>

<template>
  <section class="card query-template" aria-label="查询模板">
    <div class="section-heading">
      <strong>{{ mode === 'customer' ? '客户配置' : '基础模板' }}</strong>
      <button type="button" class="text-button" :disabled="!canSearch || loadingHistory" @click="loadHistory(true)">刷新历史模板</button>
    </div>
    <p v-if="historyMessage" class="hint">{{ historyMessage }}</p>
    <p v-if="storageMessage" class="hint">{{ storageMessage }}</p>

    <label v-if="mode === 'history'">历史或本地模板
      <select v-model="selectedBaseId" @change="startApply(selectedBaseId)">
        <option value="">请选择</option>
        <optgroup label="EASY">
          <option v-for="item in historyOptions" :key="item.id" :value="item.id">{{ item.name }}</option>
        </optgroup>
        <optgroup label="本地">
          <option v-for="item in localTemplates" :key="item.id" :value="item.id">{{ item.name }}</option>
        </optgroup>
      </select>
    </label>
    <label v-else>客户
      <select v-model="selectedCustomerId">
        <option value="">请选择</option>
        <option v-for="item in customers" :key="item.id" :value="item.id">{{ item.name }}{{ item.enabled ? '' : '（已停用）' }}</option>
      </select>
    </label>
    <p v-if="baseName" class="hint">基础模板：{{ baseName }}<span v-if="selectedLocal"> · 来源：本地</span><span v-else-if="selectedBaseId"> · 来源：EASY · 只读</span><span v-if="selectedLocal?.sourceQueryId"> · 已导入，刷新原网站模板不会覆盖</span></p>
    <p v-if="baseMissing" class="error" role="alert">基础模板不存在或无法解析，不会改用其他模板。</p>
    <p v-if="mode === 'customer' && selectedCustomer && !selectedCustomer.enabled" class="error" role="alert">该客户配置已停用。</p>
    <p v-if="unknownFields && Object.keys(unknownFields).length" class="hint">未注册字段 {{ Object.keys(unknownFields).length }} 个：{{ Object.keys(unknownFields).join('、') }}。这些字段不会发送。</p>
    <p v-for="warning in parseWarnings" :key="warning" class="hint">{{ warning }}</p>

    <div class="inline-actions">
      <button type="button" class="text-button" @click="openTemplateEditor()">新建本地模板</button>
      <button type="button" class="text-button" :disabled="!selectedBaseId || baseMissing" @click="importCurrent">从当前模板导入</button>
      <button type="button" class="text-button" :disabled="!selectedBaseId || baseMissing" @click="copySelected">复制</button>
      <button type="button" class="text-button" :disabled="!selectedLocal" @click="openTemplateEditor(selectedLocal ?? undefined)">编辑本地模板</button>
      <button type="button" class="text-button" :disabled="!selectedLocal" @click="deleteSelectedLocal">删除本地模板</button>
      <button type="button" class="text-button" @click="openCustomerEditor()">新增客户</button>
      <button type="button" class="text-button" :disabled="!selectedCustomer" @click="openCustomerEditor(selectedCustomer ?? undefined)">编辑客户配置</button>
      <button type="button" class="text-button" :disabled="!selectedCustomer" @click="deleteCustomer">删除客户</button>
    </div>

    <form v-if="editingTemplate" class="editor" @submit.prevent="saveTemplate">
      <strong>本地模板</strong>
      <label>名称<input v-model="draftName" type="text" maxlength="80" /></label>
      <div v-for="(row, index) in draftFields" :key="index" class="field-row">
        <select v-model="row.key">
          <option v-for="field in businessFields" :key="field" :value="field">{{ fieldLabel(field) }}</option>
        </select>
        <input v-model="row.value" type="text" />
        <button type="button" class="text-button" @click="draftFields.splice(index, 1)">移除</button>
      </div>
      <button type="button" class="text-button" @click="draftFields.push({ key: 'customer_name_vague', value: '' })">添加字段</button>
      <button type="submit" class="search-submit">保存本地模板</button>
    </form>

    <form v-if="editingCustomer" class="editor" @submit.prevent="saveCustomer">
      <strong>客户配置</strong>
      <label>客户名称<input v-model="draftName" type="text" maxlength="80" /></label>
      <label>基础模板
        <select v-model="draftBaseId">
          <option value="">请选择</option>
          <option v-for="item in baseChoices" :key="item.id" :value="item.id">{{ item.name }}（{{ item.source === 'easy' ? 'EASY' : '本地' }}）</option>
        </select>
      </label>
      <label>原网站客户 ID（可选）<input v-model="draftEasyId" type="text" autocomplete="off" /></label>
      <label class="check-line"><input v-model="draftEnabled" type="checkbox" />启用</label>
      <div v-for="(row, index) in draftFields" :key="index" class="field-row">
        <select v-model="row.key">
          <option v-for="field in businessFields" :key="field" :value="field">{{ fieldLabel(field) }}</option>
        </select>
        <input v-model="row.value" type="text" placeholder="空字符串也会覆盖" />
        <button type="button" class="text-button" @click="draftFields.splice(index, 1)">移除</button>
      </div>
      <button type="button" class="text-button" @click="draftFields.push({ key: 'filetype', value: '' })">添加覆盖字段</button>
      <button type="submit" class="search-submit">保存客户</button>
    </form>

    <div class="temporary">
      <strong>临时条件</strong>
      <label v-for="[key, label] in TEMP_FIELDS" :key="key" class="check-line">
        <input v-model="temporaryActive[key]" type="checkbox" />
        {{ label }}
        <input v-model="temporary[key]" type="text" :disabled="!temporaryActive[key]" />
      </label>
      <button type="button" class="text-button" @click="temporaryActive = {}; temporary = {}">恢复基础模板</button>
    </div>

    <div class="preview" aria-label="最终查询条件">
      <div class="section-heading">
        <strong>最终查询条件</strong>
        <button type="button" class="text-button" @click="showAll = !showAll">{{ showAll ? '只看常用字段' : '查看全部字段' }}</button>
      </div>
      <div class="inline-actions">
        <button type="button" class="text-button" @click="changedOnly = !changedOnly">{{ changedOnly ? '查看全部来源' : '只看修改字段' }}</button>
        <button type="button" class="text-button" @click="showSources = !showSources">{{ showSources ? '隐藏字段来源' : '查看字段来源' }}</button>
      </div>
      <p v-if="mode === 'customer' && selectedCustomer" class="hint">当前客户：{{ selectedCustomer.name }}</p>
      <dl>
        <div v-for="key in previewKeys" :key="key">
          <dt>{{ fieldLabel(key) }}</dt>
          <dd>{{ previewText(key) }}<span v-if="showSources"> · {{ sourceLabel(resolved.sources[key]) }}</span></dd>
        </div>
      </dl>
      <p v-if="resolved.warnings.length" class="hint">{{ resolved.warnings[0] }}</p>
      <details v-if="devMode">
        <summary>参数结构</summary>
        <p v-for="key in Object.keys(resolved.fields)" :key="'shape-' + key" class="hint">{{ key }} · {{ resolved.sources[key] }} · {{ resolved.fields[key] ? resolved.fields[key].length + ' 字' : '空' }}</p>
      </details>
    </div>
    <button type="button" class="search-submit" :disabled="!canSubmit" @click="search">查询文件</button>
  </section>
</template>
