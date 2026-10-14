<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PageHead from '../components/PageHead.vue'
import { bg } from '../assets'
import { limitRows as samples } from '../data'
import { assignColumnWidths } from '../column-fit'
import { MAILED_UNFINISHED_REVIEW, SKIP_SEND_REVIEW } from '../../customer/pct-flow-status'

const props = defineProps({
  live: Boolean,
  rows: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  loading: Boolean,
  message: { type: String, default: '' },
  connected: { type: Boolean, default: true },
  hideForm: Boolean,
  pageIndex: { type: Number, default: 1 },
  pageSize: { type: Number, default: 10 },
  selectable: Boolean,
  selected: { type: Array, default: () => [] },
  gates: { type: Object, default: () => ({}) },
  checking: Boolean,
  embedded: Boolean,
  writesOpen: { type: Boolean, default: true },
  writesReady: { type: Boolean, default: true },
  pageWhileLoading: Boolean,
  cachePages: Boolean,
  plainProcIds: { type: Array, default: () => [] },
  flowByProc: { type: Object, default: () => ({}) },
  iprGap: Boolean,
  allowMailedUnfinished: { type: Boolean, default: true }
})
const emit = defineEmits(['search', 'page', 'select', 'confirm', 'submit'])
const ui = inject('ui', null)
const type = ref('all')
const caseVolume = ref('')
const applicationNo = ref('')
const customerName = ref('')
const demoRows = ref(samples)
const types = [
  ['all', '全部'],
  ['pay', '缴费'],
  ['suspend', '中止'],
  ['abandon', '放弃'],
  ['recall', '撤回'],
  ['priority', '优先权'],
  ['fee', '费用']
]
const seenPages = ref([1])
function rowsFor(page) {
  const size = props.pageSize || 100
  const start = ((page || 1) - 1) * size
  return props.rows.slice(start, start + size)
}
watch(() => props.pageIndex, (page) => {
  if (!props.cachePages || !page || seenPages.value.includes(page)) return
  seenPages.value = [...seenPages.value, page]
})
watch(() => props.rows.length, (length, previous) => {
  if (!props.cachePages || !previous || length) return
  seenPages.value = [props.pageIndex || 1]
})
const shown = computed(() => {
  if (!props.live) return demoRows.value
  if (!props.cachePages) return props.rows
  return rowsFor(props.pageIndex)
})
const totalText = computed(() => props.live ? props.total : shown.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalText.value / props.pageSize)))
const submitTitle = computed(() => {
  if (!props.writesReady) return '正在读取系统设置里的写开关。'
  if (!props.writesOpen) return '写开关在系统设置里关着。'
  if (props.iprGap) return '有仲裁结果或空着的收件人时，用旁边两个按钮：信任 AI 按写回的人提交、空行再按发文规则勾选；直接全选则不采用写回的收件人。'
  return '按勾选创建发文。勾几件就发几件，每件单独成封，没勾选的不会因为同客户合并被带上。封与封排队提交，同时在途几封看系统设置里的并发数，默认上一封有结果再取下一封。交给当前登录人审核。发文流程交到审核，不在这里结束。完成事项会勾上本封的处理事项，PCT 相关也一样。'
})
function blocked(row) {
  if (props.flowByProc[row.procId] === MAILED_UNFINISHED_REVIEW) return props.allowMailedUnfinished === false
  if (props.flowByProc[row.procId] === '已提交审核' || props.flowByProc[row.procId] === SKIP_SEND_REVIEW) return true
  return props.gates[row.procId] === 'pending'
}
function canPick(row) {
  if (props.checking) return false
  return !blocked(row)
}
const pageIds = computed(() => shown.value.filter(row => !blocked(row)).map(row => row.procId).filter(Boolean))
const pageAll = computed(() => pageIds.value.length > 0 && pageIds.value.every(id => props.selected.includes(id)))
const everyIds = computed(() => pickableIds())
const plainIds = computed(() => pickableIds(new Set(props.plainProcIds)))

function toggleRow(id) {
  const row = shown.value.find(item => item.procId === id)
  if (!row || !canPick(row)) return
  const next = props.selected.includes(id) ? props.selected.filter(item => item !== id) : [...props.selected, id]
  emit('select', next)
}

function togglePage() {
  const ids = pageIds.value
  const next = pageAll.value
    ? props.selected.filter(id => !ids.includes(id))
    : [...new Set([...props.selected, ...ids])]
  emit('select', next)
}

function pickableIds(allow) {
  const source = props.cachePages ? props.rows : shown.value
  return source.filter(row => !blocked(row) && row.procId && (!allow || allow.has(row.procId))).map(row => row.procId)
}

