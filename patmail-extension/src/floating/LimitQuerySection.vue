<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ThemeSelect from '../../../src/components/ThemeSelect.vue'
import TreeOptionSelect from '../../../src/components/TreeOptionSelect.vue'
import type { HistoryQueryOption } from '../api/query-history'
import { LIMIT_BLOCKS, LIMIT_OPTION_KEYS, LIMIT_SELECTS, readLimitQueryXml } from '../api/limit-form'
import { pageSelectOptions } from '../query/form-page'
import { activateOptionFallback, hydrateOptionFallback, optionFallbackEpoch, rememberDictionaries, savedChoices, subscribeOptionFallback } from '../query/option-fallback'
import type { NormalizedDictionary } from '../api/dictionaries'
import { choicesFromDictionary, describePickerReceipt, LIMIT_PICKER_FIELDS } from '../api/dictionaries/picker-catalog'
import { hasOptionTree } from '../query/option-tree'
import { isLimitMonitorInputField, type LimitMonitorQuery } from '../api/limit-monitor-params'
import { isQueryGuid } from '../query/query-validator'
import { joinCaseVolumes, splitCaseVolumes } from '../customer/volume-list'
import { TemplateLoadCoordinator } from '../query/load-coordinator'
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
function choices(key: string): { value: string; label: string; parent?: string }[] {
  fallbackTick.value
  const source = LIMIT_PICKER_FIELDS[key]
  const dictionary = source ? pickers.value[source] : undefined
  const live = dictionary && dictionary.options.length > 0
    ? choicesFromDictionary(dictionary, valueOf('case_type'), valueOf('country'))
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
    if (props.userId) rememberDictionaries(props.userId, LIMIT_PICKER_FIELDS, response.payload.data.dictionaries)
    checkMessage.value = describePickerReceipt(response.payload.data.dictionaries, response.payload.data.warnings)
  } catch {
    checkMessage.value = '读取期限下拉失败。'
  } finally {
    checking.value = false
  }
}

watch(() => props.seedToken, () => {
  if (!props.seed) return
  values.value = { ...props.seed }
  selectedId.value = ''
  message.value = '已载入绑定的查询条件。可以再改，改完重新查询。'
})
watch(() => props.userId, () => {
  templates.value = []
  values.value = {}
  selectedId.value = ''
  pickers.value = {}
  pickersReady.value = false
  checkMessage.value = ''
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
    <label>选用模板
      <ThemeSelect :model-value="selectedId" placeholder="请选择" :options="templates.map(item => ({ value: item.id, label: item.name }))" @update:model-value="applyTemplate(String($event))" />
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
              <ThemeSelect v-else-if="choices(cell.key).length" :model-value="valueOf(cell.key)" :options="optionsFor(cell.key)" @update:model-value="setValue(cell.key, String($event))" />
              <span v-else class="hint">先校对字段，再选择处理事项</span>
            </label>
            <label v-else-if="cell.kind === 'named'" class="query-cell">
              <span>{{ cell.label }}</span>
              <TreeOptionSelect v-if="treeChoices(cell.key).length" :model-value="valueOf(cell.key)" :options="treeChoices(cell.key)" @update:model-value="setValue(cell.key, String($event))" />
              <ThemeSelect v-else-if="choices(cell.key).length" :model-value="valueOf(cell.key)" :options="optionsFor(cell.key)" @update:model-value="setValue(cell.key, String($event))" />
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
      <button class="ghost" type="button" @click="reset">重置</button>
      <button class="solid" type="button" :disabled="!canSearch" @click="search">查询</button>
    </div>
  </section>
</template>
