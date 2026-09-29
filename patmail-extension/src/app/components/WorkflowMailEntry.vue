<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import MailTypeTreeSelect from '../../../../src/components/MailTypeTreeSelect.vue'
import ThemeSelect from '../../../../src/components/ThemeSelect.vue'
import EmptyGuide from './EmptyGuide.vue'
import type { MailSender } from '../../customer/mailset'
import { PCT_RESUME_KEY, PENDING_CUSTOMER_KEY, applyBoundQuery, querySnapshot } from '../../customer/mail-flow'
import { fillSheetEmails } from '../../customer/customer-page'
import { applyPctMailTypes, buildPctTask, clonePctTask, matchSheetCtrlProcs, pctRowsFromTable, summarizePctTask, volumesOf } from '../../customer/pct-sheet'
import type { CustomerQueryProfile, LimitMailStyle, PctTaskRow } from '../../customer/types'
import { groupWorkflowRows } from '../../customer/workflow-mail'
import { readXlsxRows } from '../../customer/xlsx-table'
import { assembleMail, fillFromRules } from '../../mail'
import type { AssembledMail } from '../../mail/assemble'
import type { MailRuleBundle, SelectedPatentFile } from '../../mail/types'
import { joinCaseVolumes } from '../../customer/volume-list'
import { isQueryGuid } from '../../query/query-validator'
import { scopeFromConnection } from '../../shared/connection'
import { MessageType, type MessageBridge } from '../../shared/message'
import { useWorkspace } from '../composables/useWorkspace'
import { packagedPctWorkflow, pctRuntimeFrom, workflowSender, type WorkflowCatalog, type WorkflowDefinition } from '../../workflow/catalog'

const props = defineProps<{
  customers: CustomerQueryProfile[]
  rules: MailRuleBundle | null
  operatorId: string
  mailTypes: Array<{ id: string; name: string; parentId: string }>
  senders: MailSender[]
  signatureName: string
  signatureText: string
  catalog: WorkflowCatalog
}>()

const bridge = inject<MessageBridge>('bridge')
const { connection, call } = useWorkspace()
const saving = ref(false)
const workflowId = ref('pct-reminder')
const customerId = ref('')
const sheetName = ref('')
const sheetNotice = ref('')
const rows = ref<PctTaskRow[]>([])
const senderTouched = ref(false)
const senderId = ref('')
const status = ref('')
const previews = ref<AssembledMail[]>([])
const cards = ref<Array<{ count: number; to: string; cc: string; sender: string; gaps: string[] }>>([])
const progress = ref<Array<{ label: string; detail: string; state: 'wait' | 'run' | 'done' | 'stop' }>>([])

const definition = computed(() => props.catalog.workflows.find(item => item.id === workflowId.value) ?? null)
const runnable = computed(() => customer.value?.workflowId === 'pct-reminder')
const runtime = computed(() => pctRuntimeFrom(runnable.value ? definition.value : null))
const packaged = computed(() => definition.value && runnable.value ? packagedPctWorkflow(definition.value) : null)
function workflowLabel(id: string | undefined): string {
  return props.catalog.workflows.find(item => item.id === id)?.label ?? ''
}
const workflowCustomers = computed(() => props.customers.filter(item => item.enabled !== false && Boolean(item.workflowId)))
const customer = computed(() => workflowCustomers.value.find(item => item.id === customerId.value) ?? null)
const customerOptions = computed(() => workflowCustomers.value.map(item => ({
  value: item.id,
  label: [item.name, item.workflowRemark, workflowLabel(item.workflowId)].filter(Boolean).join(' · ')
})))
const mailTypeOptions = computed(() => props.mailTypes.map(item => ({
  value: item.id,
  label: item.name,
  ...(item.parentId ? { parent: item.parentId } : {})
})))

const resolvedSender = computed(() => {
  const flow = workflowSender(definition.value)
  const saved = customer.value?.mailsetId
    ? { mailsetId: customer.value.mailsetId, label: customer.value.mailsetLabel || '这个客户记住的邮箱' }
    : flow
      ? { mailsetId: flow.id, label: flow.label }
      : props.rules?.defaultSender ?? null
  if (senderTouched.value) {
    const picked = props.senders.find(item => item.id === senderId.value)
    return picked ? { mailsetId: picked.id, label: picked.label } : saved
  }
  return saved
})
const senderMissing = computed(() => runnable.value && !resolvedSender.value)
const senderOptions = computed(() => {
  const items = props.senders.map(item => ({ value: item.id, label: item.label }))
  const current = resolvedSender.value
  if (current && !items.some(item => item.value === current.mailsetId)) items.unshift({ value: current.mailsetId, label: current.label })
  return items
})

