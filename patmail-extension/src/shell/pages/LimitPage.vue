<script setup>
import { computed, inject, ref, watch } from 'vue'
import PageHead from '../components/PageHead.vue'
import { bg } from '../assets'
import { limitRows as samples } from '../data'

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
  flowByProc: { type: Object, default: () => ({}) }
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
  return '按已确认勾选的事项创建发文，并提交给当前登录人审核。一次一件，不会结束流程。'
})
function canPick(row) {
  if (props.checking) return false
  if (props.flowByProc[row.procId] === '已提交审核') return false
  return props.gates[row.procId] !== 'pending'
}
const pageIds = computed(() => shown.value.filter(canPick).map(row => row.procId).filter(Boolean))
const pageAll = computed(() => pageIds.value.length > 0 && pageIds.value.every(id => props.selected.includes(id)))

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
  return source.filter(row => canPick(row) && row.procId && (!allow || allow.has(row.procId))).map(row => row.procId)
}

function selectEvery() {
  emit('select', [...new Set(pickableIds())])
}

function selectPlain() {
  emit('select', [...new Set(pickableIds(new Set(props.plainProcIds)))])
}

function confirmSelection() {
  const source = props.live ? props.rows : demoRows.value
  const onPage = new Set(source.map(row => row.procId))
  const allowed = new Set(source.filter(canPick).map(row => row.procId))
  emit('confirm', props.selected.filter(id => !onPage.has(id) || allowed.has(id)))
}

function askSubmit() {
  emit('submit')
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

function statusShade(text) {
  if (text === '还没提交审核') return 'shade-open'
  if (text === '已经审核通过') return 'shade-done'
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
      <button v-if="selectable" class="ghost tiny" type="button" :disabled="!pageIds.length" @click="togglePage">{{ pageAll ? '取消全选' : '全选本页' }}</button>
      <button v-if="selectable && cachePages" class="ghost tiny" type="button" :disabled="checking || !rows.length" @click="selectEvery">全选所有</button>
      <button v-if="selectable && cachePages" class="ghost tiny" type="button" :disabled="checking || !plainProcIds.length" @click="selectPlain">全选所有（非补非仲）</button>
      <button v-if="selectable" class="ghost tiny" type="button" :disabled="!selected.length" @click="confirmSelection">确认勾选</button>
      <div v-if="live && totalPages > 1" class="pagination">
        <button class="ghost tiny" type="button" :disabled="pageIndex <= 1 || (loading && !pageWhileLoading)" @click="goPage(pageIndex - 1)">上一页</button>
        <span>{{ pageIndex }} / {{ totalPages }}</span>
        <button class="ghost tiny" type="button" :disabled="pageIndex >= totalPages || (loading && !pageWhileLoading)" @click="goPage(pageIndex + 1)">下一页</button>
      </div>
      <button class="ghost tiny" type="button" v-hint="submitTitle" @click="askSubmit">提交到 EASY</button>
    </div>
    <p v-if="checking" class="hint">正在核对发文审核状态。核对完之前不能勾选。</p>
    <p v-if="message" class="hint">{{ message }}</p>
    <p v-else-if="live && !connected" class="hint">尚未连接 EASY。连接后在这里查询期限，不会使用本页地址发请求。</p>
    <table class="grid">
      <thead>
        <tr>
          <th v-if="selectable"><label class="page-check"><input type="checkbox" :checked="pageAll" :disabled="!pageIds.length" @change="togglePage" />全选</label></th>
          <th>我方文号</th><th>案件名称</th><th>处理事项</th><th>客户</th><th>申请号</th>
          <th>官方期限</th><th>客户期限</th><th>内部期限</th><th>流程状态</th>
        </tr>
      </thead>
      <template v-if="cachePages">
        <tbody v-for="n in seenPages" :key="n" v-show="n === pageIndex">
          <tr v-if="!rowsFor(n).length">
            <td :colspan="selectable ? 10 : 9">{{ loading ? '正在读取期限列表…' : (message ? '查询没有完成，上面有原因。' : '没有可显示的期限记录') }}</td>
          </tr>
          <tr v-for="row in rowsFor(n)" :key="row.procId" v-memo="[row, gates[row.procId], flowByProc[row.procId], checking, selected.includes(row.procId)]" :class="{ 'is-pending': gates[row.procId] === 'pending' || flowByProc[row.procId] === '已提交审核' || checking }">
            <td v-if="selectable">
              <input type="checkbox" :checked="selected.includes(row.procId)" :disabled="!canPick(row)" @change="toggleRow(row.procId)" />
              <span v-if="gates[row.procId] === 'pending' || flowByProc[row.procId] === '已提交审核'">待审核</span>
            </td>
            <td>{{ row.caseVolume }}</td>
            <td>{{ row.caseName }}</td>
            <td>{{ row.ctrlProc }}</td>
            <td>{{ row.customerName }}</td>
            <td>{{ row.appNo }}</td>
            <td>{{ row.legalDueDate }}</td>
            <td>{{ row.cusDueDate }}</td>
            <td>{{ row.intDueDate }}</td>
            <td :class="statusShade(flowStatus(row))">{{ flowStatus(row) }}</td>
          </tr>
        </tbody>
      </template>
      <tbody v-else>
        <tr v-if="!shown.length">
          <td :colspan="selectable ? 10 : 9">{{ loading ? '正在读取期限列表…' : (message ? '查询没有完成，上面有原因。' : '没有可显示的期限记录') }}</td>
        </tr>
        <tr v-for="row in shown" :key="row.procId" v-memo="[row, gates[row.procId], flowByProc[row.procId], checking, selected.includes(row.procId)]" :class="{ 'is-pending': gates[row.procId] === 'pending' || flowByProc[row.procId] === '已提交审核' || checking }">
          <td v-if="selectable">
            <input type="checkbox" :checked="selected.includes(row.procId)" :disabled="!canPick(row)" @change="toggleRow(row.procId)" />
            <span v-if="gates[row.procId] === 'pending' || flowByProc[row.procId] === '已提交审核'">待审核</span>
          </td>
          <td>{{ row.caseVolume }}</td>
          <td>{{ row.caseName }}</td>
          <td>{{ row.ctrlProc }}</td>
          <td>{{ row.customerName }}</td>
          <td>{{ row.appNo }}</td>
          <td>{{ row.legalDueDate }}</td>
          <td>{{ row.cusDueDate }}</td>
          <td>{{ row.intDueDate }}</td>
          <td :class="statusShade(flowStatus(row))">{{ flowStatus(row) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