function selectEvery() {
  emit('select', [...new Set(everyIds.value)])
}

function selectPlain() {
  emit('select', [...new Set(plainIds.value)])
}

function askSubmit(mode) {
  emit('submit', mode)
}

function goPage(page) {
  if (page < 1 || page > totalPages.value) return
  if (props.loading && !props.pageWhileLoading) return
  emit('page', page)
}

function flowStatus(row) {
  const synced = props.flowByProc[row.procId]
  if (synced) return synced
  const gate = props.gates[row.procId]
  if (gate === 'pending') return '已提交审核'
  if (gate === 'done' || gate === 'open') return '还没提交审核'
  return props.checking ? '正在核对' : '—'
}

const host = ref(null)
const colWidths = ref([])
const tableStyle = computed(() => {
  const total = colWidths.value.reduce((sum, width) => sum + width, 0)
  if (!total) return undefined
  return { width: `${total}px`, minWidth: '100%' }
})
let ruler
let observer

function textWidth(text, source) {
  if (!ruler || !source) return 0
  ruler.style.font = getComputedStyle(source).font
  ruler.textContent = String(text ?? '')
  return Math.ceil(ruler.offsetWidth) + 2
}

function columnSpecs(header, body) {
  const rows = shown.value
  const specs = []
  const add = (title, values, mode) => {
    const min = textWidth(title, header) + 16
    let content = min
    for (const value of values) content = Math.max(content, textWidth(value, body) + 16)
    specs.push({ min, content, lock: mode === 'lock', grow: mode === 'grow' })
  }
  if (props.selectable) {
    const pending = rows.some(row => props.gates[row.procId] === 'pending' || props.flowByProc[row.procId] === '已提交审核')
    const head = textWidth('全选', header) + 4 + 16 + 10
    const box = 16 + 10
    const mark = pending ? textWidth('待审核', body) + 10 : box
    const content = Math.max(head, mark, box)
    specs.push({ min: content, content, lock: true, grow: false })
  }
  add('我方文号', rows.map(row => row.caseVolume))
  add('案件名称', rows.map(row => row.caseName), 'grow')
  add('处理事项', rows.map(row => row.ctrlProc))
  add('客户', rows.map(row => row.customerName), 'grow')
  add('申请号', rows.map(row => row.appNo))
  add('官方期限', rows.map(row => row.legalDueDate), 'lock')
  add('客户期限', rows.map(row => row.cusDueDate), 'lock')
  add('内部期限', rows.map(row => row.intDueDate), 'lock')
  add('流程状态', rows.map(row => flowStatus(row)), 'lock')
  return specs
}

function layoutColumns() {
  const root = host.value
  const table = root?.querySelector('table')
  if (!root || !table || !ruler) return
  if (!shown.value.length) {
    colWidths.value = []
    return
  }
  const container = root.clientWidth
  if (container <= 0) return
  const header = table.querySelector('thead th') || table
  const cell = table.querySelector('tbody td:not(.limit-empty)') || header
  colWidths.value = assignColumnWidths(columnSpecs(header, cell), container)
}

const measureKey = computed(() => {
  const rows = shown.value
  const body = rows.map(row => [
    row.caseVolume, row.caseName, row.ctrlProc, row.customerName, row.appNo,
    row.legalDueDate, row.cusDueDate, row.intDueDate, flowStatus(row)
  ].join('\u0001')).join('\u0002')
  return `${props.selectable ? 1 : 0}\u0002${body}`
})

watch(measureKey, () => layoutColumns(), { flush: 'post' })

