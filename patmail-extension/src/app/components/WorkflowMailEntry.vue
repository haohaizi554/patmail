<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import MailTypeTreeSelect from '../../../../src/components/MailTypeTreeSelect.vue'
import ThemeSelect from '../../../../src/components/ThemeSelect.vue'
import EmptyGuide from './EmptyGuide.vue'
import type { MailSender } from '../../customer/mailset'
import { pctRowsFromTable, applyPctMailTypes } from '../../customer/pct-sheet'
import type { CustomerQueryProfile, LimitMailStyle, PctTaskRow } from '../../customer/types'
import { groupWorkflowRows } from '../../customer/workflow-mail'
import { readXlsxRows } from '../../customer/xlsx-table'
import { assembleMail, fillFromRules } from '../../mail'
import type { AssembledMail } from '../../mail/assemble'
import type { MailRuleBundle, SelectedPatentFile } from '../../mail/types'
import { isWriteSwitchOpen } from '../../settings/write-switch'
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
  return `${rows.value.length} 行，按收件人分成 ${count} 封。`
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

function createAndSend(): void {
  buildPreview()
  const steps = [
    { label: '核对客户和表格', detail: '', state: 'run' as const },
    { label: '按发文模式合成信件', detail: '', state: 'wait' as const },
    { label: '创建并发送', detail: '', state: 'wait' as const }
  ]
  progress.value = steps
  if (!customer.value || !rows.value.length || unmatched.value.length || !resolvedSender.value || !previews.value.length) {
    progress.value = [{ label: '核对客户和表格', detail: status.value || '还缺客户、表格、发文类型或发件人。', state: 'stop' }]
    return
  }
  progress.value = [
    { label: '核对客户和表格', detail: `${rows.value.length} 行，客户是${customer.value.name}。`, state: 'done' },
    { label: '按发文模式合成信件', detail: `按「${styleLabel.value || '一件一封'}」合成 ${previews.value.length} 封。`, state: 'done' },
    {
      label: '创建并发送',
      detail: isWriteSwitchOpen()
        ? '写开关已经打开。创建之后系统回什么还没核对完，现在提交对不上，所以停在这里，没有发出去。'
        : '写开关关着。到系统设置里打开之后才能创建和发送。',
      state: 'stop'
    }
  ]
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
        <p class="hint">收件人和抄送先用表格里的人，创建时再补邮箱。</p>
        <button type="button" class="solid" @click="createAndSend">创建并发送</button>
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
