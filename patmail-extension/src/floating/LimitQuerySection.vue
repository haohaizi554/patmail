<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ThemeSelect from '../../../src/components/ThemeSelect.vue'
import TreeOptionSelect from '../../../src/components/TreeOptionSelect.vue'
import type { HistoryQueryOption } from '../api/query-history'
import { LIMIT_BLOCKS, LIMIT_OPTION_KEYS, LIMIT_SELECTS, readLimitQueryXml } from '../api/limit-form'
import { pageSelectOptions } from '../query/form-page'
import { hasOptionTree } from '../query/option-tree'
import { isLimitMonitorInputField, LIMIT_MONITOR_TYPES, type LimitMonitorQuery, type LimitMonitorType } from '../api/limit-monitor-params'
import { isQueryGuid } from '../query/query-validator'
import { TemplateLoadCoordinator } from '../query/load-coordinator'
import { MessageType, type MessageBridge } from '../shared/message'

const props = defineProps<{ bridge?: MessageBridge; userId: string; canSearch: boolean }>()
const emit = defineEmits<{ search: [query: Omit<LimitMonitorQuery, 'pageIndex' | 'pageSize'> & { reset?: boolean }] }>()

const types: { value: LimitMonitorType; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'pay', label: '缴费' },
  { value: 'suspend', label: '中止' },
  { value: 'abandon', label: '放弃' },
  { value: 'recall', label: '撤回' },
  { value: 'priority', label: '优先权' },
  { value: 'fee', label: '费用' }
]
const type = ref<LimitMonitorType>('all')
const values = ref<Record<string, string>>({})
const templates = ref<HistoryQueryOption[]>([])
const selectedId = ref('')
const showMore = ref(false)
const loading = ref(false)
const message = ref('')
const loads = new TemplateLoadCoordinator()
const blocks = computed(() => LIMIT_BLOCKS.filter(block => showMore.value || !block.more))
const canRead = computed(() => Boolean(props.bridge) && Boolean(props.userId))

onBeforeUnmount(() => loads.dispose())

function valueOf(key: string): string {
  return values.value[key] ?? ''
}
function setValue(key: string, value: string): void {
  values.value = { ...values.value, [key]: value }
}
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
  const source = LIMIT_OPTION_KEYS[key] ?? key
  const options = [...(pageSelectOptions(source) ?? LIMIT_SELECTS[key] ?? [])]
  const current = valueOf(key)
  if (current && !options.some(item => item.value === current)) options.unshift({ value: current, label: isQueryGuid(current) ? '已选择' : current })
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
      message.value = response.type === MessageType.HistoryQueriesResult && !response.payload.ok ? response.payload.error.message : '期限模板没有读到。'
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
  if (!props.canSearch || !LIMIT_MONITOR_TYPES.includes(type.value)) return
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(values.value)) {
    if (isLimitMonitorInputField(key)) fields[key] = value
  }
  const ctrl = fields.ctrl_proc?.trim() ?? ''
  emit('search', {
    type: type.value,
    caseVolume: fields.case_volume ?? '',
    applicationNo: fields.app_no ?? '',
    customerName: fields.customer_name ?? '',
    ...(isQueryGuid(ctrl) ? { ctrlProcId: ctrl } : {}),
    fields: isQueryGuid(ctrl) || !ctrl ? fields : { ...fields, ctrl_proc: '' }
  })
}

function reset(): void {
  values.value = {}
  selectedId.value = ''
  type.value = 'all'
  emit('search', { type: 'all', caseVolume: '', applicationNo: '', customerName: '', reset: true })
}

watch(() => props.userId, () => {
  templates.value = []
  values.value = {}
  selectedId.value = ''
  if (props.userId) void loadTemplates(false)
}, { immediate: true })
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
      <ThemeSelect :model-value="selectedId" :options="[{ value: '', label: '请选择' }, ...templates.map(item => ({ value: item.id, label: item.name }))]" @update:model-value="applyTemplate(String($event))" />
    </label>
    <div class="filters">
      <button v-for="item in types" :key="item.value" :class="type === item.value ? 'solid tiny' : 'ghost'" type="button" @click="type = item.value">{{ item.label }}</button>
      <button class="ghost" type="button" disabled title="流程页签使用另一套字段，这里不查询">流程</button>
    </div>
    <div class="query-conditions">
      <div class="section-heading">
        <strong>查询条件</strong>
        <button type="button" class="text-button" @click="showMore = !showMore">{{ showMore ? '收起更多条件' : '更多条件' }}</button>
      </div>
      <section v-for="block in blocks" :key="block.title" class="query-block">
        <strong>{{ block.title }}</strong>
        <div class="query-grid">
          <template v-for="(cell, index) in block.cells" :key="block.title + index">
            <label v-if="cell.kind === 'text'" class="query-cell">
              <span>{{ cell.label }}</span>
              <span class="limit-input">
                <input :value="valueOf(cell.key)" type="text" @input="onText(cell.key, $event)" />
                <label v-for="item in cell.checks ?? []" :key="item.key" class="empty-check"><input :checked="checked(item.key)" type="checkbox" @change="onCheck(item.key, $event)" />{{ item.label }}</label>
              </span>
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