const styleLabel = computed(() => {
  const style = customer.value?.limitMailStyle
  const options = packaged.value?.modes.find(item => item.id === 'mail_style')?.options ?? []
  return options.find(item => item.value === style)?.label ?? ''
})
const customerBrief = computed(() => {
  const current = customer.value
  if (!current) return ''
  const flow = workflowLabel(current.workflowId) || '这条工作流'
  const bits = [`${current.name}走${flow}`]
  if (styleLabel.value) bits.push(styleLabel.value)
  if (resolvedSender.value?.label) bits.push(`从${resolvedSender.value.label}发出`)
  bits.push(current.reviewerName ? `写好后交给${current.reviewerName}看` : '写好后交给当前登录人看')
  return `${bits.join('，')}。`
})
const offCount = computed(() => rows.value.filter(row => row.procLabel && row.procLabel !== runtime.value.procLabel).length)
const outcome = computed(() => {
  const count = cards.value.length
  if (!count) return ''
  if (count === 1) return `${rows.value.length} 行合成 1 封。`
  if (customer.value?.limitMailStyle === '2') return `${rows.value.length} 行，一件一封，共 ${count} 封。`
  if (customer.value?.limitMailStyle === '1') return `${rows.value.length} 行，按客户分成 ${count} 封。`
  return `${rows.value.length} 行，按客户和收件人分成 ${count} 封。`
})
const outcomeGroups = computed(() => {
  if (cards.value.length < 2 || cards.value.length > 6) return []
  return cards.value.map(item => `${item.to} ${item.count} 行`)
})

const unmatched = computed(() => rows.value.filter(row => !row.mailTypeId))

watch(workflowCustomers, (list) => {
  if (customerId.value && list.some(item => item.id === customerId.value)) return
  customerId.value = list.length === 1 ? list[0].id : ''
}, { immediate: true })

watch(customer, (item) => {
  if (item?.workflowId && item.workflowId !== workflowId.value) {
    workflowId.value = item.workflowId
    return
  }
  if (rows.value.length) buildPreview()
}, { immediate: true })

watch(workflowId, () => {
  rows.value = []
  sheetName.value = ''
  sheetNotice.value = ''
  previews.value = []
  cards.value = []
  progress.value = []
  status.value = ''
  senderTouched.value = false
})

watch(resolvedSender, (sender) => {
  if (senderTouched.value || !sender) return
  senderId.value = sender.mailsetId
}, { immediate: true })

function chooseSender(value: string): void {
  senderTouched.value = true
  senderId.value = value
  if (rows.value.length) buildPreview()
}

async function onSheet(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  previews.value = []
  cards.value = []
  progress.value = []
  status.value = ''
  if (!file) return
  sheetName.value = file.name
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    rows.value = []
    sheetNotice.value = '请传入表格文件。'
    return
  }
  try {
    const parsed = pctRowsFromTable(await readXlsxRows(await file.arrayBuffer()), props.mailTypes, runtime.value)
    rows.value = applyPctMailTypes(parsed.rows, props.mailTypes, runtime.value)
    sheetNotice.value = parsed.notice
    buildPreview()
  } catch (error) {
    rows.value = []
    sheetNotice.value = error instanceof Error ? error.message : '表格没有读出来。'
  }
}

function setRowType(volume: string, id: string): void {
  const name = props.mailTypes.find(item => item.id === id)?.name ?? ''
  rows.value = rows.value.map(row => row.ourVolume === volume ? { ...row, mailTypeId: id, mailTypeLabel: name } : row)
  buildPreview()
}

function filesOf(group: PctTaskRow[]): SelectedPatentFile[] {
  return group.map(row => ({
    fileId: row.ourVolume,
    fileName: row.ourVolume,
    fileDescription: row.procLabel,
    customerName: row.customerName || customer.value?.name || '',
    caseVolume: row.ourVolume,
    customerVolume: row.customerVolume
  }))
}

function addresses(group: PctTaskRow[], field: 'mailTo' | 'mailCc', name: 'contactName' | 'iprName'): string {
  return [...new Set(group.map(row => (row[field] || row[name]).trim()).filter(Boolean))].join(';')
}

