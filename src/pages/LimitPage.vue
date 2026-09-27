<script setup>
import { computed, inject, ref } from 'vue'
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
  hideForm: Boolean
})
const emit = defineEmits(['search'])
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
const shown = computed(() => props.live ? props.rows : demoRows.value)
const totalText = computed(() => props.live ? props.total : shown.value.length)

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
  <PageHead title="期限监控" desc="期限监控自己的查询表。和文件查询不是同一张表。" :art="bg('让重复工作变简单.png')" />
  <slot />
  <section v-if="!hideForm" class="card">
    <div class="filters">
      <button v-for="item in types" :key="item[0]" :class="type === item[0] ? 'solid tiny' : 'ghost'" type="button" @click="type = item[0]">{{ item[1] }}</button>
      <button class="ghost" type="button" disabled title="流程页签使用 FlowMonitorInfo，字段尚未核对">流程</button>
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
    <div class="toolbar">
      <span>共 {{ totalText }} 条</span>
      <button class="ghost" type="button" disabled title="LimitMailCustomer 的写开关关闭，不会创建发文">创建发文</button>
    </div>
    <p v-if="message" class="hint">{{ message }}</p>
    <p v-else-if="live && !connected" class="hint">尚未连接 EASY。连接后在这里查询期限，不会使用本页地址发请求。</p>
    <table class="grid">
      <thead>
        <tr>
          <th>我方文号</th><th>案件名称</th><th>处理事项</th><th>客户</th><th>申请号</th>
          <th>官方期限</th><th>客户期限</th><th>内部期限</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!shown.length">
          <td colspan="8">{{ loading ? '正在读取期限列表…' : '没有可显示的期限记录' }}</td>
        </tr>
        <tr v-for="row in shown" :key="row.procId">
          <td>{{ row.caseVolume }}</td>
          <td>{{ row.caseName }}</td>
          <td>{{ row.ctrlProc }}</td>
          <td>{{ row.customerName }}</td>
          <td>{{ row.appNo }}</td>
          <td>{{ row.legalDueDate }}</td>
          <td>{{ row.cusDueDate }}</td>
          <td>{{ row.intDueDate }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
