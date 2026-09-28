<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import PageHead from '../../../../src/components/PageHead.vue'
import ThemeSelect from '../../../../src/components/ThemeSelect.vue'
import { bg } from '../../../../src/assets'
import { fieldLabel } from '../../query/field-registry'
import { isQueryGuid } from '../../query/query-validator'
import { clonePctTask } from '../../customer/pct-sheet'
import {
  PENDING_CUSTOMER_KEY,
  QUERY_SURFACES,
  customerMailStyleLabel,
  isFileMailStyle,
  isLimitMailStyle,
  mailStylesFor,
  querySurfaceOf,
  summarizeBoundQuery,
  WORKFLOWS,
  matchPctMailTypes,
  workflowsFor
} from '../../customer/mail-flow'
import { fetchMailTypeNodes } from '../../customer/mail-type-load'
import type { MessageBridge } from '../../shared/message'
import type { FileMailStyle, LimitMailStyle, QuerySurfaceId, WorkflowId } from '../../customer/types'
import { scopeFromConnection, type ExpectedAccountScope } from '../../shared/connection'
import { useWorkspace } from '../composables/useWorkspace'

const bridge = inject<MessageBridge>('bridge')
const { connection, customers, call } = useWorkspace()
const mailNodes = ref<Array<{ id: string; name: string }>>([])
const mailTypeMessage = ref('正在从原网站读取发文类型…')
const mailMatch = computed(() => matchPctMailTypes(mailNodes.value))
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const name = ref('')
const surface = ref<QuerySurfaceId | ''>('')
const workflow = ref<WorkflowId | ''>('')
const mailStyle = ref('')
const reviewChoice = ref('self')
const enabled = ref(true)
const editingId = ref('')
const createdAt = ref('')
const keptCustomerId = ref('')
const formMessage = ref('')
const formScope = ref<ExpectedAccountScope | null>(null)
const formRevision = ref(1)
const listMessage = ref('')
const removingId = ref('')

const surfaceOptions = computed(() => [
  { value: '', label: '请选择查询入口' },
  ...QUERY_SURFACES.map(item => ({ value: item.id, label: item.label }))
])
const stylePlaceholder = computed(() => surface.value ? '请选择发文模式' : '先选择查询入口')
const workflowChoices = computed(() => workflowsFor(surface.value).map(item => ({ value: item.id, label: item.label })))
const activeWorkflow = computed(() => WORKFLOWS.find(item => item.id === workflow.value) ?? null)

function describe(item: { boundQuery?: Record<string, string>; overrides: Record<string, string> }): string {
  if (item.boundQuery && Object.keys(item.boundQuery).length) return summarizeBoundQuery(item.boundQuery)
  const parts = Object.entries(item.overrides)
    .filter(([, value]) => value.trim())
    .slice(0, 3)
    .map(([key, value]) => `${fieldLabel(key)}：${isQueryGuid(value) ? '已选择' : value}`)
  return parts.length ? parts.join('，') : '还没绑定'
}

function edit(id: string): void {
  const profile = customers.value.find(item => item.id === id)
  if (!profile) return
  editingId.value = profile.id
  name.value = profile.name
  surface.value = profile.querySurface ?? 'file'
  workflow.value = profile.workflowId ?? (surface.value === 'limit' ? 'pct-reminder' : '')
  mailStyle.value = (surface.value === 'limit' ? profile.limitMailStyle : profile.fileMailStyle) ?? ''
  reviewChoice.value = profile.reviewTarget ?? 'self'
  enabled.value = profile.enabled
  createdAt.value = profile.createdAt
  keptCustomerId.value = profile.easyCustomerId && isQueryGuid(profile.easyCustomerId) ? profile.easyCustomerId : ''
  formScope.value = scopeFromConnection(connection.value)
  formRevision.value = profile.revision ?? 1
  formMessage.value = ''
}

function cancel(): void {
  editingId.value = ''
  name.value = ''
  surface.value = ''
  workflow.value = ''
  mailStyle.value = ''
  reviewChoice.value = 'self'
  enabled.value = true
  createdAt.value = ''
  keptCustomerId.value = ''
  formScope.value = null
  formMessage.value = ''
}

async function remove(id: string): Promise<void> {
  const profile = customers.value.find(item => item.id === id)
  if (!profile || removingId.value) return
  if (!window.confirm(`删除客户「${profile.name}」？绑定的查询条件和 PCT 任务会一起删掉。`)) return
  const scope = scopeFromConnection(connection.value)
  if (!scope) {
    listMessage.value = '还没确认当前登录的人，没有删除。'
    return
  }
  removingId.value = id
  listMessage.value = ''
  const result = await call({
    action: 'deleteCustomer',
    id: profile.id,
    expectedScope: scope,
    expectedRevision: profile.revision ?? 1
  })
  removingId.value = ''
  if (!result?.ok) {
    listMessage.value = result?.message || '客户没有删除。'
    return
  }
  if (editingId.value === id) cancel()
  if (sessionStorage.getItem(PENDING_CUSTOMER_KEY) === id) sessionStorage.removeItem(PENDING_CUSTOMER_KEY)
  listMessage.value = `已删除${profile.name}。`
}

