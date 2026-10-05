<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import PageHead from '../../../../src/components/PageHead.vue'
import ThemeSelect from '../../../../src/components/ThemeSelect.vue'
import { bg } from '../../../../src/assets'
import { fieldLabel } from '../../query/field-registry'
import { CASE_CONTACT_CUSTOMER_NAME, caseContactSkills, hasCaseContactSkill, rememberCaseContactCustomer, unlocksCaseContacts } from '../../customer/skills'
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
import { fetchCustomerList } from '../../customer/customer-list-load'
import type { EasyCustomerOption } from '../../customer/customer-list'
import { fetchMailTypeNodes } from '../../customer/mail-type-load'
import { fetchMailSenders } from '../../customer/mailset-load'
import type { MailSender } from '../../customer/mailset'
import { MessageType, type MessageBridge } from '../../shared/message'
import type { FileMailStyle, LimitMailStyle, QuerySurfaceId, WorkflowId } from '../../customer/types'
import { scopeFromConnection, type ExpectedAccountScope } from '../../shared/connection'
import { isRunnableWorkflow, packagedPctWorkflow, pctRuntimeFrom, workflowSender } from '../../workflow/catalog'
import { confirmDialog } from '../dialog'
import { useWorkflowCatalog } from '../composables/useWorkflowCatalog'
import { useWorkspace } from '../composables/useWorkspace'

const bridge = inject<MessageBridge>('bridge')
const demandText = ref('')
const demandMessage = ref('')
const demandLoading = ref(false)
const { connection, customers, rules, call } = useWorkspace()
const contactCustomers = computed(() => customers.value.filter(hasCaseContactSkill))
const { catalog } = useWorkflowCatalog()
const mailNodes = ref<Array<{ id: string; name: string }>>([])
const mailTypeMessage = ref('正在从原网站读取发文类型…')
const mailsets = ref<MailSender[]>([])
const mailsetId = ref('')
const senderTouched = ref(false)
const mailsetMessage = ref('正在从原网站读取发件邮箱…')
const mailsetOptions = computed(() => {
  const items = mailsets.value.map(item => ({ value: item.id, label: item.label }))
  if (mailsetId.value && !items.some(item => item.value === mailsetId.value)) {
    const fromCustomer = customers.value.find(item => item.mailsetId === mailsetId.value)?.mailsetLabel
    const fromWorkflow = workflowSender(catalog.value.workflows.find(item => item.id === 'pct-reminder'))
    const saved = fromCustomer || (fromWorkflow?.id === mailsetId.value ? fromWorkflow.label : '')
    items.unshift({ value: mailsetId.value, label: saved || '已保存的发件邮箱' })
  }
  return items
})
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const customerCatalog = ref<EasyCustomerOption[]>([])
const customerPick = ref('')
const customerListMessage = ref('正在从原网站读取客户…')
const name = ref('')
const surface = ref<QuerySurfaceId | ''>('')
const workflow = ref<WorkflowId | ''>('')
const mailStyle = ref('')
const workflowRemark = ref('')
const reviewChoice = ref('')
const reviewers = ref<Array<{ id: string; name: string }>>([])
const reviewerMessage = ref('')
const enabled = ref(true)
const editingId = ref('')
const createdAt = ref('')
const keptCustomerId = ref('')
const formMessage = ref('')
const formScope = ref<ExpectedAccountScope | null>(null)
const formRevision = ref(1)
const listMessage = ref('')
const removingId = ref('')

const surfaceOptions = computed(() => QUERY_SURFACES.map(item => ({ value: item.id, label: item.label })))
const customerOptions = computed(() => {
  const items = customerCatalog.value.map(item => ({ value: item.id, label: item.name }))
  if (customerPick.value && !items.some(item => item.value.toLowerCase() === customerPick.value.toLowerCase())) {
    items.unshift({ value: customerPick.value, label: name.value.trim() || '已保存的客户' })
  }
  return items
})
const stylePlaceholder = computed(() => surface.value ? '请选择发文模式' : '先选择查询入口')
const pctDefinition = computed(() => catalog.value.workflows.find(item => item.id === 'pct-reminder') ?? null)
const pctRuntime = computed(() => pctRuntimeFrom(pctDefinition.value))
const workflowMailbox = computed(() => workflowSender(pctDefinition.value))
const defaultSender = computed(() => {
  const flow = workflowMailbox.value
  if (flow) return { id: flow.id, label: flow.label }
  const saved = rules.value?.defaultSender
  if (saved?.mailsetId) return { id: saved.mailsetId, label: saved.label }
  return null
})
const defaultStyle = computed(() => surface.value === 'file' ? 'merge_by_customer_description' : '1')
const pctName = computed(() => pctDefinition.value?.label || 'PCT提醒')
const mailMatch = computed(() => matchPctMailTypes(mailNodes.value, pctRuntime.value))

