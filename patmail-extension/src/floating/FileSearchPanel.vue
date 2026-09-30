<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { FileSearchQuery as FileSearchRequest } from '../api/file-search-params'
import type { SessionStatus } from '../api/session'
import { applyConfirmedBind, reviewCustomerBind, type SelectedPatentFile } from '../mail'
import type { BindReviewGroup } from '../mail/selection'
import MailWorkspace from './MailWorkspace.vue'
import FileSearchQuery from '../app/components/FileSearchQuery.vue'
import ThemeSelect from '../../../src/components/ThemeSelect.vue'
import EmptyGuide from '../app/components/EmptyGuide.vue'
import { MessageType, type MessageBridge } from '../shared/message'
import { useWorkspace } from '../app/composables/useWorkspace'

const props = withDefaults(defineProps<{
  pageOrigin?: string
  showSession?: boolean
  seed?: Record<string, string> | null
  seedToken?: number
}>(), { showSession: true, seed: null, seedToken: 0 })
const emit = defineEmits<{ searched: [query: FileSearchRequest] }>()
const bridge = inject<MessageBridge>('bridge')
const workspace = useWorkspace()
const accountOrigin = computed(() => props.pageOrigin || location.origin)
const sessionStatus = ref<SessionStatus>('unknown')
const sessionName = ref('')
const sessionUserId = ref('')
const sessionMessage = ref('')
const sessionLoading = ref(false)
const queryUserId = computed(() => sessionUserId.value || workspace.connection.value.operatorId)
const epoch = ref(0)
const selected = ref<Record<string, SelectedPatentFile>>({})
const showSelected = ref(false)
const showMail = ref(false)
const bindProfileId = ref('')
const bindCustomers = ref<Array<{ id: string; name: string }>>([])
const savedCustomers = computed(() => workspace.customers.value.map(item => ({ id: item.id, name: item.name })))
const bindOptions = computed(() => bindCustomers.value.length ? bindCustomers.value : savedCustomers.value)
const bindReview = ref<BindReviewGroup[]>([])
const acceptedSources = ref<Record<string, boolean>>({})
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
  return message || '请求失败，请稍后重试。'
}

async function checkSession(): Promise<void> {
  if (!bridge) {
    sessionStatus.value = 'error'
    sessionMessage.value = '页面通信不可用。'
    return
  }
  const current = ++sessionGeneration
  epoch.value += 1
  void bridge.request({ type: MessageType.CancelFileSearch })
  sessionStatus.value = 'checking'
  sessionName.value = ''
  sessionUserId.value = ''
  sessionLoading.value = true
  sessionMessage.value = ''
  selected.value = {}
  showMail.value = false
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
    if (sessionStatus.value !== 'authenticated') sessionMessage.value = '请先在 EASY 原网站登录。'
  } catch {
    if (current !== sessionGeneration) return
    sessionStatus.value = 'error'
    sessionMessage.value = '会话检测失败，请重试。'
  } finally {
    if (current === sessionGeneration) sessionLoading.value = false
  }
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
  bindProfileId.value = ''
  bindCustomers.value = []
  showMail.value = false
  epoch.value += 1
})

onMounted(() => { if (props.showSession) void checkSession() })
onBeforeUnmount(() => {
  sessionGeneration += 1
  if (bridge && props.showSession) void bridge.request({ type: MessageType.CancelSessionCheck })
})
</script>

<template>
  <div class="file-search">
    <section v-if="showSession" class="card session-card" aria-label="EASY 登录状态">
      <div class="section-heading"><strong>EASY 登录状态</strong><button type="button" class="text-button" :disabled="sessionLoading" @click="checkSession">重新检测</button></div>
      <p class="session-state" role="status"><span class="status-dot" :class="{ 'status-dot-error': sessionStatus !== 'authenticated' }"></span><span>{{ sessionLabel }}</span><span v-if="sessionStatus === 'authenticated' && sessionName">{{ sessionName }}</span></p>
      <p v-if="sessionMessage" class="hint">{{ sessionMessage }}</p>
    </section>

    <FileSearchQuery
      v-model:selected="selected"
      selectable
      :user-id="queryUserId"
      :origin="accountOrigin"
      :can-search="canSearch"
      :seed="seed"
      :seed-token="seedToken"
      :epoch="epoch"
      @searched="emit('searched', $event)"
      @plan="showMail = true"
      @review="showSelected = !showSelected"
    >
      <slot />
    </FileSearchQuery>

    <section v-if="showSelected" class="card" aria-label="已选文件">
      <article v-for="file in Object.values(selected)" :key="file.fileId" class="file-card">
        <strong>{{ file.fileName }}</strong>
        <p class="hint">{{ file.fileDescription || '缺少文件描述' }} · {{ file.customerName || '缺少客户' }} · {{ file.caseVolume || '无文号' }}</p>
      </article>
      <EmptyGuide v-if="savedCustomers.length === 0" text="还没有客户，选中的文件没法绑定。去客户管理建一个再回来。" action="去创建客户" hash="/customers" />
      <label v-else>绑定到已有客户配置
        <ThemeSelect v-model="bindProfileId" placeholder="选择客户配置" :options="bindOptions.map(item => ({ value: item.id, label: item.name }))" @open="loadBindCustomers" />
      </label>
      <button type="button" class="text-button" :disabled="!bindProfileId" @click="startBind">绑定已选文件</button>
      <article v-for="group in bindReview" :key="group.sourceCustomerName" class="file-card">
        <p class="hint">文件客户「{{ group.sourceCustomerName || '空' }}」与配置「{{ group.profileName }}」{{ group.nameMatches ? '一致' : '不一致' }}，共 {{ group.fileIds.length }} 个文件。</p>
        <label v-if="!group.nameMatches" class="check-line"><input v-model="acceptedSources[group.sourceCustomerName]" type="checkbox" />确认仍绑定这一组</label>
      </article>
      <button v-if="bindReview.length" type="button" class="text-button" @click="confirmBindReview">确认已核对的绑定</button>
    </section>
    <MailWorkspace v-if="showMail" :bridge="bridge" :user-id="queryUserId" :page-origin="accountOrigin" :files="Object.values(selected)" />
  </div>
</template>
