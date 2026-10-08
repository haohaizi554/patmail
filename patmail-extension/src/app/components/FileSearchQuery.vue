<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { FileSearchQuery } from '../../api/file-search-params'
import { assessQueryScope, isFileSearchBusinessField } from '../../api/file-search-params'
import { coerceFileSearchQuery } from '../../api/message-guards'
import type { FileSearchResult } from '../../api/file-search-types'
import { selectPage, toSelectedFile, toggleSelected, type SelectedPatentFile } from '../../mail'
import QueryTemplateSection from '../../floating/QueryTemplateSection.vue'
import ThemeSelect from '../../shell/components/ThemeSelect.vue'
import { MessageType, type MessageBridge } from '../../shared/message'

const props = withDefaults(defineProps<{
  userId: string
  origin: string
  canSearch: boolean
  seed?: Record<string, string> | null
  seedToken?: number
  selectable?: boolean
  epoch?: number
}>(), { seed: null, seedToken: 0, selectable: false, epoch: 0 })

const selected = defineModel<Record<string, SelectedPatentFile>>('selected', { default: () => ({}) })

const emit = defineEmits<{
  searched: [query: FileSearchQuery]
  plan: []
  review: []
}>()

const bridge = inject<MessageBridge>('bridge')
const pageSize = ref(20)
const pageSizeOptions = [
  { value: 20, label: '20' },
  { value: 50, label: '50' },
  { value: 100, label: '100' }
]
const querySessionId = ref('')
const sourceNotice = ref('')
const searchState = ref<'idle' | 'loading' | 'success' | 'empty' | 'error'>('idle')
const searchMessage = ref('')
const result = ref<FileSearchResult | null>(null)
const resultsSection = ref<HTMLElement | null>(null)
const lastQuery = ref<FileSearchQuery | null>(null)
let generation = 0

function messageForError(code: string, message: string): string {
  if (code === 'SESSION_EXPIRED') return 'EASY 登录已失效，请在原网站重新登录后检测。'
  if (code === 'AUTH_UNKNOWN') return '无法确认当前登录状态，请重试。'
  if (code === 'REQUEST_TIMEOUT') return '原网站查询太慢，没有在一分钟内返回。把我方文号或申请号写具体一点再查。'
  if (code === 'NETWORK_ERROR') return '网络异常，请检查 EASY 网站连接。'
  return message || '请求失败，请稍后重试。'
}

function fieldsFor(query: FileSearchQuery): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(query.resolvedFields ?? {})) {
    if (!isFileSearchBusinessField(key) || typeof value !== 'string' || value.length > 4000) continue
    fields[key] = value
  }
  if (query.caseVolume?.trim()) fields.case_volume = query.caseVolume.trim()
  if (fields.is_close !== undefined) {
    fields.is_close = fields.is_close.trim() === '1' || fields.is_close.trim() === '否' ? '1' : ''
  }
  return fields
}

function reloadExtension(): void {
  const runtime = (globalThis as { chrome?: { runtime?: { reload?: () => void } } }).chrome?.runtime
  if (typeof runtime?.reload === 'function') {
    runtime.reload()
    return
  }
  searchMessage.value = '当前页面不能直接重载扩展。请到扩展管理页重新加载 PatMail。'
}

async function showResults(): Promise<void> {
  await nextTick()
  const section = resultsSection.value
  const viewport = section?.closest<HTMLElement>('.body')
  if (section && viewport) {
    viewport.scrollTop += section.getBoundingClientRect().top - viewport.getBoundingClientRect().top
  }
}

async function executeSearch(query: FileSearchQuery, run: 'start' | 'continue' = 'start'): Promise<void> {
  if (!bridge || !props.canSearch) return
  const fields = fieldsFor(query)
  const resolvedEnough = assessQueryScope(fields).sufficient
  if (!resolvedEnough && ![query.caseVolume, query.applicationNo, query.customerName, query.fileName, query.fileDescriptionId].some(value => value?.trim())) {
    searchState.value = 'error'
    searchMessage.value = '请输入查询条件。'
    result.value = null
    lastQuery.value = null
    void showResults()
    return
  }
  const current = ++generation
  const next = coerceFileSearchQuery({ ...query, resolvedFields: fields, pageIndex: query.pageIndex || 1, pageSize: query.pageSize || pageSize.value }) ?? {
    resolvedFields: fields, pageIndex: 1, pageSize: pageSize.value
  }
  lastQuery.value = next
  emit('searched', next)
  searchState.value = 'loading'
  searchMessage.value = ''
  result.value = null
  try {
    const continuation = run === 'continue' && querySessionId.value ? { querySessionId: querySessionId.value } : undefined
    const response = await bridge.request({ type: MessageType.SearchFiles, payload: continuation ? { query: next, continuation } : { query: next } })
    if (current !== generation) return
    if (response.type !== MessageType.SearchFilesResult) {
      searchState.value = 'error'
      searchMessage.value = response.type === MessageType.Error ? response.payload.message : '文件查询返回了意外结果。'
      void showResults()
      return
    }
    if (!response.payload.ok) {
      searchState.value = 'error'
      searchMessage.value = messageForError(response.payload.error.code, response.payload.error.message)
      void showResults()
      return
    }
    result.value = response.payload.data
    sourceNotice.value = response.payload.data.sourceMessage ?? ''
    if (response.payload.data.sourceCode === 'QUERY_SESSION_INVALID' || response.payload.data.sourceCode === 'QUERY_LAYOUT_CHANGED') querySessionId.value = ''
    else if (response.payload.data.querySessionId) querySessionId.value = response.payload.data.querySessionId
    if (run === 'start') selected.value = {}
    searchState.value = result.value.total === 0 ? 'empty' : 'success'
    void showResults()
  } catch {
    if (current !== generation) return
    searchState.value = 'error'
    searchMessage.value = '文件查询通信失败，请重试。'
    void showResults()
  }
}

