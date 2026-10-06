<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CURRENT_ENVIRONMENT } from '../api/config'
import type { CustomFieldColumn, DictionaryOption, FileTypeTreeSnapshot, NormalizedDictionary } from '../api/dictionaries'
import type { FileSearchQuery } from '../api/file-search-params'
import { optionsForCaseType, resolveFileDescriptionDisplay, resolveInternalIdDisplay, formHasQueryScope, formValuesToFields, FILE_SEARCH_SCHEMA } from '../schema'
import { MessageType, type MessageBridge } from '../shared/message'
import FileTypePicker from './FileTypePicker.vue'
import ThemeSelect from '../shell/components/ThemeSelect.vue'

const props = defineProps<{ bridge?: MessageBridge; canSearch: boolean; pageSize: number }>()
const emit = defineEmits<{ search: [query: FileSearchQuery] }>()

const values = ref<Record<string, string>>({})
const showAdvanced = ref(false)
const showTree = ref(false)
const dictionaryMessage = ref('')
const basic = ref<Record<string, NormalizedDictionary>>({})
const flow = ref<Record<string, NormalizedDictionary>>({})
const columns = ref<CustomFieldColumn[]>([])
const tree = ref<FileTypeTreeSnapshot | null>(null)
const loading = ref(false)
let coreToken = 0
let treeToken = 0

const fileClassOptions: DictionaryOption[] = [{
  value: CURRENT_ENVIRONMENT.fileClass,
  label: '所有文件（不含官方来文 zip 及分析纸件通知书）'
}]
const visibleSchema = computed(() => FILE_SEARCH_SCHEMA.filter(field => showAdvanced.value || !field.advanced))
const caseTypeId = computed(() => values.value.case_type ?? '')

function dictionaryOptions(key: string | undefined): DictionaryOption[] {
  if (!key) return []
  if (key === 'fileclass') return fileClassOptions
  if (key === 'fileStatus') return flow.value.fileStatus?.options ?? []
  if (key === 'procStatus') return flow.value.procStatus?.options ?? basic.value.procStatus?.options ?? []
  if (key === 'caseDirection') return flow.value.caseDirection?.options ?? basic.value.caseDirection?.options ?? []
  return basic.value[key]?.options ?? []
}
function selectOptions(key: string | undefined, dependsOn?: string[]): DictionaryOption[] {
  const options = dictionaryOptions(key)
  if (dependsOn?.includes('case_type') && key) return optionsForCaseType(key, options, caseTypeId.value)
  return options.filter(item => !item.disabled)
}
function fieldText(key: string): string {
  return values.value[key] ?? ''
}
function setField(key: string, value: string): void {
  values.value = { ...values.value, [key]: value }
}

async function ensureCore(): Promise<void> {
  if (!props.bridge || !props.canSearch || loading.value || Object.keys(basic.value).length > 0) return
  const token = ++coreToken
  loading.value = true
  dictionaryMessage.value = ''
  try {
    const kinds = ['basic', 'flow', 'fieldColumn', 'listColumn'] as const
    const responses = await Promise.all(kinds.map(kind => props.bridge!.request({
      type: MessageType.LoadDictionary, payload: { kind, force: false }
    })))
    if (token !== coreToken) return
    for (const response of responses) {
      if (response.type !== MessageType.DictionaryResult || !response.payload.ok) {
        dictionaryMessage.value = response.type === MessageType.DictionaryResult && !response.payload.ok
          ? response.payload.error.message : '字典加载失败，文本条件仍可查询。'
        continue
      }
      const data = response.payload.data
      if (data.kind === 'basic') basic.value = data.dictionaries
      if (data.kind === 'flow') flow.value = data.dictionaries
      if (data.kind === 'fieldColumn') columns.value = data.columns
    }
  } catch {
    if (token === coreToken) dictionaryMessage.value = '字典加载失败，文本条件仍可查询。'
  } finally {
    if (token === coreToken) loading.value = false
  }
}

