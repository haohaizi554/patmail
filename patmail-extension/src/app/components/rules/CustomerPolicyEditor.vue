<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ThemeSelect from '../../../../../src/components/ThemeSelect.vue'
import { FILE_MAIL_STYLES, LIMIT_MAIL_STYLES } from '../../../customer/mail-flow'
import type { CustomerQueryProfile, LimitMailStyle, QuerySurfaceId } from '../../../customer/types'
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
  save: [policy: { customerProfileId: string; querySurface: QuerySurfaceId | ''; sendMode: SendMode | ''; limitMailStyle: LimitMailStyle | '' }]
  remove: [target: { customerProfileId: string; querySurface: QuerySurfaceId }]
}>()

const profileId = ref('')
const surface = ref<QuerySurfaceId | ''>('')
const sendMode = ref<SendMode | ''>('')
const limitStyle = ref<LimitMailStyle | ''>('')

const names = computed(() => new Map(props.customers.map(item => [item.id, item.name])))
const styleOptions = computed(() => surface.value === 'limit' ? LIMIT_MAIL_STYLES : surface.value === 'file' ? FILE_MAIL_STYLES : [])
const styleValue = computed(() => surface.value === 'limit' ? limitStyle.value : sendMode.value)
const rows = computed(() => [...props.policies].sort((left, right) => {
  const customer = (names.value.get(left.customerProfileId) ?? left.customerProfileId)
    .localeCompare(names.value.get(right.customerProfileId) ?? right.customerProfileId, 'zh')
  return customer || surfaceOf(left).localeCompare(surfaceOf(right))
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

function submit(): void {
  emit('save', {
    customerProfileId: profileId.value,
    querySurface: surface.value,
    sendMode: surface.value === 'file' ? sendMode.value : '',
    limitMailStyle: surface.value === 'limit' ? limitStyle.value : ''
  })
}

watch(() => props.policies, (list) => {
  if (!profileId.value || !surface.value) return
  const saved = surface.value === 'limit'
    ? list.some(item => item.customerProfileId === profileId.value && surfaceOf(item) === 'limit' && item.limitMailStyle === limitStyle.value)
    : list.some(item => item.customerProfileId === profileId.value && surfaceOf(item) === 'file' && item.sendMode === sendMode.value)
  if (!saved) return
  profileId.value = ''
  surface.value = ''
  sendMode.value = ''
  limitStyle.value = ''
})
</script>

<template>
  <section class="card mapping-board">
    <div class="mapping-head">
      <h2>客户发文方式</h2>
    </div>
    <p class="hint">查询方式是左侧的大表：文件管理或期限监控。发文方式跟着这个查询方式走。发文类型不在这里选，由下面的文件描述或发文内容决定。</p>
    <table class="mapping-table policy-map">
      <thead>
        <tr><th>客户</th><th>查询方式</th><th>发文方式</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in rows" :key="`${item.customerProfileId}:${surfaceOf(item)}`">
          <td>{{ names.get(item.customerProfileId) || item.customerProfileId }}</td>
          <td>{{ surfaceLabel(item) }}</td>
          <td>
            <div class="type-cell">
              <span>{{ styleLabel(item) }}</span>
              <button type="button" class="mapping-remove" @click="emit('remove', { customerProfileId: item.customerProfileId, querySurface: surfaceOf(item) })">删除</button>
            </div>
          </td>
        </tr>
        <tr v-if="rows.length === 0">
          <td colspan="3" class="mapping-empty">还没有发文方式。先选查询方式，再选这个方式下的发文方式。</td>
        </tr>
        <tr class="mapping-add">
          <td>
            <ThemeSelect v-model="profileId" placeholder="选择客户" :options="customers.map(item => ({ value: item.id, label: item.name }))" />
          </td>
          <td>
            <ThemeSelect :model-value="surface" placeholder="选择查询方式" :options="SURFACES" @update:model-value="chooseSurface(String($event))" />
          </td>
          <td>
            <div class="type-cell">
              <ThemeSelect :model-value="styleValue" :placeholder="surface ? '选择发文方式' : '先选择查询方式'" :disabled="!surface" :options="styleOptions" @update:model-value="chooseStyle(String($event))" />
              <button type="button" class="solid" @click="submit">添加</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
