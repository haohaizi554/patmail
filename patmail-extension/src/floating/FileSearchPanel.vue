<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { assessQueryScope, type FileSearchQuery } from '../api/file-search-params'
import type { FileSearchResult } from '../api/file-search-types'
import type { SessionStatus } from '../api/session'
import { applyConfirmedBind, reviewCustomerBind, selectPage, toSelectedFile, toggleSelected, type SelectedPatentFile } from '../mail'
import type { BindReviewGroup } from '../mail/selection'
import MailWorkspace from './MailWorkspace.vue'
import QueryTemplateSection from './QueryTemplateSection.vue'
import ThemeSelect from '../../../src/components/ThemeSelect.vue'
import { MessageType, type MessageBridge } from '../shared/message'
import { useWorkspace } from '../app/composables/useWorkspace'

const props = withDefaults(defineProps<{ pageOrigin?: string; showSession?: boolean }>(), { showSession: true })
const bridge = inject<MessageBridge>('bridge')
const workspace = useWorkspace()
const accountOrigin = computed(() => props.pageOrigin || location.origin)
const sessionStatus = ref<SessionStatus>('unknown')
const sessionName = ref('')
const sessionUserId = ref('')
const sessionMessage = ref('')
const sessionLoading = ref(false)
const pageSize = ref(20)
const queryUserId = computed(() => sessionUserId.value || workspace.connection.value.operatorId)
const querySessionId = ref('')
const sourceNotice = ref('')
const searchState = ref<'idle' | 'loading' | 'success' | 'empty' | 'error'>('idle')
const searchMessage = ref('')
const result = ref<FileSearchResult | null>(null)
const resultsSection = ref<HTMLElement | null>(null)
const lastQuery = ref<FileSearchQuery | null>(null)
const selected = ref<Record<string, SelectedPatentFile>>({})
const showSelected = ref(false)
const showMail = ref(false)
const bindProfileId = ref('')
const bindCustomers = ref<Array<{ id: string; name: string }>>([])
const bindReview = ref<BindReviewGroup[]>([])
const acceptedSources = ref<Record<string, boolean>>({})
let generation = 0
let sessionGeneration = 0

const canSearch = computed(() => {
  if (!props.showSession) return workspace.connection.value.sessionStatus === 'authenticated'
  if (sessionStatus.value === 'authenticated') return true
  if (sessionStatus.value === 'unknown' || sessionLoading.value) return workspace.connection.value.sessionStatus === 'authenticated'
  return false
})
const sessionLabel = computed(() => ({
  unknown: '尚未检测登录状态', checking: '检测中…', authenticated: '已登录',
  unauthenticated: '未登录', expired: '登录已失效', error: '无法确认当前登录状态'
})[sessionStatus.value])

function messageForError(code: string, message: string): string {
  if (code === 'SESSION_EXPIRED') return 'EASY 登录已失效，请在原网站重新登录后检测。'
  if (code === 'AUTH_UNKNOWN') return '无法确认当前登录状态，请重试。'
  if (code === 'REQUEST_TIMEOUT') return '原网站查询太慢，没有在一分钟内返回。把我方文号或申请号写具体一点再查。'
  if (code === 'NETWORK_ERROR') return '网络异常，请检查 EASY 网站连接。'
  return message || '请求失败，请稍后重试。'
}

async function showResults(): Promise<void> {
  await nextTick()
  const section = resultsSection.value
  const viewport = section?.closest<HTMLElement>('.body')
  if (section && viewport) {
    viewport.scrollTop += section.getBoundingClientRect().top - viewport.getBoundingClientRect().top
  }
}

async function checkSession(): Promise<void> {
  if (!bridge) {
    sessionStatus.value = 'error'
    sessionMessage.value = '页面通信不可用。'
    return
  }
  const current = ++sessionGeneration
  generation++
  void bridge.request({ type: MessageType.CancelFileSearch })
  sessionStatus.value = 'checking'
  sessionName.value = ''
  sessionUserId.value = ''
  sessionLoading.value = true
  sessionMessage.value = ''
  result.value = null
  lastQuery.value = null
  selected.value = {}
  showMail.value = false
  searchState.value = 'idle'
  try {
    const response = await bridge.request({ type: MessageType.CheckSession })
    if (current !== sessionGeneration) return
    if (response.type !== MessageType.SessionResult) {
      sessionStatus.value = 'error'
      sessionMessage.value = '会话检测返回了意外结果。'
      return
    }
    if (!response.payload.ok) {
      sessionStatus.value = response.payload.error.code === 'SESSION_EXPIRED' ? 'expired' : 'error'
      sessionMessage.value = messageForError(response.payload.error.code, response.payload.error.message)
      return
    }
    sessionStatus.value = response.payload.data.status
    sessionName.value = response.payload.data.displayName ?? ''
    sessionUserId.value = response.payload.data.userId ?? ''
    if (sessionStatus.value !== 'authenticated') {
      result.value = null
      lastQuery.value = null
      searchState.value = 'idle'
      sessionMessage.value = '请先在 EASY 原网站登录。'
    }
  } catch {
    if (current !== sessionGeneration) return
    sessionStatus.value = 'error'
    sessionMessage.value = '会话检测失败，请重试。'
  } finally {
    if (current === sessionGeneration) sessionLoading.value = false
  }
}