watch(workflowMailbox, (sender) => {
  if (editingId.value || senderTouched.value || mailsetId.value || !sender) return
  mailsetId.value = sender.id
})

function chooseCustomer(value: string): void {
  customerPick.value = value
  const found = customerCatalog.value.find(item => item.id.toLowerCase() === value.toLowerCase())
  if (!found) return
  name.value = found.name
  keptCustomerId.value = found.id
}

function alignCustomerPick(): void {
  if (!name.value.trim() && !customerPick.value) return
  const byId = customerCatalog.value.find(item => item.id.toLowerCase() === customerPick.value.toLowerCase())
  if (byId) {
    chooseCustomer(byId.id)
    return
  }
  if (!isQueryGuid(customerPick.value)) {
    const matches = customerCatalog.value.filter(item => item.name === name.value.trim())
    if (matches.length === 1) chooseCustomer(matches[0].id)
  }
}

let customerListTicket = 0
async function loadCustomerList(force: boolean): Promise<void> {
  if (!bridge || !ready.value) {
    customerListMessage.value = '还没确认当前登录的人，客户名单还没读取。'
    return
  }
  const ticket = ++customerListTicket
  customerListMessage.value = '正在从原网站读取客户…'
  const loaded = await fetchCustomerList(bridge, force)
  if (ticket !== customerListTicket) return
  if (!loaded.ok) {
    customerListMessage.value = loaded.message
    return
  }
  customerCatalog.value = loaded.customers
  customerListMessage.value = loaded.message
  alignCustomerPick()
}

function chooseSender(value: string): void {
  senderTouched.value = true
  mailsetId.value = value
}
function useDefaultSender(): void {
  const next = defaultSender.value
  if (!next) {
    formMessage.value = '还没有默认发件人。到发文映射里设一个，或在工作流里选好邮箱。'
    return
  }
  senderTouched.value = false
  mailsetId.value = next.id
  formMessage.value = ''
}
function useDefaultStyle(): void {
  mailStyle.value = defaultStyle.value
}
function samePerson(id: string): boolean {
  const operator = connection.value.operatorId
  return Boolean(operator) && id.toLowerCase() === operator.toLowerCase()
}
function reviewerLabel(item: { id: string; name: string }): string {
  return samePerson(item.id) ? `${item.name}（当前账号）` : item.name
}
const reviewerOptions = computed(() => {
  const items = reviewers.value.map(item => ({ value: item.id, label: reviewerLabel(item) }))
  if (reviewChoice.value && !items.some(item => item.value.toLowerCase() === reviewChoice.value.toLowerCase())) {
    const saved = customers.value.find(item => item.reviewerId?.toLowerCase() === reviewChoice.value.toLowerCase())
    items.unshift({ value: reviewChoice.value, label: saved?.reviewerName || '已保存的审核人' })
  }
  return items
})
const pickedReviewerName = computed(() => reviewers.value.find(item => item.id.toLowerCase() === reviewChoice.value.toLowerCase())?.name
  || customers.value.find(item => item.reviewerId?.toLowerCase() === reviewChoice.value.toLowerCase())?.reviewerName
  || '')
