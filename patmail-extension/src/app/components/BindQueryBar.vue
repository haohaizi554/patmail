<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ThemeSelect from '../../../../src/components/ThemeSelect.vue'
import { applyBoundQuery, PENDING_CUSTOMER_KEY, querySnapshot, summarizeBoundQuery } from '../../customer/mail-flow'
import type { QuerySurfaceId } from '../../customer/types'
import { scopeFromConnection } from '../../shared/connection'
import { useWorkspace } from '../composables/useWorkspace'

const props = withDefaults(defineProps<{
  surface: QuerySurfaceId
  fields: Record<string, string>
  templateId?: string
  showLoad?: boolean
}>(), { showLoad: false })
const emit = defineEmits<{ load: [fields: Record<string, string>] }>()

const { connection, customers, call } = useWorkspace()
const picked = ref('')
const reviewSelf = ref(true)
const message = ref('')
const saving = ref(false)

watch(customers, () => {
  if (picked.value && customers.value.some(item => item.id === picked.value)) return
  const pending = sessionStorage.getItem(PENDING_CUSTOMER_KEY) || ''
  const pendingHit = customers.value.find(item => item.id === pending)
  picked.value = pendingHit?.id ?? customers.value[0]?.id ?? ''
}, { immediate: true })

const current = computed(() => customers.value.find(item => item.id === picked.value) ?? null)
const ready = computed(() => Object.keys(querySnapshot(props.fields)).length > 0)
const choices = computed(() => customers.value.map(item => ({ value: item.id, label: item.name })))

function loadBound(): void {
  if (!current.value?.boundQuery) {
    message.value = '这位客户还没有绑定过查询条件。'
    return
  }
  emit('load', { ...current.value.boundQuery })
  message.value = '已载入上次绑定的条件。改完再查询，然后可以重新绑定。'
}

async function bind(): Promise<void> {
  message.value = ''
  const profile = current.value
  if (!profile) { message.value = '先在客户管理里添加客户。'; return }
  if (!ready.value) { message.value = '还没有可绑定的条件。先选择处理事项或填入我方文号，也可以传入 PCT 表格。'; return }
  const scope = scopeFromConnection(connection.value)
  if (!scope) { message.value = '还没确认当前登录的人，没有绑定。'; return }
  saving.value = true
  const next = applyBoundQuery(profile, {
    surface: props.surface,
    fields: props.fields,
    templateId: props.templateId,
    reviewSelf: props.surface === 'limit' && reviewSelf.value
  })
  const result = await call({
    action: 'saveCustomer',
    profile: { ...next, updatedAt: new Date().toISOString() },
    expectedScope: scope,
    expectedRevision: profile.revision ?? 1
  })
  saving.value = false
  if (!result?.ok) {
    message.value = result?.message || '查询条件没有绑上。'
    return
  }
  sessionStorage.setItem(PENDING_CUSTOMER_KEY, profile.id)
  message.value = `已把这次查询条件绑定到${profile.name}。勾选结果可以留到以后再用来发文。`
}
</script>

<template>
  <section class="card">
    <div class="section-heading">
      <strong>把这次查询留给客户</strong>
    </div>
    <p v-if="customers.length === 0" class="empty">还没有客户。先到客户管理填写名称，选好查询入口再过来。</p>
    <template v-else>
      <label>绑定给
        <ThemeSelect v-model="picked" :options="choices" />
      </label>
      <p class="hint">{{ ready ? `将绑定：${summarizeBoundQuery(fields)}` : '还没有可绑定的条件。填写我方文号，或从列表选择处理事项，也可以传入 PCT 表格。' }}</p>
      <p v-if="current?.boundQuery" class="hint">当前绑定：{{ summarizeBoundQuery(current.boundQuery) }}</p>
      <label v-if="surface === 'limit'" class="check-line">
        <input v-model="reviewSelf" type="checkbox" />
        发文最后提交给当前登录人审核
      </label>
      <div class="filters">
        <button class="solid" type="button" :disabled="saving" @click="bind">{{ saving ? '正在绑定…' : `将查询条件绑定到${current?.name || '所选客户'}` }}</button>
        <button v-if="showLoad" class="ghost" type="button" :disabled="!current" @click="loadBound">载入已绑定条件</button>
      </div>
    </template>
    <p v-if="message" class="hint">{{ message }}</p>
  </section>
</template>