async function executeSearch(query: FileSearchQuery, run: 'start' | 'continue' = 'start'): Promise<void> {
  if (!bridge || !canSearch.value) return
  const resolvedEnough = query.resolvedFields ? assessQueryScope(query.resolvedFields).sufficient : false
  if (!resolvedEnough && ![query.caseVolume, query.applicationNo, query.customerName, query.fileName, query.fileDescriptionId].some(value => value?.trim())) {
    searchState.value = 'error'
    searchMessage.value = '请输入查询条件。'
    result.value = null
    lastQuery.value = null
    void showResults()
    return
  }
  const current = ++generation
  lastQuery.value = query
  searchState.value = 'loading'
  searchMessage.value = ''
  result.value = null
  try {
    const continuation = run === 'continue' && querySessionId.value ? { querySessionId: querySessionId.value } : undefined
    const response = await bridge.request({ type: MessageType.SearchFiles, payload: continuation ? { query, continuation } : { query } })
    if (current !== generation) return
    if (response.type !== MessageType.SearchFilesResult) {
      searchState.value = 'error'
      searchMessage.value = '文件查询返回了意外结果。'
      void showResults()
      return
    }
    if (!response.payload.ok) {
      searchState.value = 'error'
      searchMessage.value = messageForError(response.payload.error.code, response.payload.error.message)
      if (response.payload.error.code === 'SESSION_EXPIRED') sessionStatus.value = 'expired'
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

function refresh(): void { if (lastQuery.value) void executeSearch({ ...lastQuery.value }, 'continue') }
function changePageSize(): void {
  if (!lastQuery.value || !canSearch.value || ![20, 50, 100].includes(pageSize.value)) return
  void executeSearch({ ...lastQuery.value, pageIndex: 1, pageSize: pageSize.value }, 'start')
}
function startBind(): void {
  const profile = bindCustomers.value.find(item => item.id === bindProfileId.value)
  if (!profile) return
  const groups = reviewCustomerBind(Object.values(selected.value), profile.id, profile.name)
  const mismatches = groups.filter(group => !group.nameMatches)
  if (mismatches.length === 0) {
    selected.value = applyConfirmedBind(selected.value, profile.id, profile.name, groups.map(group => group.sourceCustomerName))
    bindReview.value = []
    return
  }
  bindReview.value = groups
  acceptedSources.value = Object.fromEntries(groups.map(group => [group.sourceCustomerName, group.nameMatches]))
}
function confirmBindReview(): void {
  const profile = bindCustomers.value.find(item => item.id === bindProfileId.value)
  if (!profile) return
  const accepted = bindReview.value.filter(group => acceptedSources.value[group.sourceCustomerName]).map(group => group.sourceCustomerName)
  selected.value = applyConfirmedBind(selected.value, profile.id, profile.name, accepted)
  bindReview.value = []
}

async function loadBindCustomers(): Promise<void> {
  const payload = await workspace.call({ action: 'load' })
  if (!payload || payload.connection.operatorId !== queryUserId.value) {
    bindCustomers.value = []
    return
  }
  bindCustomers.value = payload.customers.map(item => ({ id: item.id, name: item.name }))
}

watch(() => workspace.connection.value.operatorId, (next, previous) => {
  if (!previous || next === previous) return
  selected.value = {}
  result.value = null
  lastQuery.value = null
  querySessionId.value = ''
  sourceNotice.value = ''
  bindProfileId.value = ''
  bindCustomers.value = []
  showMail.value = false
})

function page(delta: number): void {
  if (!lastQuery.value || !result.value || searchState.value === 'loading') return
  const next = lastQuery.value.pageIndex + delta
  if (next < 1 || next > result.value.totalPages) return
  void executeSearch({ ...lastQuery.value, pageIndex: next }, 'continue')
}

onMounted(() => { if (props.showSession) void checkSession() })
onBeforeUnmount(() => {
  generation++
  sessionGeneration++
  if (bridge) {
    void bridge.request({ type: MessageType.CancelFileSearch })
    if (props.showSession) void bridge.request({ type: MessageType.CancelSessionCheck })
  }
})
</script>

<template>
  <div class="file-search">
    <section v-if="showSession" class="card session-card" aria-label="EASY 登录状态">
      <div class="section-heading"><strong>EASY 登录状态</strong><button type="button" class="text-button" :disabled="sessionLoading" @click="checkSession">重新检测</button></div>
      <p class="session-state" role="status"><span class="status-dot" :class="{ 'status-dot-error': sessionStatus !== 'authenticated' }"></span><span>{{ sessionLabel }}</span><span v-if="sessionStatus === 'authenticated' && sessionName">{{ sessionName }}</span></p>
      <p v-if="sessionMessage" class="hint">{{ sessionMessage }}</p>
    </section>

    <QueryTemplateSection :bridge="bridge" :can-search="canSearch" :user-id="queryUserId" :origin="accountOrigin" mode="history" :manage="false" :page-size="pageSize" @search="executeSearch" />

    <section ref="resultsSection" class="card file-results" aria-label="查询结果">
      <div class="section-heading"><strong>查询结果</strong><button type="button" class="text-button" :disabled="!canSearch || !lastQuery || searchState === 'loading'" @click="refresh">刷新</button></div>
      <div v-if="lastQuery" class="result-toolbar">
        <span v-if="result">共 {{ result.total }} 个文件</span>
        <label>每页数量 <ThemeSelect v-model="pageSize" :disabled="!canSearch || searchState === 'loading'" :options="[{ value: 20, label: '20' }, { value: 50, label: '50' }, { value: 100, label: '100' }]" @change="changePageSize" /></label>
      </div>
      <p v-if="searchState === 'idle'" class="hint">输入条件后查询文件。</p>
      <p v-else-if="searchState === 'loading'" class="hint" role="status">正在查询…</p>
      <p v-else-if="searchState === 'error'" class="error" role="alert">{{ searchMessage }}</p>
      <p v-else-if="searchState === 'empty'" class="hint" role="status">没有符合条件的文件。</p>
      <template v-else-if="result">
        <p v-if="sourceNotice" class="hint" role="status">{{ sourceNotice }}</p>
        <div class="result-toolbar">
          <span>已选 {{ Object.keys(selected).length }} 个文件</span>
          <button type="button" class="text-button" @click="selected = selectPage(selected, result.items.map(file => toSelectedFile(file, undefined, querySessionId)), true)">当前页全选</button>
          <button type="button" class="text-button" @click="selected = {}">清空已选</button>
          <button type="button" class="text-button" @click="showSelected = !showSelected">查看已选</button>
          <button type="button" class="text-button" :disabled="Object.keys(selected).length === 0" @click="showMail = true">生成发文计划</button>
        </div>
        <article v-for="file in result.items" :key="file.fileId" class="file-card">
          <label class="check-line"><input type="checkbox" :checked="Boolean(selected[file.fileId])" @change="selected = toggleSelected(selected, toSelectedFile(file, selected[file.fileId]?.customerProfileId, querySessionId))" />{{ file.fileName }}</label>
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
        <section v-if="showSelected" class="card" aria-label="已选文件">
          <article v-for="file in Object.values(selected)" :key="file.fileId" class="file-card">
            <strong>{{ file.fileName }}</strong>
            <p class="hint">{{ file.fileDescription || '缺少文件描述' }} · {{ file.customerName || '缺少客户' }} · {{ file.caseVolume || '无文号' }}</p>
          </article>
          <label>绑定到已有客户配置
            <ThemeSelect v-model="bindProfileId" :options="[{ value: '', label: '选择客户配置' }, ...bindCustomers.map(item => ({ value: item.id, label: item.name }))]" @open="loadBindCustomers" />
          </label>
          <button type="button" class="text-button" :disabled="!bindProfileId" @click="startBind">绑定已选文件</button>
          <article v-for="group in bindReview" :key="group.sourceCustomerName" class="file-card">
            <p class="hint">文件客户「{{ group.sourceCustomerName || '空' }}」与配置「{{ group.profileName }}」{{ group.nameMatches ? '一致' : '不一致' }}，共 {{ group.fileIds.length }} 个文件。</p>
            <label v-if="!group.nameMatches" class="check-line"><input v-model="acceptedSources[group.sourceCustomerName]" type="checkbox" />确认仍绑定这一组</label>
          </article>
          <button v-if="bindReview.length" type="button" class="text-button" @click="confirmBindReview">确认已核对的绑定</button>
        </section>
        <MailWorkspace v-if="showMail" :bridge="bridge" :user-id="queryUserId" :page-origin="accountOrigin" :files="Object.values(selected)" />
      </template>
    </section>
  </div>
</template>
