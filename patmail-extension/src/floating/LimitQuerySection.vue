<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ThemeSelect from '../shell/components/ThemeSelect.vue'
import TreeOptionSelect from '../shell/components/TreeOptionSelect.vue'
import type { HistoryQueryOption } from '../api/query-history'
import { CURRENT_ENVIRONMENT } from '../api/config'
import { LIMIT_BLOCKS, LIMIT_OPTION_KEYS, LIMIT_SELECTS, buildLimitQueryXml, readLimitQueryXml } from '../api/limit-form'
import { pageSelectOptions } from '../query/form-page'
import { activateOptionFallback, hydrateOptionFallback, optionFallbackEpoch, rememberChoices, rememberDictionaries, savedChoices, subscribeOptionFallback } from '../query/option-fallback'
import type { NormalizedDictionary } from '../api/dictionaries'
import { choicesFromDictionary, describePickerReceipt, LIMIT_PICKER_FIELDS } from '../api/dictionaries/picker-catalog'
import { hasOptionTree } from '../query/option-tree'
import { isLimitMonitorInputField, splitCtrlProcIds, type LimitMonitorQuery } from '../api/limit-monitor-params'
import { isQueryGuid } from '../query/query-validator'
import { joinCaseVolumes, splitCaseVolumes } from '../customer/volume-list'
import { TemplateLoadCoordinator } from '../query/load-coordinator'
import { historyLabels } from '../query/history-labels'
import { confirmDialog } from '../app/dialog'
import { MessageType, type MessageBridge } from '../shared/message'

const props = defineProps<{ bridge?: MessageBridge; userId: string; canSearch: boolean; seed?: Record<string, string> | null; seedToken?: number }>()
const emit = defineEmits<{
  search: [query: Omit<LimitMonitorQuery, 'pageIndex' | 'pageSize'> & { reset?: boolean; templateId?: string }]
  draft: [fields: Record<string, string>]
}>()

const values = ref<Record<string, string>>({})
const templates = ref<HistoryQueryOption[]>([])
const selectedId = ref('')
const showMore = ref(false)
const loading = ref(false)
const message = ref('')
const saveName = ref('')
const saving = ref(false)
const deleting = ref(false)
const checking = ref(false)
const checkMessage = ref('')
const pickers = ref<Record<string, NormalizedDictionary>>({})
const pickersReady = ref(false)
const fallbackTick = ref(0)
const stopFallbackWatch = subscribeOptionFallback(() => { fallbackTick.value = optionFallbackEpoch() })
const loads = new TemplateLoadCoordinator()
let filterTimer = 0
const blocks = computed(() => LIMIT_BLOCKS.filter(block => showMore.value || !block.more))
const canRead = computed(() => Boolean(props.bridge) && Boolean(props.userId))
const templateLabels = computed(() => historyLabels(templates.value))
function templateLabel(item: { id: string; name: string }): string {
  return templateLabels.value.get(item.id) ?? item.name
}

onBeforeUnmount(() => {
  loads.dispose()
  window.clearTimeout(filterTimer)
  stopFallbackWatch()
})

