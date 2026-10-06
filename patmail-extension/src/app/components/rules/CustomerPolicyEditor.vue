<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ThemeSelect from '../../../shell/components/ThemeSelect.vue'
import EmptyGuide from '../EmptyGuide.vue'
import { FILE_MAIL_STYLES, LIMIT_MAIL_STYLES } from '../../../customer/mail-flow'
import type { CustomerQueryProfile, LimitMailStyle, QuerySurfaceId } from '../../../customer/types'
import { NEW_POLICY_SET, policyRemark, policySetKey } from '../../../mail/rules/customer-policy'
import type { CustomerMailPolicy, SendMode } from '../../../mail/types'

const SURFACES: { value: QuerySurfaceId; label: string }[] = [
  { value: 'file', label: '文件管理' },
  { value: 'limit', label: '期限监控' }
]

const props = defineProps<{
  policies: CustomerMailPolicy[]
  customers: CustomerQueryProfile[]
}>()
const emit = defineEmits<{
  save: [policy: { customerProfileId: string; querySurface: QuerySurfaceId | ''; sendMode: SendMode | ''; limitMailStyle: LimitMailStyle | ''; remark: string; replaceKey: string }]
  remove: [target: { customerProfileId: string; querySurface: QuerySurfaceId; remark: string }]
}>()

const profileId = ref('')
const surface = ref<QuerySurfaceId | ''>('')
const sendMode = ref<SendMode | ''>('')
const limitStyle = ref<LimitMailStyle | ''>('')
const remark = ref('')
const selectedSet = ref('')

const names = computed(() => new Map(props.customers.map(item => [item.id, item.name])))
const styleOptions = computed(() => surface.value === 'limit' ? LIMIT_MAIL_STYLES : surface.value === 'file' ? FILE_MAIL_STYLES : [])
const styleValue = computed(() => surface.value === 'limit' ? limitStyle.value : sendMode.value)
const customerSets = computed(() => props.policies.filter(item => item.customerProfileId === profileId.value))
const setOptions = computed(() => {
  if (!customerSets.value.length) return []
  return [
    { value: NEW_POLICY_SET, label: '新的一套' },
    ...customerSets.value.map(item => ({ value: policySetKey(item), label: setOptionLabel(item) }))
  ]
})
const rows = computed(() => [...props.policies].sort((left, right) => {
  const customer = (names.value.get(left.customerProfileId) ?? left.customerProfileId)
    .localeCompare(names.value.get(right.customerProfileId) ?? right.customerProfileId, 'zh')
  return customer || surfaceOf(left).localeCompare(surfaceOf(right)) || policyRemark(left.remark).localeCompare(policyRemark(right.remark), 'zh')
}))

function surfaceOf(item: CustomerMailPolicy): QuerySurfaceId {
  return item.querySurface === 'limit' ? 'limit' : 'file'
}

function surfaceLabel(item: CustomerMailPolicy): string {
  return SURFACES.find(entry => entry.value === surfaceOf(item))?.label ?? '文件管理'
}

function styleLabel(item: CustomerMailPolicy): string {
  if (surfaceOf(item) === 'limit') return LIMIT_MAIL_STYLES.find(entry => entry.value === item.limitMailStyle)?.label ?? '还没选发文方式'
  return FILE_MAIL_STYLES.find(entry => entry.value === item.sendMode)?.label ?? '还没选发文方式'
}

function setOptionLabel(item: CustomerMailPolicy): string {
  const note = policyRemark(item.remark) || '未填备注'
  return `${note} · ${surfaceLabel(item)} · ${styleLabel(item)}`
}

function chooseSurface(value: string): void {
  surface.value = value === 'file' || value === 'limit' ? value : ''
  sendMode.value = ''
  limitStyle.value = ''
}

function chooseStyle(value: string): void {
  if (surface.value === 'limit') {
    limitStyle.value = value === '1' || value === '2' || value === '3' ? value : ''
    return
  }
  sendMode.value = value === 'merge_by_customer_description' || value === 'single_file' ? value : ''
}