function refresh(): void {
  if (lastQuery.value) void executeSearch({ ...lastQuery.value }, 'continue')
}
function changePageSize(): void {
  if (!lastQuery.value || !props.canSearch || ![20, 50, 100].includes(pageSize.value)) return
  void executeSearch({ ...lastQuery.value, pageIndex: 1, pageSize: pageSize.value }, 'start')
}
function page(delta: number): void {
  if (!lastQuery.value || !result.value || searchState.value === 'loading') return
  const next = lastQuery.value.pageIndex + delta
  if (next < 1 || next > result.value.totalPages) return
  void executeSearch({ ...lastQuery.value, pageIndex: next }, 'continue')
}
function clearView(): void {
  generation += 1
  result.value = null
  lastQuery.value = null
  querySessionId.value = ''
  sourceNotice.value = ''
  searchState.value = 'idle'
  searchMessage.value = ''
  selected.value = {}
}

watch(() => props.epoch, () => { clearView() })
watch(() => props.seedToken, () => {
  if (!props.seedToken || !props.seed) return
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(props.seed)) {
    const text = value.trim()
    if (!text || text.length > 4000) continue
    if (key === 'is_close') {
      if (text === '1' || text === '否') fields.is_close = '1'
      continue
    }
    fields[key] = text
  }
  void executeSearch({ resolvedFields: fields, pageIndex: 1, pageSize: pageSize.value })
})

onBeforeUnmount(() => {
  generation += 1
  if (bridge) void bridge.request({ type: MessageType.CancelFileSearch })
})
</script>

<template>
  <div class="file-search-query">
    <p class="hint">结案默认包含在结果里。更多案件条件里的「是否包含结案」选「否」，结案文件才不会出现。不要把那种空结果当成库里没有。</p>
    <QueryTemplateSection
      :bridge="bridge"
      :can-search="canSearch"
      :user-id="userId"
      :origin="origin"
      mode="history"
      :manage="false"
      :page-size="pageSize"
      :seed="seed"
      :seed-token="seedToken"
      @search="executeSearch"
    />
    <slot />
    <section ref="resultsSection" class="card file-results" aria-label="查询结果">
      <div class="section-heading">
        <strong>查询结果</strong>
        <label class="page-size">每页数量
          <ThemeSelect v-model="pageSize" :disabled="!canSearch || searchState === 'loading'" :options="pageSizeOptions" @change="changePageSize" />
        </label>
        <button type="button" class="text-button" :disabled="!canSearch || !lastQuery || searchState === 'loading'" @click="refresh">刷新</button>
      </div>
      <div v-if="result" class="result-toolbar">
        <span>共 {{ result.total }} 个文件</span>
      </div>
      <p v-if="searchState === 'idle'" class="hint">输入条件后查询文件。</p>
      <p v-else-if="searchState === 'loading'" class="hint" role="status">正在查询…</p>
      <p v-else-if="searchState === 'error'" class="error" role="alert">{{ searchMessage }}</p>
      <button v-if="searchState === 'error' && searchMessage.includes('没有接住')" type="button" class="solid tiny" @click="reloadExtension">重新加载扩展</button>
      <p v-else-if="searchState === 'empty'" class="hint" role="status">没有符合条件的文件。结案仍会查到；若把「是否包含结案」选成了「否」，结案文件不会出现。</p>
      <template v-else-if="result">
        <p v-if="sourceNotice" class="hint" role="status">{{ sourceNotice }}</p>
        <div v-if="selectable" class="result-toolbar">
          <span>已选 {{ Object.keys(selected).length }} 个文件</span>
          <button type="button" class="text-button" @click="selected = selectPage(selected, result.items.map(file => toSelectedFile(file, undefined, querySessionId)), true)">当前页全选</button>
          <button type="button" class="text-button" @click="selected = {}">清空已选</button>
          <button type="button" class="text-button" @click="emit('review')">查看已选</button>
          <button type="button" class="text-button" :disabled="Object.keys(selected).length === 0" @click="emit('plan')">生成发文计划</button>
        </div>
        <article v-for="file in result.items" :key="file.fileId" class="file-card">
          <label v-if="selectable" class="check-line">
            <input type="checkbox" :checked="Boolean(selected[file.fileId])" @change="selected = toggleSelected(selected, toSelectedFile(file, selected[file.fileId]?.customerProfileId, querySessionId))" />
            {{ file.fileName }}
          </label>
          <strong v-else>{{ file.fileName }}</strong>
          <dl>
            <div><dt>文件描述</dt><dd>{{ file.fileDescription || '暂无' }}</dd></div>
            <div><dt>我方文号</dt><dd>{{ file.caseVolume || '暂无' }}</dd></div>
            <div><dt>申请号</dt><dd>{{ file.applicationNo || '暂无' }}</dd></div>
            <div><dt>客户名称</dt><dd>{{ file.customerName || '暂无' }}</dd></div>
            <div><dt>官方发文日</dt><dd>{{ file.officialPostDate || '暂无' }}</dd></div>
            <div><dt>文件状态</dt><dd>{{ file.fileStatus || '暂无' }}</dd></div>
          </dl>
        </article>
        <nav class="pagination" aria-label="文件分页">
          <button type="button" :disabled="result.pageIndex <= 1" @click="page(-1)">上一页</button>
          <span>第 {{ result.pageIndex }} / {{ result.totalPages }} 页</span>
          <button type="button" :disabled="result.pageIndex >= result.totalPages" @click="page(1)">下一页</button>
        </nav>
      </template>
    </section>
  </div>
</template>