function valueOf(key: string): string {
  return values.value[key] ?? ''
}
function setValue(key: string, value: string): void {
  values.value = { ...values.value, [key]: value }
}
function draftFields(): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(values.value)) {
    if (isLimitMonitorInputField(key) && value.trim()) fields[key] = value.trim()
  }
  return fields
}
watch(values, () => emit('draft', draftFields()))
function onText(key: string, event: Event): void {
  setValue(key, (event.target as HTMLInputElement).value)
}
function checked(key: string): boolean {
  const value = valueOf(key).trim().toLowerCase()
  return value === 'true' || value === 'on' || value === '1'
}
function onCheck(key: string, event: Event): void {
  const on = (event.target as HTMLInputElement).checked
  setValue(key, on ? (key.endsWith('isnull') ? 'on' : 'true') : '')
}
function caseTypeFor(key: string): string {
  const selected = valueOf('case_type')
  if (selected || key !== 'case_status_id') return selected
  return CURRENT_ENVIRONMENT.caseTypeId
}
function choices(key: string): { value: string; label: string; parent?: string }[] {
  fallbackTick.value
  const source = LIMIT_PICKER_FIELDS[key]
  const dictionary = source ? pickers.value[source] : undefined
  const live = dictionary && dictionary.options.length > 0
    ? choicesFromDictionary(dictionary, caseTypeFor(key), valueOf('country'))
    : null
  const stored = props.userId ? savedChoices(props.userId, key) : null
  const saved = stored ?? pageSelectOptions(LIMIT_OPTION_KEYS[key] ?? key) ?? LIMIT_SELECTS[key] ?? []
  const options = live ?? [...saved]
  const current = valueOf(key)
  if (current && isQueryGuid(current) && !options.some(item => item.value === current)) options.unshift({ value: current, label: '已选择' })
  return options.filter(item => item.value)
}
function treeChoices(key: string): { value: string; label: string; parent?: string }[] {
  const options = choices(key)
  return hasOptionTree(options) ? options : []
}
function optionsFor(key: string): { value: string; label: string; parent?: string }[] {
  return [{ value: '', label: '不限' }, ...choices(key)]
}
function namedLabel(key: string): string {
  const ids = key === 'ctrl_proc' ? splitCtrlProcIds(valueOf(key)) : []
  if (ids.length < 2) return ''
  const labels = ids.map(id => choices(key).find(item => item.value === id)?.label ?? '')
  return labels.every(Boolean) ? labels.join('、') : `已选 ${ids.length} 项`
}
function namedShown(key: string): string {
  const value = valueOf(key)
  if (!value) return ''
  return isQueryGuid(value) ? '已选择' : value
}
async function loadTemplates(force: boolean): Promise<void> {
  if (!canRead.value || !props.bridge) {
    message.value = '请先确认 EASY 已登录。'
    return
  }
  const ticket = loads.begin()
  loading.value = true
  message.value = ''
  try {
    const response = await props.bridge.request({ type: MessageType.ListHistoryQueries, payload: { force, surface: 'limit' } }, ticket.signal)
    if (!loads.isCurrent(ticket.id)) return
    if (response.type !== MessageType.HistoryQueriesResult || !response.payload.ok) {
      templates.value = []
      message.value = response.type === MessageType.Error
        ? response.payload.message
        : response.type === MessageType.HistoryQueriesResult && !response.payload.ok
          ? response.payload.error.message
          : '期限模板没有读到。'
      return
    }
    templates.value = response.payload.data
    if (response.payload.data.length === 0) message.value = '当前账号还没有期限监控模板。'
  } catch {
    if (loads.isCurrent(ticket.id)) message.value = '读取期限模板失败。'
  } finally {
    if (loads.isCurrent(ticket.id)) loading.value = false
  }
}

async function applyTemplate(id: string): Promise<void> {
  selectedId.value = id
  if (!id || !props.bridge) {
    values.value = {}
    return
  }
  const ticket = loads.begin()
  message.value = ''
  const response = await props.bridge.request({ type: MessageType.GetHistoryQuery, payload: { queryId: id, surface: 'limit' } }, ticket.signal)
  if (!loads.isCurrent(ticket.id)) return
  if (response.type !== MessageType.HistoryQueryResult || !response.payload.ok) {
    message.value = response.type === MessageType.HistoryQueryResult && !response.payload.ok ? response.payload.error.message : '这个期限模板没有打开。'
    return
  }
  const parsed = readLimitQueryXml(response.payload.data.queryXml)
  if (!parsed.ok) {
    message.value = parsed.error.message
    return
  }
  values.value = parsed.data
  const named = templates.value.find(item => item.id === id)
  if (named) saveName.value = named.name
}