function people(group: PctTaskRow[], field: 'mailTo' | 'mailCc', name: 'contactName' | 'iprName'): string {
  const names = [...new Set(group.map(row => (row[field] || row[name]).trim()).filter(Boolean))]
  if (!names.length) return '表格里没有'
  if (names.length <= 3) return names.join('、')
  return `${names.slice(0, 3).join('、')} 等 ${names.length} 人`
}

function buildPreview(): void {
  const missing: string[] = []
  if (!customer.value) missing.push('先选择走这条工作流的客户。')
  if (!rows.value.length) missing.push('先传入表格。')
  if (unmatched.value.length) missing.push('还有行没有对上发文类型，请在表格里点选。')
  if (!resolvedSender.value) missing.push('还没有发件人，请选一个。')
  if (missing.length || !customer.value || !resolvedSender.value) {
    previews.value = []
    cards.value = []
    status.value = missing.join('')
    return
  }
  const current = customer.value
  const sender = resolvedSender.value
  const style = current.limitMailStyle as LimitMailStyle | undefined
  const groups = groupWorkflowRows(style, rows.value)
  const built = groups.map(group => {
    const types = [...new Set(group.map(row => row.mailTypeId).filter((item): item is string => Boolean(item)))]
    const typeId = types.length === 1 ? types[0] : ''
    const typeName = types.length === 1 ? (group.find(row => row.mailTypeId === typeId)?.mailTypeLabel ?? '') : ''
    const filled = fillFromRules(current, filesOf(group), props.rules, props.operatorId, props.signatureText)
    const to = addresses(group, 'mailTo', 'contactName')
    const cc = addresses(group, 'mailCc', 'iprName')
    const mail = assembleMail({
      customer: current,
      mailTypeId: typeId,
      mailTypeName: typeName,
      files: filesOf(group),
      to: to || filled.to,
      cc: cc || filled.cc,
      subject: filled.subject,
      body: filled.body,
      reviewer: current.reviewerId && current.reviewerName
        ? { userId: current.reviewerId, name: current.reviewerName }
        : props.rules?.defaultReviewer ?? null,
      sender
    })
    if (types.length > 1) mail.gaps.push('这几行对上了不同的发文类型，合不成一封。')
    if ((to || filled.to) && !(to || filled.to).includes('@')) mail.gaps.push('收件人还是表格里的称呼。')
    return {
      mail,
      card: {
        count: group.length,
        to: people(group, 'mailTo', 'contactName'),
        cc: people(group, 'mailCc', 'iprName'),
        sender: sender.label,
        gaps: mail.gaps
      }
    }
  })
  previews.value = built.map(item => item.mail)
  cards.value = built.map(item => item.card)
  status.value = ''
}

const progressPercent = computed(() => {
  if (!progress.value.length) return 0
  const done = progress.value.filter(item => item.state === 'done').length
  const moving = progress.value.some(item => item.state === 'run' || item.state === 'stop')
  return Math.round(((done + (moving ? 0.35 : 0)) / progress.value.length) * 100)
})

async function ctrlForSheet(): Promise<{ id: string; message: string }> {
  if (!bridge || connection.value.sessionStatus !== 'authenticated') {
    return { id: '', message: '还没确认当前登录的人，任务没有记下。' }
  }
  const response = await bridge.request({ type: MessageType.LoadDictionary, payload: { kind: 'picker', force: false } })
  if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'picker') {
    const message = response.type === MessageType.Error
      ? response.payload.message
      : response.type === MessageType.DictionaryResult && !response.payload.ok
        ? response.payload.error.message
        : '处理事项列表没有从原网站读到。'
    return { id: '', message }
  }
  const options = (response.payload.data.dictionaries.limitCtrlProc?.options ?? []).map(item => ({
    id: item.value,
    label: item.label,
    ...(item.parentValue ? { parentId: item.parentValue } : {})
  }))
  const matched = matchSheetCtrlProcs(rows.value.map(row => row.procLabel), options)
  if (!matched.ok) return { id: '', message: matched.message }
  return { id: matched.ids, message: '' }
}