onMounted(() => {
  ruler = document.createElement('span')
  ruler.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap;visibility:hidden;pointer-events:none;'
  document.body.appendChild(ruler)
  layoutColumns()
  observer = new ResizeObserver(() => layoutColumns())
  if (host.value) observer.observe(host.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  ruler?.remove()
  ruler = null
})

function statusShade(text) {
  if (text === '还没提交审核') return 'shade-open'
  if (text === '已经审核通过') return 'shade-done'
  if (text === MAILED_UNFINISHED_REVIEW) return 'shade-mailed'
  if (text === SKIP_SEND_REVIEW) return 'shade-skip'
  if (text === '已提交审核') return 'shade-pending'
  if (text === '库里没有' || text === '没查成') return 'shade-missing'
  return ''
}

function search() {
  if (props.live) {
    emit('search', {
      type: type.value,
      caseVolume: caseVolume.value.trim(),
      applicationNo: applicationNo.value.trim(),
      customerName: customerName.value.trim()
    })
    return
  }
  const keyword = `${caseVolume.value}${applicationNo.value}${customerName.value}`.trim()
  demoRows.value = samples.filter(row => !keyword || row.caseVolume.includes(keyword) || row.customerName.includes(keyword) || row.appNo.includes(keyword))
  ui?.notify?.('这是界面预览。插件里同一页面会查询 EASY 期限监控。')
}

function reset() {
  caseVolume.value = ''
  applicationNo.value = ''
  customerName.value = ''
  type.value = 'all'
  if (props.live) emit('search', { type: 'all', caseVolume: '', applicationNo: '', customerName: '', reset: true })
  else demoRows.value = samples
}
</script>

<template>
  <PageHead v-if="!embedded" title="期限监控" desc="期限监控自己的查询表。和文件查询不是同一张表。" :art="bg('让重复工作变简单.png')" />
  <slot />
  <section v-if="!hideForm" class="card">
    <div class="filters">
      <button v-for="item in types" :key="item[0]" :class="type === item[0] ? 'solid tiny' : 'ghost'" type="button" @click="type = item[0]">{{ item[1] }}</button>
      <span v-hint="'流程页签使用 FlowMonitorInfo，字段尚未核对'"><button class="ghost" type="button" disabled>流程</button></span>
    </div>
    <div class="form-grid">
      <label>我方文号<input v-model="caseVolume" placeholder="请输入我方文号" /></label>
      <label>申请号<input v-model="applicationNo" placeholder="请输入申请号" /></label>
      <label>客户名称<input v-model="customerName" placeholder="请输入客户名称" /></label>
      <div class="form-actions" style="grid-column: 3">
        <button class="ghost" type="button" @click="reset">重置</button>
        <button class="solid" type="button" :disabled="live && (!connected || loading)" @click="search">{{ loading ? '查询中…' : '查询' }}</button>
      </div>
    </div>
  </section>
  <section class="card" style="margin-top: 14px">
    <div class="toolbar limit-bar">
      <span class="count">期限共 {{ totalText }} 条</span>
      <button v-if="selectable" class="ghost tiny" type="button" :disabled="checking || !pageIds.length" @click="togglePage">{{ pageAll ? '取消全选' : '全选本页' }} {{ pageIds.length }}</button>
      <button v-if="selectable && cachePages" class="ghost tiny" type="button" :disabled="checking || !everyIds.length" @click="selectEvery">全选所有 {{ everyIds.length }}</button>
      <button v-if="selectable && cachePages" class="ghost tiny" type="button" :disabled="checking || !plainIds.length" @click="selectPlain">全选所有（非补非仲） {{ plainIds.length }}</button>
      <div v-if="live && totalPages > 1" class="pagination">
        <button class="ghost tiny" type="button" :disabled="pageIndex <= 1 || (loading && !pageWhileLoading)" @click="goPage(pageIndex - 1)">上一页</button>
        <span>{{ pageIndex }} / {{ totalPages }}</span>
        <button class="ghost tiny" type="button" :disabled="pageIndex >= totalPages || (loading && !pageWhileLoading)" @click="goPage(pageIndex + 1)">下一页</button>
      </div>
      <button v-if="!iprGap" key="submit-auto" class="ghost tiny" type="button" v-hint="submitTitle" @click="askSubmit('auto')">提交到 EASY</button>
      <template v-else>
        <button key="submit-trust" class="ghost tiny" type="button" v-hint="'信任 AI：有名字的行按助手写回的收件人和抄送提交。还空着的行按这封发文规则勾选客户联系人，业务人员作为抄送。写成「不用发」的不创建发文；写成「只发业务」的只写业务人员。'" @click="askSubmit('auto')">提交到 EASY：信任AI</button>
        <button key="submit-all" class="ghost tiny" type="button" v-hint="'不信任 AI：不采用助手写回的收件人。勾选的每一行都按这封发文规则把客户联系人全部勾上，业务人员作为抄送。'" @click="askSubmit('all')">提交到 EASY：直接全选</button>
      </template>
    </div>
    <p v-if="checking" class="hint">正在核对发文审核状态。核对完之前不能勾选。</p>
    <p v-if="message" class="hint">{{ message }}</p>
    <p v-else-if="live && !connected" class="hint">尚未连接 EASY。连接后在这里查询期限，不会使用本页地址发请求。</p>
    <div ref="host" class="fit-table limit-cols">
    <table class="grid" :style="tableStyle">
      <colgroup>
        <col v-for="(width, index) in colWidths" :key="index" :style="{ width: width + 'px' }" />
      </colgroup>
      <thead>
        <tr>
          <th v-if="selectable" class="check"><label class="page-check"><input type="checkbox" :checked="pageAll" :disabled="!pageIds.length" @change="togglePage" />全选</label></th>
          <th>我方文号</th><th>案件名称</th><th>处理事项</th><th>客户</th><th>申请号</th>
          <th>官方期限</th><th>客户期限</th><th>内部期限</th><th class="flow">流程状态</th>
        </tr>
      </thead>
      <template v-if="cachePages">
        <tbody v-for="n in seenPages" :key="n" v-show="n === pageIndex">
          <tr v-if="!rowsFor(n).length">
            <td class="limit-empty" :colspan="selectable ? 10 : 9">{{ loading ? '正在读取期限列表…' : (message ? '查询没有完成，上面有原因。' : '没有可显示的期限记录') }}</td>
          </tr>
          <tr v-for="row in rowsFor(n)" :key="row.procId" v-memo="[row, gates[row.procId], flowByProc[row.procId], checking, selected.includes(row.procId), allowMailedUnfinished]" :class="{ 'is-pending': gates[row.procId] === 'pending' || flowByProc[row.procId] === '已提交审核' || flowByProc[row.procId] === MAILED_UNFINISHED_REVIEW || checking }">
            <td v-if="selectable" class="check">
              <input type="checkbox" :checked="selected.includes(row.procId)" :disabled="!canPick(row)" @change="toggleRow(row.procId)" />
              <span v-if="gates[row.procId] === 'pending' || flowByProc[row.procId] === '已提交审核'" class="clip" v-hint.clip="'待审核'">待审核</span>
            </td>
            <td><span class="clip" v-hint.clip="row.caseVolume">{{ row.caseVolume }}</span></td>
            <td><span class="clip" v-hint.clip="row.caseName">{{ row.caseName }}</span></td>
            <td><span class="clip" v-hint.clip="row.ctrlProc">{{ row.ctrlProc }}</span></td>
            <td><span class="clip" v-hint.clip="row.customerName">{{ row.customerName }}</span></td>
            <td><span class="clip" v-hint.clip="row.appNo">{{ row.appNo }}</span></td>
            <td><span class="clip" v-hint.clip="row.legalDueDate">{{ row.legalDueDate }}</span></td>
            <td><span class="clip" v-hint.clip="row.cusDueDate">{{ row.cusDueDate }}</span></td>
            <td><span class="clip" v-hint.clip="row.intDueDate">{{ row.intDueDate }}</span></td>
            <td :class="['flow', statusShade(flowStatus(row))]">{{ flowStatus(row) }}</td>
          </tr>
        </tbody>
      </template>
      <tbody v-else>
        <tr v-if="!shown.length">
          <td class="limit-empty" :colspan="selectable ? 10 : 9">{{ loading ? '正在读取期限列表…' : (message ? '查询没有完成，上面有原因。' : '没有可显示的期限记录') }}</td>
        </tr>
        <tr v-for="row in shown" :key="row.procId" v-memo="[row, gates[row.procId], flowByProc[row.procId], checking, selected.includes(row.procId), allowMailedUnfinished]" :class="{ 'is-pending': gates[row.procId] === 'pending' || flowByProc[row.procId] === '已提交审核' || flowByProc[row.procId] === MAILED_UNFINISHED_REVIEW || checking }">
          <td v-if="selectable" class="check">
            <input type="checkbox" :checked="selected.includes(row.procId)" :disabled="!canPick(row)" @change="toggleRow(row.procId)" />
            <span v-if="gates[row.procId] === 'pending' || flowByProc[row.procId] === '已提交审核'" class="clip" v-hint.clip="'待审核'">待审核</span>
          </td>
          <td><span class="clip" v-hint.clip="row.caseVolume">{{ row.caseVolume }}</span></td>
          <td><span class="clip" v-hint.clip="row.caseName">{{ row.caseName }}</span></td>
          <td><span class="clip" v-hint.clip="row.ctrlProc">{{ row.ctrlProc }}</span></td>
          <td><span class="clip" v-hint.clip="row.customerName">{{ row.customerName }}</span></td>
          <td><span class="clip" v-hint.clip="row.appNo">{{ row.appNo }}</span></td>
          <td><span class="clip" v-hint.clip="row.legalDueDate">{{ row.legalDueDate }}</span></td>
          <td><span class="clip" v-hint.clip="row.cusDueDate">{{ row.cusDueDate }}</span></td>
          <td><span class="clip" v-hint.clip="row.intDueDate">{{ row.intDueDate }}</span></td>
          <td :class="['flow', statusShade(flowStatus(row))]">{{ flowStatus(row) }}</td>
        </tr>
      </tbody>
    </table>
    </div>
  </section>
</template>