async function saveTemplate(): Promise<void> {
  if (!props.bridge || saving.value) return
  const title = saveName.value.trim()
  if (!title) {
    message.value = '先写模板名称。'
    return
  }
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(values.value)) {
    if (isLimitMonitorInputField(key) && value.trim()) fields[key] = value.trim()
  }
  if (!Object.keys(fields).length) {
    message.value = '先填写至少一项查询条件，再保存。'
    return
  }
  const selected = templates.value.find(item => item.id === selectedId.value)
  const queryId = selected && isQueryGuid(selected.id) ? selected.id : ''
  const before = new Set(templates.value.map(item => item.id))
  saving.value = true
  message.value = '正在写入原网站的期限模板…'
  try {
    const response = await props.bridge.request({
      type: MessageType.SaveHistoryQuery,
      payload: { title, queryId, queryXml: buildLimitQueryXml(fields), surface: 'limit' }
    })
    if (response.type !== MessageType.HistoryQuerySaved || !response.payload.ok) {
      message.value = response.type === MessageType.HistoryQuerySaved && !response.payload.ok
        ? response.payload.error.message
        : response.type === MessageType.Error ? response.payload.message : '原网站没有保存这份期限模板。'
      return
    }
    await loadTemplates(true)
    const created = templates.value.find(item => !before.has(item.id) && item.name === title)
    const saved = queryId ? templates.value.find(item => item.id === queryId) : created
    if (saved) {
      selectedId.value = saved.id
      saveName.value = saved.name
    }
    message.value = queryId ? '已更新原网站上的这份期限模板。' : '已在原网站新建这份期限模板。'
  } catch {
    message.value = '保存期限模板失败。'
  } finally {
    saving.value = false
  }
}

async function deleteTemplate(): Promise<void> {
  if (!props.bridge || deleting.value || saving.value) return
  const current = templates.value.find(item => item.id === selectedId.value)
  if (!current || !isQueryGuid(current.id)) {
    message.value = '先选中原网站上的期限模板，再删除。'
    return
  }
  const agreed = await confirmDialog({
    title: '删除原网站模板',
    message: `会从原网站删掉「${templateLabel(current)}」。`,
    confirmLabel: '删除'
  })
  if (!agreed) return
  deleting.value = true
  message.value = '正在从原网站删除…'
  try {
    const response = await props.bridge.request({
      type: MessageType.DeleteHistoryQuery,
      payload: { queryId: current.id, surface: 'limit' }
    })
    if (response.type !== MessageType.HistoryQueryDeleted || !response.payload.ok) {
      message.value = response.type === MessageType.HistoryQueryDeleted && !response.payload.ok
        ? response.payload.error.message
        : response.type === MessageType.Error ? response.payload.message : '原网站没有删除这份期限模板。'
      return
    }
    selectedId.value = ''
    await loadTemplates(true)
    message.value = '已从原网站删除这份期限模板。'
  } catch {
    message.value = '删除期限模板失败。'
  } finally {
    deleting.value = false
  }
}

function search(): void {
  if (!props.canSearch) return
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(values.value)) {
    if (isLimitMonitorInputField(key)) fields[key] = value
  }
  const volumes = splitCaseVolumes(fields.case_volume ?? '')
  fields.case_volume = joinCaseVolumes(volumes)
  const ctrl = fields.ctrl_proc?.trim() ?? ''
  const ctrlIds = ctrl.split(',').map(item => item.trim()).filter(Boolean)
  const ctrlReady = ctrlIds.length > 0 && ctrlIds.every(item => isQueryGuid(item))
  if (ctrl && !ctrlReady) {
    message.value = '处理事项要先从列表里选中，再查询。'
    return
  }
  if (ctrlReady) fields.ctrl_proc = ctrlIds.join(',')
  emit('search', {
    type: 'all',
    caseVolume: fields.case_volume,
    applicationNo: fields.app_no ?? '',
    customerName: fields.customer_name ?? '',
    ...(ctrlReady ? { ctrlProcId: ctrlIds.join(',') } : {}),
    fields,
    ...(selectedId.value ? { templateId: selectedId.value } : {})
  })
}

function reset(): void {
  values.value = {}
  selectedId.value = ''
  emit('search', { type: 'all', caseVolume: '', applicationNo: '', customerName: '', reset: true })
}