async function fillEmails(customerId: string): Promise<string> {
  if (!isQueryGuid(customerId)) return '这位客户还没有原网站编号，收件人仍用表格里的称呼。'
  if (!bridge) return '客户联系人没有读到，称呼还没有补成邮箱。'
  const response = await bridge.request({ type: MessageType.ReadCustomerDirectory, payload: { customerId } })
  if (response.type === MessageType.Error) return response.payload.message
  if (response.type !== MessageType.CustomerDirectoryResult) return '客户联系人没有读到，称呼还没有补成邮箱。'
  if (!response.payload.ok) return response.payload.error.message
  const filled = fillSheetEmails(rows.value, response.payload.data.rows)
  rows.value = filled.rows
  const matched = filled.rows.filter(row => (row.mailTo ?? '').includes('@') || (row.mailCc ?? '').includes('@')).length
  const incomplete = response.payload.data.complete ? '' : (response.payload.data.message || '客户联系人没有读全。')
  return [incomplete, matched ? `已为 ${matched} 行补上客户联系人里唯一的邮箱。` : '', ...filled.notes].filter(Boolean).join('')
}

async function createAndSend(): Promise<void> {
  if (saving.value) return
  buildPreview()
  const current = customer.value
  if (!current || !rows.value.length || unmatched.value.length || !resolvedSender.value || !previews.value.length) {
    progress.value = [{ label: '核对客户和表格', detail: status.value || '还缺客户、表格、发文类型或发件人。', state: 'stop' }]
    return
  }
  const checked = { label: '核对客户和表格', detail: `${rows.value.length} 行，客户是${current.name}。`, state: 'done' as const }
  progress.value = [
    checked,
    { label: '补上客户联系人邮箱', detail: '正在读取客户资料页的联系人。', state: 'run' },
    { label: '对上处理事项', detail: '', state: 'wait' },
    { label: '记到客户配置', detail: '', state: 'wait' }
  ]
  saving.value = true
  try {
    const emailNote = await fillEmails(current.easyCustomerId ?? '')
    buildPreview()
    progress.value = [
      checked,
      { label: '补上客户联系人邮箱', detail: emailNote || '表格里的称呼没有需要补的邮箱。', state: 'done' },
      { label: '对上处理事项', detail: '正在从原网站读取处理事项。', state: 'run' },
      { label: '记到客户配置', detail: '', state: 'wait' }
    ]
    const resolved = await ctrlForSheet()
    if (!isQueryGuid(resolved.id)) {
      progress.value[2] = { label: '对上处理事项', detail: resolved.message || '处理事项还没对上原网站。', state: 'stop' }
      return
    }
    const scope = scopeFromConnection(connection.value)
    if (!scope) {
      progress.value[2] = { label: '对上处理事项', detail: '还没确认当前登录的人，任务没有记下。', state: 'stop' }
      return
    }
    const sender = resolvedSender.value
    const built = buildPctTask({
      rows: rows.value,
      ctrlProcId: resolved.id,
      confirmedProcIds: current.pctTask?.confirmedProcIds ?? [],
      ...(sender ? { sender: { mailsetId: sender.mailsetId, label: sender.label } } : {}),
      createdAt: new Date().toISOString()
    })
    if (!built.ok) {
      progress.value[2] = { label: '对上处理事项', detail: built.message, state: 'stop' }
      return
    }
    const volumes = volumesOf(rows.value)
    const caseVolume = joinCaseVolumes(volumes)
    const fields = querySnapshot({ ctrl_proc: resolved.id, ...(caseVolume.length <= 4000 ? { case_volume: caseVolume } : {}) })
    const next = applyBoundQuery(current, {
      surface: 'limit',
      fields,
      reviewSelf: current.reviewTarget === 'self'
    })
    next.pctTask = clonePctTask(built.task)
    if (sender && senderTouched.value) {
      next.mailsetId = sender.mailsetId
      next.mailsetLabel = sender.label
    }
    const result = await call({
      action: 'saveCustomer',
      profile: { ...next, updatedAt: new Date().toISOString() },
      expectedScope: scope,
      expectedRevision: current.revision ?? 1
    })
    if (!result?.ok) {
      progress.value[2] = { label: '对上处理事项', detail: '处理事项已经对上。', state: 'done' }
      progress.value[3] = { label: '记到客户配置', detail: result?.message || '任务没有保存。', state: 'stop' }
      return
    }
    sessionStorage.setItem(PENDING_CUSTOMER_KEY, current.id)
    sessionStorage.setItem(PCT_RESUME_KEY, JSON.stringify({ caseVolume, ctrlProcId: resolved.id }))
    progress.value[2] = { label: '对上处理事项', detail: '处理事项已经对上。', state: 'done' }
    progress.value[3] = {
      label: '记到客户配置',
      detail: `${summarizePctTask(built.task)}接下来到期限监控查询并确认勾选。创建邮件和提交还没核对完响应，这一步没有发出去。`,
      state: 'done'
    }
    location.hash = '#/limits'
  } finally {
    saving.value = false
  }
}