async function loadTree(caseType: string): Promise<void> {
  if (!props.bridge || !caseType) {
    tree.value = null
    return
  }
  const token = ++treeToken
  const response = await props.bridge.request({
    type: MessageType.LoadDictionary, payload: { kind: 'fileType', force: false, caseTypeId: caseType }
  })
  if (token !== treeToken) return
  if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'fileType') {
    tree.value = null
    dictionaryMessage.value = response.type === MessageType.DictionaryResult && !response.payload.ok
      ? response.payload.error.message : '文件描述树加载失败。'
    return
  }
  tree.value = response.payload.data
  const known = new Set(response.payload.data.nodes.map(node => node.id))
  const current = fieldText('filetype').split(',').map(item => item.trim()).filter(Boolean)
  const applicable = current.filter(id => known.has(id))
  if (applicable.length !== current.length) {
    setField('filetype', applicable.join(','))
    dictionaryMessage.value = '已清除不适用于当前案件类型的文件描述。'
  }
}

watch(caseTypeId, (value, previous) => {
  if (value === previous) return
  tree.value = null
  if (value) void loadTree(value)
})

function displayOf(key: string, multiple = false): string {
  if (key === 'filetype') {
    return resolveFileDescriptionDisplay({ savedIds: fieldText(key), descriptions: tree.value?.nodes ?? [] }).text
  }
  const schema = FILE_SEARCH_SCHEMA.find(item => item.key === key)
  return resolveInternalIdDisplay(fieldText(key), selectOptions(schema?.dictionaryKey, schema?.dependsOn), multiple).text
}

function search(): void {
  const fields = formValuesToFields(values.value)
  if (!formHasQueryScope(values.value)) {
    emit('search', { resolvedFields: {}, pageIndex: 1, pageSize: props.pageSize })
    return
  }
  emit('search', { resolvedFields: fields, pageIndex: 1, pageSize: props.pageSize })
}
</script>

<template>
  <form class="card search-form" aria-label="查询条件" @submit.prevent="search">
    <strong>查询条件</strong>
    <p v-if="dictionaryMessage" class="hint">{{ dictionaryMessage }}</p>
    <template v-for="field in visibleSchema" :key="field.key">
      <label v-if="field.controlType === 'text'">{{ field.label }}
        <input :value="fieldText(field.key)" type="text" autocomplete="off" @input="setField(field.key, ($event.target as HTMLInputElement).value)" />
      </label>
      <label v-else-if="field.controlType === 'select'">{{ field.label }}
        <ThemeSelect :model-value="fieldText(field.key)" placeholder="请选择" :options="selectOptions(field.dictionaryKey, field.dependsOn)" @open="ensureCore" @update:model-value="setField(field.key, String($event))" />
        <span v-if="fieldText(field.key) && displayOf(field.key) === '未识别的历史 ID'" class="hint">未识别的历史 ID</span>
      </label>
      <div v-else-if="field.controlType === 'tree'">
        <span class="hint">{{ field.label }}：{{ fieldText(field.key) ? displayOf(field.key, true) : '未设置' }}</span>
        <button type="button" class="text-button" @click="showTree = !showTree; ensureCore()">{{ showTree ? '收起文件描述' : '搜索并选择文件描述' }}</button>
        <FileTypePicker v-if="showTree && tree" :nodes="tree.nodes" :root-ids="tree.rootIds" :model-value="fieldText('filetype')" @update:model-value="setField('filetype', $event)" />
        <p v-else-if="showTree" class="hint">请先选择案件类型。</p>
      </div>
      <label v-else-if="field.controlType === 'date-range'">{{ field.label }}
        <span class="date-range">
          <input :value="fieldText(field.key)" type="date" aria-label="官方发文日起始" @input="setField(field.key, ($event.target as HTMLInputElement).value)" />
          <input :value="fieldText(field.endKey ?? '')" type="date" aria-label="官方发文日结束" @input="setField(field.endKey ?? '', ($event.target as HTMLInputElement).value)" />
        </span>
      </label>
      <label v-else-if="field.controlType === 'checkbox'" class="check-line">
        <input :checked="fieldText(field.key) === '1'" type="checkbox" @change="setField(field.key, ($event.target as HTMLInputElement).checked ? '1' : '')" />
        {{ field.label }}
      </label>
    </template>
    <div v-if="showAdvanced">
      <p v-for="column in columns.filter(item => !item.enabled)" :key="column.columnId" class="hint">{{ column.label }}当前不可用，不会作为新的编辑项。</p>
    </div>
    <button type="button" class="text-button" @click="showAdvanced = !showAdvanced">{{ showAdvanced ? '收起条件' : '更多条件' }}</button>
    <button type="submit" class="search-submit" :disabled="!canSearch">查询文件</button>
  </form>
</template>