async function loadPickers(force: boolean): Promise<void> {
  if (!props.bridge || !props.userId) {
    checkMessage.value = '请先确认 EASY 已登录。'
    return
  }
  checking.value = true
  if (force || !pickersReady.value) checkMessage.value = '正在向原网站读取期限下拉…'
  const caseType = valueOf('case_type')
  const country = valueOf('country').split(',').map(item => item.trim()).filter(item => /^[A-Za-z0-9_-]{1,40}$/.test(item)).join(',')
  const procType = valueOf('proc_type')
  try {
    const response = await props.bridge.request({
      type: MessageType.LoadDictionary,
      payload: {
        kind: 'picker',
        force,
        ...(isQueryGuid(caseType) ? { caseTypeId: caseType } : {}),
        ...(country ? { country } : {}),
        ...(isQueryGuid(procType) ? { procType } : {})
      }
    })
    if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'picker') {
      checkMessage.value = response.type === MessageType.Error
        ? response.payload.message
        : response.type === MessageType.DictionaryResult && !response.payload.ok
          ? response.payload.error.message
          : '期限下拉没有读到。'
      return
    }
    pickers.value = response.payload.data.dictionaries
    pickersReady.value = true
    if (props.userId) {
      const fields = { ...LIMIT_PICKER_FIELDS }
      delete fields.case_status_id
      rememberDictionaries(props.userId, fields, response.payload.data.dictionaries)
      rememberChoices(props.userId, 'case_status_id', choices('case_status_id'))
    }
    checkMessage.value = describePickerReceipt(response.payload.data.dictionaries, response.payload.data.warnings)
  } catch {
    checkMessage.value = '读取期限下拉失败。'
  } finally {
    checking.value = false
  }
}

function applySeed(): void {
  if (!props.seed) return
  values.value = { ...props.seed }
  selectedId.value = ''
  const hidden = new Set(LIMIT_BLOCKS.filter(block => block.more).flatMap(block => block.cells.flatMap(cell => {
    if (cell.kind === 'dates') return [cell.start, cell.end, cell.empty].filter((item): item is string => Boolean(item))
    return [cell.key]
  })))
  if (Object.entries(props.seed).some(([key, value]) => hidden.has(key) && value.trim())) showMore.value = true
  message.value = '已载入绑定的查询条件。可以再改，改完重新查询。'
}

watch(() => props.seedToken, () => {
  if (!props.seed) {
    if (!props.seedToken) return
    values.value = {}
    selectedId.value = ''
    showMore.value = false
    message.value = ''
    return
  }
  applySeed()
}, { immediate: true })
watch(() => props.userId, () => {
  templates.value = []
  selectedId.value = ''
  pickers.value = {}
  pickersReady.value = false
  checkMessage.value = ''
  applySeed()
  if (props.userId) {
    activateOptionFallback(props.userId)
    void hydrateOptionFallback(props.userId)
    void loadTemplates(false)
    void loadPickers(false)
  }
}, { immediate: true })
watch(() => [valueOf('case_type'), valueOf('proc_type'), valueOf('country')].join('|'), (next, previous) => {
  if (!pickersReady.value || next === previous) return
  if (valueOf('ctrl_proc')) setValue('ctrl_proc', '')
  const status = valueOf('case_status_id')
  if (status && !choices('case_status_id').some(item => item.value === status)) setValue('case_status_id', '')
  window.clearTimeout(filterTimer)
  filterTimer = window.setTimeout(() => { void loadPickers(true) }, 400)
})
</script>