function useDefaultReview(): void {
  const self = reviewers.value.find(item => samePerson(item.id))
  if (!self) {
    formMessage.value = '人员名单里还没有当前登录人。点重新读取审核人。'
    return
  }
  reviewChoice.value = self.id
  formMessage.value = ''
}
async function loadReviewers(force: boolean): Promise<void> {
  if (!bridge || !ready.value) return
  reviewerMessage.value = '正在读取审核人…'
  const response = await bridge.request({ type: MessageType.LoadDictionary, payload: { kind: 'reviewer', force } })
  if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'reviewer') {
    reviewers.value = []
    reviewerMessage.value = response.type === MessageType.DictionaryResult && !response.payload.ok
      ? response.payload.error.message
      : '审核人没有读到。'
    return
  }
  reviewers.value = response.payload.data.reviewers
  reviewerMessage.value = reviewers.value.length ? '' : '原网站没有返回审核人。'
  if (!reviewChoice.value) {
    const self = reviewers.value.find(item => samePerson(item.id))
    if (self) reviewChoice.value = self.id
  }
}
function writeRemark(id: string): void {
  edit(id)
  formMessage.value = '在下面的备注里写一句，再点保存。同一客户有多条工作流时靠这句分辨。'
}
const workflowChoices = computed(() => workflowsFor(surface.value).map(item => ({
  value: item.id,
  label: item.id === 'pct-reminder' ? pctName.value : item.label
})))
const activeWorkflow = computed(() => {
  const picked = catalog.value.workflows.find(item => item.id === workflow.value)
  if (picked && isRunnableWorkflow(picked)) return packagedPctWorkflow(picked)
  return WORKFLOWS.find(item => item.id === workflow.value) ?? null
})

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
  const savedId = profile.easyCustomerId && isQueryGuid(profile.easyCustomerId) ? profile.easyCustomerId : ''
  const listed = savedId ? customerCatalog.value.find(item => item.id.toLowerCase() === savedId.toLowerCase()) : undefined
  const named = !listed && !savedId ? customerCatalog.value.filter(item => item.name === profile.name.trim()) : []
  if (listed) {
    customerPick.value = listed.id
    name.value = listed.name
  } else if (named.length === 1) {
    customerPick.value = named[0].id
    name.value = named[0].name
  } else {
    customerPick.value = savedId || `saved:${profile.id}`
  }
  surface.value = profile.querySurface ?? 'file'
  workflow.value = profile.workflowId ?? (surface.value === 'limit' ? 'pct-reminder' : '')
  mailStyle.value = (surface.value === 'limit' ? profile.limitMailStyle : profile.fileMailStyle) ?? ''
  workflowRemark.value = profile.workflowRemark ?? ''
  reviewChoice.value = profile.reviewerId || (profile.reviewTarget === 'self' ? connection.value.operatorId : '') || connection.value.operatorId
  senderTouched.value = true
  mailsetId.value = profile.mailsetId ?? ''
  enabled.value = profile.enabled
  createdAt.value = profile.createdAt
  keptCustomerId.value = listed?.id || (named.length === 1 ? named[0].id : '') || savedId
  demandText.value = ''
  demandMessage.value = ''
  formScope.value = scopeFromConnection(connection.value)
  formRevision.value = profile.revision ?? 1
  formMessage.value = ''
}

function saveAnother(): void {
  if (!workflowRemark.value.trim()) {
    formMessage.value = '同一客户再存一条时，先写备注，发文任务里才能分辨。'
    return
  }
  editingId.value = ''
  createdAt.value = ''
  formRevision.value = 0
  void save(false)
}

async function loadDemands(): Promise<void> {
  if (!bridge || !isQueryGuid(keptCustomerId.value)) {
    demandMessage.value = '这位客户还没有原网站客户编号，读不了客户要求。'
    demandText.value = ''
    return
  }
  demandLoading.value = true
  demandMessage.value = ''
  demandText.value = ''
  try {
    const response = await bridge.request({ type: MessageType.ReadCustomerDemands, payload: { customerId: keptCustomerId.value } })
    if (response.type !== MessageType.CustomerDemandResult) {
      demandMessage.value = response.type === MessageType.Error ? response.payload.message : '客户要求没有读到。'
      return
    }
    if (!response.payload.ok) {
      demandMessage.value = response.payload.error.message
      return
    }
    demandText.value = response.payload.data.text
    demandMessage.value = response.payload.data.complete
      ? (response.payload.data.rows.length ? '已按客户资料页读到要求，没有改原网站上的内容。' : '这个客户的要求表是空的。')
      : (response.payload.data.message || '要求表没有读全。下面只是已经读到的部分。')
  } finally {
    demandLoading.value = false
  }
}

function cancel(): void {
  editingId.value = ''
  name.value = ''
  customerPick.value = ''
  surface.value = ''
  workflow.value = ''
  workflowRemark.value = ''
  mailStyle.value = ''
  reviewChoice.value = connection.value.operatorId || ''
  senderTouched.value = false
  mailsetId.value = workflowMailbox.value?.id ?? ''
  enabled.value = true
  createdAt.value = ''
  keptCustomerId.value = ''
  demandText.value = ''
  demandMessage.value = ''
  formScope.value = null
  formMessage.value = ''
}