function chooseSet(value: string): void {
  selectedSet.value = value
  if (!value || value === NEW_POLICY_SET) {
    remark.value = ''
    return
  }
  const item = customerSets.value.find(row => policySetKey(row) === value)
  if (!item) return
  surface.value = surfaceOf(item)
  if (surface.value === 'limit') {
    limitStyle.value = item.limitMailStyle === '1' || item.limitMailStyle === '2' || item.limitMailStyle === '3' ? item.limitMailStyle : ''
    sendMode.value = ''
  } else {
    sendMode.value = item.sendMode === 'merge_by_customer_description' || item.sendMode === 'single_file' ? item.sendMode : ''
    limitStyle.value = ''
  }
  remark.value = policyRemark(item.remark)
}

function submit(): void {
  emit('save', {
    customerProfileId: profileId.value,
    querySurface: surface.value,
    sendMode: surface.value === 'file' ? sendMode.value : '',
    limitMailStyle: surface.value === 'limit' ? limitStyle.value : '',
    remark: remark.value,
    replaceKey: selectedSet.value && selectedSet.value !== NEW_POLICY_SET ? selectedSet.value : ''
  })
}

function clearForm(): void {
  profileId.value = ''
  surface.value = ''
  sendMode.value = ''
  limitStyle.value = ''
  remark.value = ''
  selectedSet.value = ''
}

watch(profileId, () => {
  selectedSet.value = ''
  remark.value = ''
})

watch(() => props.policies, (list) => {
  if (!profileId.value || !surface.value) return
  const key = policySetKey({ customerProfileId: profileId.value, querySurface: surface.value, remark: remark.value })
  const saved = list.some(item => {
    if (policySetKey(item) !== key) return false
    if (surfaceOf(item) === 'limit') return item.limitMailStyle === limitStyle.value
    return item.sendMode === sendMode.value
  })
  if (saved) clearForm()
})
</script>

<template>
  <section class="card mapping-board">
    <div class="mapping-head">
      <h2>客户发文方式</h2>
    </div>
    <p class="hint">同一个客户可以留好几套。每套写一句备注来区分。下拉里选中一套时，会把这套的备注、查询方式和发文方式带出来。</p>
    <table class="mapping-table policy-map">
      <thead>
        <tr><th>客户</th><th>查询方式</th><th>发文方式</th><th>备注</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in rows" :key="policySetKey(item)">
          <td>{{ names.get(item.customerProfileId) || item.customerProfileId }}</td>
          <td>{{ surfaceLabel(item) }}</td>
          <td>{{ styleLabel(item) }}</td>
          <td>
            <div class="type-cell">
              <span>{{ policyRemark(item.remark) || '—' }}</span>
              <button type="button" class="mapping-remove" @click="emit('remove', { customerProfileId: item.customerProfileId, querySurface: surfaceOf(item), remark: item.remark ?? '' })">删除</button>
            </div>
          </td>
        </tr>
        <tr v-if="rows.length === 0">
          <td colspan="4" class="mapping-empty">还没有发文方式。先选查询方式，再选这个方式下的发文方式。</td>
        </tr>
        <tr v-if="customers.length === 0" class="mapping-add">
          <td colspan="4">
            <EmptyGuide text="还没有客户，发文方式没法配。去客户管理建一个再回来。" action="去创建客户" hash="/customers" />
          </td>
        </tr>
        <tr v-else class="mapping-add">
          <td>
            <ThemeSelect v-model="profileId" placeholder="选择客户" :options="customers.map(item => ({ value: item.id, label: item.name }))" />
          </td>
          <td>
            <ThemeSelect :model-value="surface" placeholder="选择查询方式" :options="SURFACES" @update:model-value="chooseSurface(String($event))" />
          </td>
          <td>
            <ThemeSelect :model-value="styleValue" :placeholder="surface ? '选择发文方式' : '先选择查询方式'" :disabled="!surface" :options="styleOptions" @update:model-value="chooseStyle(String($event))" />
          </td>
          <td>
            <div class="type-cell">
              <div class="remark-stack">
                <ThemeSelect v-if="setOptions.length" :model-value="selectedSet" placeholder="选择已有的一套" :options="setOptions" @update:model-value="chooseSet(String($event))" />
                <input v-model="remark" type="text" maxlength="80" placeholder="给这一套写备注" aria-label="备注" @keydown.enter.prevent="submit" />
              </div>
              <button type="button" class="solid" @click="submit">{{ selectedSet && selectedSet !== NEW_POLICY_SET ? '保存' : '添加' }}</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