<template>
  <section class="card query-template limit-form" aria-label="期限监控条件">
    <div class="section-heading">
      <strong>当前账号的期限模板</strong>
      <button type="button" class="text-button" :disabled="!canRead || loading" @click="loadTemplates(true)">重新读取</button>
    </div>
    <p v-if="loading" class="hint">正在读取当前账号的期限模板…</p>
    <p v-if="message" class="hint">{{ message }}</p>
    <ul v-if="templates.length" class="template-picks">
      <li v-for="item in templates" :key="item.id">
        <button type="button" :class="{ on: selectedId === item.id }" @click="applyTemplate(item.id)">
          <b v-hint.clip="templateLabel(item)">{{ templateLabel(item) }}</b>
        </button>
      </li>
    </ul>
    <label>选用模板
      <ThemeSelect :model-value="selectedId" placeholder="请选择" empty-text="当前账号还没有期限监控模板。" :options="templates.map(item => ({ value: item.id, label: templateLabel(item) }))" @update:model-value="applyTemplate(String($event))" />
    </label>
    <div class="query-conditions">
      <div class="section-heading">
        <strong>查询条件</strong>
        <span class="inline-actions">
          <button type="button" class="text-button" :disabled="!canRead || checking" @click="loadPickers(true)">校对最新字段</button>
          <button type="button" class="text-button" @click="showMore = !showMore">{{ showMore ? '收起更多条件' : '更多条件' }}</button>
        </span>
      </div>
      <p v-if="checking && !pickersReady" class="hint">正在读取下拉选项…</p>
      <p v-if="checkMessage" class="hint">{{ checkMessage }}</p>
      <section v-for="block in blocks" :key="block.title" class="query-block">
        <strong>{{ block.title }}</strong>
        <div class="query-grid">
          <template v-for="(cell, index) in block.cells" :key="block.title + index">
            <label v-if="cell.kind === 'text'" class="query-cell" :class="{ 'span-all': cell.key === 'case_volume' }">
              <span>{{ cell.label }}</span>
              <span class="limit-input">
                <textarea v-if="cell.key === 'case_volume'" :value="valueOf(cell.key)" rows="3" placeholder="一个文号，或多个文号用分号、空格、换行隔开" @input="onText(cell.key, $event)" />
                <input v-else :value="valueOf(cell.key)" type="text" @input="onText(cell.key, $event)" />
                <label v-for="item in cell.checks ?? []" :key="item.key" class="empty-check"><input :checked="checked(item.key)" type="checkbox" @change="onCheck(item.key, $event)" />{{ item.label }}</label>
              </span>
            </label>
            <label v-else-if="cell.kind === 'named' && cell.key === 'ctrl_proc'" class="query-cell">
              <span>{{ cell.label }}</span>
              <TreeOptionSelect v-if="treeChoices(cell.key).length" :model-value="valueOf(cell.key)" :options="treeChoices(cell.key)" @update:model-value="setValue(cell.key, String($event))" />
              <ThemeSelect v-else-if="choices(cell.key).length" :model-value="valueOf(cell.key)" :value-label="namedLabel(cell.key)" :options="optionsFor(cell.key)" @update:model-value="setValue(cell.key, String($event))" />
              <span v-else class="hint">先校对字段，再选择处理事项</span>
              <span v-if="splitCtrlProcIds(valueOf(cell.key)).length > 1" class="hint">选中的事项会一起放进同一次查询。一行只会命中其中一项。</span>
            </label>
            <label v-else-if="cell.kind === 'named'" class="query-cell">
              <span>{{ cell.label }}</span>
              <TreeOptionSelect v-if="treeChoices(cell.key).length" :model-value="valueOf(cell.key)" :options="treeChoices(cell.key)" @update:model-value="setValue(cell.key, String($event))" />
              <ThemeSelect v-else-if="cell.key === 'case_status_id' || choices(cell.key).length" :model-value="valueOf(cell.key)" :options="optionsFor(cell.key)" @update:model-value="setValue(cell.key, String($event))" />
              <input v-else :value="namedShown(cell.key)" type="text" @input="onText(cell.key, $event)" />
            </label>
            <label v-else-if="cell.kind === 'select'" class="query-cell">
              <span>{{ cell.label }}</span>
              <ThemeSelect :model-value="valueOf(cell.key)" :options="optionsFor(cell.key)" @update:model-value="setValue(cell.key, String($event))" />
            </label>
            <div v-else class="query-cell">
              <span>{{ cell.label }}</span>
              <span class="date-pair">
                <input :value="valueOf(cell.start)" type="text" placeholder="起" @input="onText(cell.start, $event)" />
                <em>到</em>
                <input :value="valueOf(cell.end)" type="text" placeholder="止" @input="onText(cell.end, $event)" />
                <label v-if="cell.empty" class="empty-check"><input :checked="checked(cell.empty)" type="checkbox" @change="onCheck(cell.empty, $event)" />为空</label>
              </span>
            </div>
          </template>
        </div>
      </section>
    </div>
    <div class="form-actions">
      <label class="limit-save">模板名称<input v-model="saveName" type="text" maxlength="80" /></label>
      <button class="ghost" type="button" :disabled="!canRead || saving" @click="saveTemplate">{{ saving ? '正在保存…' : '保存到网站' }}</button>
      <button class="ghost" type="button" :disabled="!canRead || deleting || !selectedId" @click="deleteTemplate">{{ deleting ? '正在删除…' : '删除原网站模板' }}</button>
      <button class="ghost" type="button" @click="reset">重置</button>
      <button v-if="canSearch" class="solid" type="button" @click="search">查询</button>
    </div>
  </section>
</template>