async function remove(id: string): Promise<void> {
  const profile = customers.value.find(item => item.id === id)
  if (!profile || removingId.value) return
  const agreed = await confirmDialog({
    title: '删除客户',
    message: `删除客户「${profile.name}」？绑定的查询条件和 PCT 任务会一起删掉。`,
    confirmLabel: '删除'
  })
  if (!agreed) return
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

function openContacts(id: string): void {
  rememberCaseContactCustomer(id)
  location.hash = '/contacts'
}

async function save(goAfter: boolean): Promise<void> {
  formMessage.value = ''
  const selected = customerCatalog.value.find(item => item.id.toLowerCase() === customerPick.value.toLowerCase())
  if (selected) {
    name.value = selected.name
    keptCustomerId.value = selected.id
  } else if (!editingId.value || !name.value.trim()) {
    formMessage.value = '请从客户名单里选择客户。'
    return
  }
  if (!name.value.trim()) { formMessage.value = '请从客户名单里选择客户。'; return }
  if (!surface.value) { formMessage.value = '请选择查询入口。'; return }
  if (surface.value === 'limit' && workflow.value !== 'pct-reminder' && workflow.value !== 'pct-pengcheng') { formMessage.value = '请选择工作流。'; return }
  const styleMatches = surface.value === 'file' ? isFileMailStyle(mailStyle.value) : isLimitMailStyle(mailStyle.value)
  if (!styleMatches) { formMessage.value = '请选择这个查询入口对应的发文模式。'; return }
  const remark = workflowRemark.value.trim().slice(0, 40)
  const twin = customers.value.find(item => item.id !== editingId.value && item.name.trim() === name.value.trim() && (item.workflowId ?? '') === (workflow.value || '') && (item.workflowRemark ?? '') === remark)
  if (twin) { formMessage.value = '已经有一条一样的客户、工作流和备注。换一句备注再存。'; return }
  const existing = editingId.value ? customers.value.find(item => item.id === editingId.value) : null
  const skills = caseContactSkills(name.value)
  const scope = editingId.value ? formScope.value : scopeFromConnection(connection.value)
  if (!scope) { formMessage.value = '还没确认当前登录的人，没有保存。'; return }
  const pickedSender = mailsets.value.find(item => item.id === mailsetId.value)
    ?? (existing?.mailsetId === mailsetId.value && existing.mailsetLabel ? { id: existing.mailsetId, label: existing.mailsetLabel } : null)
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
      ...(sameSurface && surface.value === 'limit' && (workflow.value === 'pct-reminder' || workflow.value === 'pct-pengcheng') && existing?.pctTask && (existing.workflowId ?? 'pct-reminder') === workflow.value ? { pctTask: clonePctTask(existing.pctTask) } : {}),
      querySurface: surface.value,
      ...(surface.value === 'limit' && workflow.value ? { workflowId: workflow.value } : {}),
      ...(remark ? { workflowRemark: remark } : {}),
      ...(surface.value === 'limit' ? { limitMailStyle: mailStyle.value as LimitMailStyle } : {}),
      ...(surface.value === 'file' ? { fileMailStyle: mailStyle.value as FileMailStyle } : {}),
      ...(surface.value === 'limit' && isQueryGuid(reviewChoice.value) && pickedReviewerName.value ? {
        reviewerId: reviewChoice.value,
        reviewerName: pickedReviewerName.value,
        ...(samePerson(reviewChoice.value) ? { reviewTarget: 'self' as const } : {})
      } : {}),
      ...(pickedSender ? { mailsetId: pickedSender.id, mailsetLabel: pickedSender.label } : {}),
      ...(skills ? { skills } : {}),
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
async function loadMailSets(force: boolean): Promise<void> {
  if (!bridge || !ready.value) {
    mailsets.value = []
    mailsetMessage.value = '还没确认当前登录的人，发件邮箱还没读取。'
    return
  }
  mailsetMessage.value = '正在从原网站读取发件邮箱…'
  const loaded = await fetchMailSenders(bridge, force)
  mailsets.value = loaded.items
  mailsetMessage.value = loaded.message
}

watch([workflow, ready], () => {
  if (workflow.value === 'pct-reminder' && ready.value) {
    void loadMailTypes(false)
    void loadMailSets(false)
    void loadReviewers(false)
  }
}, { immediate: true })
watch(ready, (value) => {
  if (value) void loadCustomerList(false)
}, { immediate: true })
watch(() => connection.value.operatorId, () => {
  customerCatalog.value = []
  void loadCustomerList(false)
  if (!editingId.value && !name.value && !customerPick.value) return
  cancel()
  formMessage.value = '登录的账号变了，没保存的内容已清掉。'
})
</script>

<template>
  <PageHead title="客户管理" desc="先记下客户和查询入口。具体条件到对应的查询页里填写，再绑定回来。" :art="bg('靠近成功的一步.png')" />
  <section v-for="item in contactCustomers" :key="item.id" class="card pcl-card">
    <h2>{{ item.name }}</h2>
    <p class="hint">创建这家客户后已打开。按客户案号导出技术负责人和第一发明人邮箱。</p>
    <button type="button" class="solid" @click="openContacts(item.id)">导出联系人</button>
  </section>
  <section v-if="!ready" class="card"><p class="empty">还没确认当前登录的人，暂时不能保存客户。</p></section>
  <template v-else>
    <section class="card">
      <h2>已保存的客户</h2>
      <p class="hint">点「绑定查询」到查询页填好条件再绑定回来。点「写备注」在下面写一句，用来区分同一客户的多条工作流。</p>
      <p v-if="listMessage" class="hint">{{ listMessage }}</p>
      <p v-if="customers.length === 0" class="empty">还没有客户。在下面选好名称后保存。</p>
      <table v-else class="grid">
        <thead><tr><th>客户</th><th>查询入口</th><th>工作流</th><th>备注</th><th>发文模式</th><th>记住的查询</th><th>状态</th><th></th></tr></thead>
        <tbody>
          <tr v-for="item in customers" :key="item.id">
            <td>{{ item.name }}</td>
            <td>{{ querySurfaceOf(item.querySurface).label }}</td>
            <td>{{ item.workflowId === 'pct-reminder' ? pctName : (WORKFLOWS.find(flow => flow.id === item.workflowId)?.label ?? '—') }}</td>
            <td>{{ item.workflowRemark || '—' }}</td>
            <td>{{ customerMailStyleLabel(item) }}</td>
            <td :title="describe(item)">{{ describe(item) }}</td>
            <td>{{ item.enabled ? '启用中' : '已停用' }}</td>
            <td>
              <button type="button" class="ghost" @click="openQuery(item.id, item.querySurface)">绑定查询</button>
              <button type="button" class="ghost" @click="writeRemark(item.id)">写备注</button>
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
        <label>客户名称
          <ThemeSelect :model-value="customerPick" placeholder="请选择客户" empty-text="客户名单还没读到。点下面的重新读取。" :options="customerOptions" @update:model-value="chooseCustomer(String($event))" />
        </label>
        <p v-if="customerListMessage" class="hint">{{ customerListMessage }}</p>
        <button type="button" class="text-button" @click="loadCustomerList(true)">重新读取客户</button>
        <p v-if="unlocksCaseContacts(name)" class="hint">保存「{{ CASE_CONTACT_CUSTOMER_NAME }}」后，会打开导出联系人。改成别的名字就会关掉。</p>
        <label>查询入口
          <ThemeSelect :model-value="surface" placeholder="请选择查询入口" :options="surfaceOptions" @update:model-value="surface = $event as QuerySurfaceId | ''" />
        </label>
        <label v-if="workflowChoices.length">工作流
          <ThemeSelect :model-value="workflow" :options="workflowChoices" @update:model-value="workflow = String($event) as WorkflowId" />
        </label>
        <label v-if="workflow">备注
          <input v-model="workflowRemark" type="text" maxlength="40" placeholder="同一客户有多条时写一句，方便分辨" />
        </label>
        <template v-if="activeWorkflow">
          <p class="hint">{{ activeWorkflow.label }}里，表格能决定的项按列走。这里选择表格决定不了的模式。</p>
          <template v-for="mode in activeWorkflow.modes" :key="mode.id">
            <div v-if="mode.id === 'mail_style'">
              <label>{{ mode.label }}
                <ThemeSelect :model-value="mailStyle" :placeholder="stylePlaceholder" :options="mode.options ?? []" @update:model-value="mailStyle = String($event)" />
              </label>
              <button type="button" class="text-button" @click="useDefaultStyle">使用默认</button>
              <p v-if="mailStyle === defaultStyle" class="hint">当前就是默认：同客户合并发文。</p>
            </div>
            <div v-else-if="mode.id === 'review'">
              <label>审核
                <ThemeSelect :model-value="reviewChoice" placeholder="选择审核人" empty-text="审核人还没读到。点下面的重新读取。" :options="reviewerOptions" @update:model-value="reviewChoice = String($event)" />
              </label>
              <button type="button" class="text-button" @click="useDefaultReview">使用默认</button>
              <p v-if="pickedReviewerName && samePerson(reviewChoice)" class="hint">当前就是默认：{{ pickedReviewerName }}（当前账号）</p>
              <p v-if="reviewerMessage" class="hint">{{ reviewerMessage }}</p>
              <button type="button" class="text-button" @click="loadReviewers(true)">重新读取审核人</button>
            </div>
            <div v-else-if="mode.id === 'from'">
              <label>{{ mode.label }}
                <ThemeSelect :model-value="mailsetId" placeholder="选择发件邮箱" empty-text="发件邮箱还没读到。点下面的重新读取。" :options="mailsetOptions" @update:model-value="chooseSender(String($event))" />
              </label>
              <button type="button" class="text-button" @click="useDefaultSender">使用默认</button>
              <p v-if="defaultSender && mailsetId === defaultSender.id" class="hint">当前就是默认：{{ defaultSender.label }}</p>
              <p v-if="mailsetMessage" class="hint">{{ mailsetMessage }}</p>
              <button type="button" class="text-button" @click="loadMailSets(true)">重新读取发件邮箱</button>
            </div>
            <div v-else-if="mode.id === 'volume'" class="hint">
              <p><strong>{{ mode.label }}</strong>：{{ mode.decidedBy }}</p>
              <p v-if="mailTypeMessage">{{ mailTypeMessage }}</p>
              <template v-else>
                <p>有客户文号：{{ mailMatch.customerVolume?.name || pctRuntime.customerTypeName || '这次没有对上' }}</p>
                <p>只有我方文号：{{ mailMatch.ourVolumeShenzhen?.name || pctRuntime.ourTypeName || '这次没有对上' }}</p>
              </template>
              <button type="button" class="text-button" @click="loadMailTypes(true)">重新读取发文类型</button>
            </div>
            <p v-else class="hint"><strong>{{ mode.label }}</strong>：{{ mode.decidedBy }}</p>
          </template>
        </template>
        <div v-else-if="surface === 'file'">
          <label>发文模式
            <ThemeSelect :model-value="mailStyle" :placeholder="stylePlaceholder" :options="mailStylesFor(surface)" @update:model-value="mailStyle = String($event)" />
          </label>
          <button type="button" class="text-button" @click="useDefaultStyle">使用默认</button>
          <p v-if="mailStyle === defaultStyle" class="hint">当前就是默认：同客户合并发文。</p>
        </div>
        <p v-else-if="!surface" class="hint">先选查询入口。期限监控会带出已封装的工作流。</p>
      </div>
      <div v-if="editingId" class="hint">
        <p>客户要求按原网站客户编号读取，只在这里看，不会改原网站。</p>
        <button type="button" class="ghost" :disabled="demandLoading || !keptCustomerId" @click="loadDemands">{{ demandLoading ? '正在读取…' : '读取客户要求' }}</button>
        <p v-if="!keptCustomerId">这位客户还没有原网站客户编号。在查询模板里填上之后，才能读取。</p>
        <p v-if="demandMessage">{{ demandMessage }}</p>
        <p v-if="demandText" class="demand-copy">{{ demandText }}</p>
      </div>
      <p v-if="formMessage" class="hint">{{ formMessage }}</p>
      <div class="form-footer">
        <label class="check-line"><input v-model="enabled" type="checkbox" />以后发文时可以使用这位客户</label>
        <div class="filters">
          <button class="solid" type="submit">保存</button>
          <button v-if="editingId && surface === 'limit'" class="ghost" type="button" @click="saveAnother">另存为另一条</button>
          <button class="solid" type="button" @click="save(true)">保存并前往查询</button>
          <button v-if="editingId" class="ghost" type="button" @click="cancel">取消</button>
        </div>
      </div>
    </form>
  </template>
</template>