function definitionHint(item: WorkflowDefinition | null): string {
  if (!item || item.id === 'pct-reminder') return ''
  return '这条先记在工作流里。现在能按业务生成预览的，仍是 PCT提醒。'
}
</script>

<template>
  <section class="card">
    <div class="card-head"><h2>按工作流发文</h2></div>
    <p class="hint">选好客户后传入表格。事项、文号、收件人和抄送按表格走，几件合成一封按这位客户已经定好的来。</p>
    <div class="form-grid">
      <div v-if="workflowCustomers.length === 0" class="span-all">
        <EmptyGuide
          :text="customers.length ? '已有客户还没绑工作流。去客户管理把查询入口改成期限监控，选上工作流。同一客户有多条时写备注。' : '还没有客户。去客户管理建一个，查询入口选期限监控，工作流选 PCT提醒。'"
          :action="customers.length ? '去改客户' : '去创建客户'"
          hash="/customers"
        />
      </div>
      <label v-else>客户 <span class="need-mark">必填</span>
        <ThemeSelect v-model="customerId" placeholder="选择客户" :options="customerOptions" />
      </label>
    </div>
    <p v-if="customer && definitionHint(definition)" class="hint">{{ definitionHint(definition) }}</p>

    <p v-if="customerBrief" class="hint">{{ customerBrief }}</p>

    <template v-if="runnable">
      <div class="form-grid">
        <label v-if="senderMissing">发件人 <span class="need-mark">必填</span>
          <ThemeSelect :model-value="senderId" placeholder="选择发件邮箱" empty-text="发件邮箱还没读到。先确认已经连上，再重新打开这一页。" :options="senderOptions" @update:model-value="chooseSender(String($event))" />
        </label>
        <label>表格 <span class="need-mark">必填</span>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="onSheet" />
        </label>
      </div>
      <EmptyGuide v-if="customer && !styleLabel" text="这个客户还没选几件合成一封。去客户管理选好之后，这里会按那个方式合并。" action="去补发文模式" hash="/customers" />
      <p v-if="sheetName" class="hint">{{ sheetName }}{{ sheetNotice ? `。${sheetNotice}` : '' }}</p>
      <p v-if="mailTypes.length === 0" class="hint">发文类型还没读到。确认已经连上后，重新打开这一页。</p>
      <p v-if="unmatched.length" class="hint">这 {{ unmatched.length }} 行没有对上发文类型，请点选。</p>
      <p v-if="offCount" class="hint">有 {{ offCount }} 行的处理事项不是「{{ runtime.procLabel }}」。</p>
      <table v-if="rows.length" class="grid">
        <thead><tr><th>我方文号</th><th>客户文号</th><th>处理事项</th><th>发文类型</th><th>收件人</th><th>抄送</th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.ourVolume">
            <td>{{ row.ourVolume }}</td>
            <td>{{ row.customerVolume || '无' }}</td>
            <td>{{ row.procLabel }}</td>
            <td>
              <span v-if="row.mailTypeId">{{ row.mailTypeLabel }}</span>
              <MailTypeTreeSelect v-else :model-value="row.mailTypeId ?? ''" :options="mailTypeOptions" :disabled="mailTypes.length === 0" @update:model-value="setRowType(row.ourVolume, String($event))" />
            </td>
            <td>{{ row.contactName || '表格里没有' }}</td>
            <td>{{ row.iprName || row.mailCc || '表格里没有' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="status" class="save-status" role="status">{{ status }}</p>
      <section v-if="cards.length" class="card inset">
        <h2>{{ outcome }}</h2>
        <p v-if="outcomeGroups.length" class="hint">{{ outcomeGroups.join('，') }}。</p>
        <p class="hint">记下任务时，会用客户资料页的联系人把表格里的称呼补成唯一邮箱。原网站发文上已经填好的地址，仍在期限监控里追加。</p>
        <button type="button" class="solid" :disabled="saving" @click="createAndSend">{{ saving ? '正在记下任务…' : '记下任务并去查询' }}</button>
        <div v-if="progress.length" class="send-progress" role="status">
          <div class="send-bar" aria-hidden="true"><span :style="{ width: progressPercent + '%' }"></span></div>
          <ol>
            <li v-for="step in progress" :key="step.label" :class="'is-' + step.state">
              <strong>{{ step.label }}</strong>
              <span>{{ step.detail }}</span>
            </li>
          </ol>
        </div>
      </section>
    </template>
  </section>
</template>