function openQuery(id: string, surfaceId: QuerySurfaceId | undefined): void {
  sessionStorage.setItem(PENDING_CUSTOMER_KEY, id)
  location.hash = querySurfaceOf(surfaceId).hash
}

async function save(goAfter: boolean): Promise<void> {
  formMessage.value = ''
  if (!name.value.trim()) { formMessage.value = '请先填写客户名称。'; return }
  if (!surface.value) { formMessage.value = '请选择查询入口。'; return }
  if (surface.value === 'limit' && workflow.value !== 'pct-reminder') { formMessage.value = '请选择工作流。'; return }
  const styleMatches = surface.value === 'file' ? isFileMailStyle(mailStyle.value) : isLimitMailStyle(mailStyle.value)
  if (!styleMatches) { formMessage.value = '请选择这个查询入口对应的发文模式。'; return }
  const existing = editingId.value ? customers.value.find(item => item.id === editingId.value) : null
  const scope = editingId.value ? formScope.value : scopeFromConnection(connection.value)
  if (!scope) { formMessage.value = '还没确认当前登录的人，没有保存。'; return }
  const id = editingId.value || `customer-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const sameSurface = !existing || (existing.querySurface ?? 'file') === surface.value
  const result = await call({
    action: 'saveCustomer',
    profile: {
      id,
      name: name.value.trim(),
      ...(keptCustomerId.value ? { easyCustomerId: keptCustomerId.value } : {}),
      baseTemplateId: sameSurface ? (existing?.baseTemplateId || 'manual') : 'manual',
      overrides: sameSurface ? (existing?.overrides ?? {}) : {},
      ...(sameSurface && existing?.boundQuery ? { boundQuery: existing.boundQuery } : {}),
      ...(sameSurface && surface.value === 'limit' && workflow.value === 'pct-reminder' && existing?.pctTask ? { pctTask: clonePctTask(existing.pctTask) } : {}),
      querySurface: surface.value,
      ...(surface.value === 'limit' && workflow.value ? { workflowId: workflow.value } : {}),
      ...(surface.value === 'limit' ? { limitMailStyle: mailStyle.value as LimitMailStyle } : {}),
      ...(surface.value === 'file' ? { fileMailStyle: mailStyle.value as FileMailStyle } : {}),
      ...(surface.value === 'limit' && reviewChoice.value === 'self' ? { reviewTarget: 'self' as const } : {}),
      enabled: enabled.value,
      createdAt: createdAt.value || now,
      updatedAt: now,
      ...(editingId.value ? { revision: formRevision.value } : {})
    },
    expectedScope: scope,
    ...(editingId.value ? { expectedRevision: formRevision.value } : {})
  })
  if (!result?.ok) {
    formMessage.value = result?.message || '客户没有保存。'
    return
  }
  if (goAfter) {
    const target = surface.value
    cancel()
    openQuery(id, target)
    return
  }
  cancel()
  formMessage.value = '客户已保存。查询条件要到对应的查询页里填写，再绑定回来。'
}

async function loadMailTypes(force: boolean): Promise<void> {
  if (!bridge || !ready.value) {
    mailNodes.value = []
    mailTypeMessage.value = '还没确认当前登录的人，发文类型还没读取。'
    return
  }
  mailTypeMessage.value = '正在从原网站读取发文类型…'
  const loaded = await fetchMailTypeNodes(bridge, force)
  mailNodes.value = loaded.nodes
  mailTypeMessage.value = loaded.message
}

watch(surface, (next) => {
  const flows = workflowsFor(next)
  if (!flows.some(item => item.id === workflow.value)) workflow.value = flows[0]?.id ?? ''
  if (!mailStylesFor(next).some(item => item.value === mailStyle.value)) mailStyle.value = ''
})
watch([workflow, ready], () => {
  if (workflow.value === 'pct-reminder' && ready.value) void loadMailTypes(false)
}, { immediate: true })
watch(() => connection.value.operatorId, () => {
  if (!editingId.value && !name.value) return
  cancel()
  formMessage.value = '登录的账号变了，没保存的内容已清掉。'
})
</script>

<template>
  <PageHead title="客户管理" desc="先记下客户和查询入口。具体条件到对应的查询页里填写，再绑定回来。" :art="bg('靠近成功的一步.png')" />
  <section v-if="!ready" class="card"><p class="empty">还没确认当前登录的人，暂时不能保存客户。</p></section>
  <template v-else>
    <section class="card">
      <h2>已保存的客户</h2>
      <p class="hint">期限监控先选工作流。PCT提醒是第一条，表格能决定的项按列走，发文模式和审核在这里选。</p>
      <p v-if="listMessage" class="hint">{{ listMessage }}</p>
      <p v-if="customers.length === 0" class="empty">还没有客户。在下面填好名称后保存。</p>
      <table v-else class="grid">
        <thead><tr><th>客户</th><th>查询入口</th><th>工作流</th><th>发文模式</th><th>已绑定条件</th><th>状态</th><th></th></tr></thead>
        <tbody>
          <tr v-for="item in customers" :key="item.id">
            <td>{{ item.name }}</td>
            <td>{{ querySurfaceOf(item.querySurface).label }}</td>
            <td>{{ WORKFLOWS.find(flow => flow.id === item.workflowId)?.label ?? '—' }}</td>
            <td>{{ customerMailStyleLabel(item) }}</td>
            <td>{{ describe(item) }}</td>
            <td>{{ item.enabled ? '启用中' : '已停用' }}</td>
            <td>
              <button type="button" class="ghost" @click="openQuery(item.id, item.querySurface)">前往查询</button>
              <button type="button" class="ghost" @click="edit(item.id)">修改</button>
              <button type="button" class="ghost" :disabled="removingId === item.id" @click="remove(item.id)">{{ removingId === item.id ? '正在删除…' : '删除' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <form class="card" @submit.prevent="save(false)">
      <h2>{{ editingId ? '修改客户' : '添加客户' }}</h2>
      <div class="stack-form">
        <label>客户名称 <input v-model="name" type="text" maxlength="80" /></label>
        <label>查询入口
          <ThemeSelect :model-value="surface" :options="surfaceOptions" @update:model-value="surface = $event as QuerySurfaceId | ''" />
        </label>
        <label v-if="workflowChoices.length">工作流
          <ThemeSelect :model-value="workflow" :options="workflowChoices" @update:model-value="workflow = String($event) as WorkflowId" />
        </label>
        <template v-if="activeWorkflow">
          <p class="hint">{{ activeWorkflow.label }}是第一条封装工作流。表格能决定的项按列走，这里选择表格决定不了的模式。</p>
          <template v-for="mode in activeWorkflow.modes" :key="mode.id">
            <label v-if="mode.id === 'mail_style'">{{ mode.label }}
              <ThemeSelect :model-value="mailStyle" :placeholder="stylePlaceholder" :options="mode.options ?? []" @update:model-value="mailStyle = String($event)" />
            </label>
            <label v-else-if="mode.id === 'review'">{{ mode.label }}
              <ThemeSelect :model-value="reviewChoice" :options="mode.options ?? []" @update:model-value="reviewChoice = String($event)" />
            </label>
            <div v-else-if="mode.id === 'volume'" class="hint">
              <p><strong>{{ mode.label }}</strong>：{{ mode.decidedBy }}</p>
              <p v-if="mailTypeMessage">{{ mailTypeMessage }}</p>
              <template v-else>
                <p>有客户文号：{{ mailMatch.customerVolume?.name || '原网站这次没有返回这一项' }}</p>
                <p v-if="mailMatch.ourVolumeOtherCity">{{ mailMatch.ourVolumeOtherCity.name }}</p>
                <p>只有我方文号：{{ mailMatch.ourVolumeShenzhen?.name || '原网站这次没有返回这一项' }}</p>
              </template>
              <button type="button" class="text-button" @click="loadMailTypes(true)">重新读取发文类型</button>
            </div>
            <p v-else class="hint"><strong>{{ mode.label }}</strong>：{{ mode.decidedBy }}</p>
          </template>
        </template>
        <label v-else-if="surface === 'file'">发文模式
          <ThemeSelect :model-value="mailStyle" :placeholder="stylePlaceholder" :options="mailStylesFor(surface)" @update:model-value="mailStyle = String($event)" />
        </label>
        <p v-else-if="!surface" class="hint">先选查询入口。期限监控会带出已封装的工作流。</p>
        <label class="check-line"><input v-model="enabled" type="checkbox" />以后发文时可以使用这位客户</label>
      </div>
      <p v-if="formMessage" class="hint">{{ formMessage }}</p>
      <div class="filters">
        <button class="solid" type="submit">保存</button>
        <button class="solid" type="button" @click="save(true)">保存并前往查询</button>
        <button v-if="editingId" class="ghost" type="button" @click="cancel">取消</button>
      </div>
    </form>
  </template>
</template>
