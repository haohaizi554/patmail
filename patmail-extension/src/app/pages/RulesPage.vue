<script setup lang="ts">
import PageHead from '../../../../src/components/PageHead.vue'
import { bg } from '../../../../src/assets'
import { computed, inject, ref, watch } from 'vue'
import { plainClone } from '../../automation/snapshot'
import { upsertMapping } from '../../mail'
import type { MailRuleBundle } from '../../mail/types'
import { isQueryGuid } from '../../query/query-validator'
import { scopeFromConnection, type ExpectedAccountScope } from '../../shared/connection'
import { MessageType, type MessageBridge } from '../../shared/message'
import { useWorkspace } from '../composables/useWorkspace'
import CustomerPolicyEditor from '../components/rules/CustomerPolicyEditor.vue'
import DescriptionMailTypeEditor from '../components/rules/DescriptionMailTypeEditor.vue'
import RecipientEditor from '../components/rules/RecipientEditor.vue'
import SignatureEditor from '../components/rules/SignatureEditor.vue'
import SubjectRuleEditor from '../components/rules/SubjectRuleEditor.vue'
import BodyRuleEditor from '../components/rules/BodyRuleEditor.vue'
import DefaultReviewerEditor from '../components/rules/DefaultReviewerEditor.vue'

const bridge = inject<MessageBridge>('bridge')
const { connection, customers, rules, accountEpoch, call } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const draft = ref<MailRuleBundle | null>(null)
const draftScope = ref<ExpectedAccountScope | null>(null)
const message = ref('')
const importText = ref('')
const reviewers = ref<Array<{ id: string; name: string }>>([])
const reviewerNotice = ref('')

watch(rules, (bundle) => {
  draft.value = bundle ? plainClone(bundle) : null
  draftScope.value = scopeFromConnection(connection.value)
}, { immediate: true })
watch(accountEpoch, () => { importText.value = '' })
watch(ready, (ok) => { if (ok) void loadReviewers() }, { immediate: true })

async function loadReviewers(): Promise<void> {
  if (!bridge || !ready.value) return
  const response = await bridge.request({ type: MessageType.ListFlowReviewers })
  if (response.type === MessageType.Error) {
    reviewerNotice.value = response.payload.message
    reviewers.value = []
    return
  }
  if (response.type !== MessageType.ListFlowReviewersResult) {
    reviewerNotice.value = '审核人名单没有返回。'
    reviewers.value = []
    return
  }
  if (!response.payload.ok) {
    reviewerNotice.value = response.payload.error.message
    reviewers.value = []
    return
  }
  reviewers.value = response.payload.data.reviewers
  reviewerNotice.value = response.payload.data.message
}

async function persist(mutate: (bundle: MailRuleBundle) => void): Promise<void> {
  if (!draft.value || !draftScope.value) {
    message.value = '尚未确认账号，未保存。'
    return
  }
  const next = plainClone(draft.value)
  mutate(next)
  next.ownerId = connection.value.operatorId
  const result = await call({ action: 'saveRules', bundle: next, expectedScope: draftScope.value })
  message.value = result?.message || '规则没有保存。'
  if (result?.rules) draft.value = plainClone(result.rules)
}

function addresses(value: string): string[] {
  return value.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean)
}

async function savePolicy(policy: MailRuleBundle['policies'][number]): Promise<void> {
  await persist(bundle => {
    bundle.policies = bundle.policies.filter(item => item.customerProfileId !== policy.customerProfileId).concat(policy)
  })
}

async function saveMapping(input: { description: string; mailTypeId: string; mailTypeName: string }): Promise<void> {
  if (!draft.value) return
  const result = upsertMapping(draft.value.mappings, {
    id: crypto.randomUUID(),
    fileDescriptionText: input.description,
    mailTypeId: input.mailTypeId,
    mailTypeName: input.mailTypeName || input.description,
    enabled: true,
    version: 1,
    updatedAt: new Date().toISOString()
  })
  if (!result.ok) { message.value = result.message; return }
  await persist(bundle => { bundle.mappings = result.mappings })
}

async function saveRecipient(input: { profileId: string; name: string; to: string; cc: string }): Promise<void> {
  if (!input.profileId || !input.name) { message.value = '请选择客户并填写收件人模板名称。'; return }
  await persist(bundle => {
    bundle.recipients = bundle.recipients.concat({
      id: crypto.randomUUID(),
      customerProfileId: input.profileId,
      name: input.name,
      to: addresses(input.to),
      cc: addresses(input.cc),
      enabled: true,
      isDefault: true,
      version: 1,
      updatedAt: new Date().toISOString()
    })
  })
}

async function saveSignature(input: { name: string; content: string }): Promise<void> {
  if (!input.name.trim()) { message.value = '请填写签名名称。'; return }
  await persist(bundle => {
    bundle.signatures = bundle.signatures.concat({
      id: crypto.randomUUID(),
      operatorId: connection.value.operatorId,
      name: input.name.trim(),
      content: input.content,
      enabled: true,
      isDefault: bundle.signatures.length === 0,
      version: 1,
      updatedAt: new Date().toISOString()
    })
  })
}

async function saveReviewer(input: { userId: string; name: string }): Promise<void> {
  if (!isQueryGuid(input.userId) || !input.name.trim()) { message.value = '请从当前账号的人员里选择审核人。'; return }
  await persist(bundle => { bundle.defaultReviewer = { userId: input.userId, name: input.name.trim() } })
}

async function saveText(): Promise<void> {
  await persist(bundle => {
    if (!draft.value) return
    bundle.subject = { ...draft.value.subject, version: draft.value.subject.version + 1 }
    bundle.body = { ...draft.value.body, version: draft.value.body.version + 1 }
  })
}

async function importRules(): Promise<void> {
  let parsed: MailRuleBundle
  try {
    parsed = JSON.parse(importText.value) as MailRuleBundle
  } catch {
    message.value = '导入失败，原配置未覆盖。'
    return
  }
  if (!isQueryGuid(connection.value.operatorId)) { message.value = '尚未确认 EASY 用户。'; return }
  await persist(bundle => {
    bundle.policies = parsed.policies
    bundle.mappings = parsed.mappings
    bundle.recipients = parsed.recipients
    bundle.signatures = parsed.signatures
    bundle.subject = parsed.subject
    bundle.body = parsed.body
    bundle.defaultReviewer = parsed.defaultReviewer ?? null
  })
}
</script>

<template>
  <PageHead title="发文规则与映射配置" desc="配置企业个性化发文规则，让自动化更贴合您的业务场景。" :art="bg('规则配置好，发文更轻松.png')" art-large />
  <section v-if="!ready || !draft" class="card"><p class="empty">尚未确认 EASY 用户，不能读取发文规则。</p></section>
  <template v-else>
    <section class="card">
      <h2>发文规则</h2>
      <p class="hint">当前版本 {{ draft.revision }}。保存走后台规则服务。内容变化后，未发出的旧任务会标记为过期。</p>
      <p v-if="message" class="hint">{{ message }}</p>
    </section>
    <CustomerPolicyEditor :policies="draft.policies" :customers="customers" @save="savePolicy" />
    <DescriptionMailTypeEditor :mappings="draft.mappings" @save="saveMapping" />
    <RecipientEditor :recipients="draft.recipients" :customers="customers" @save="saveRecipient" />
    <SignatureEditor :signatures="draft.signatures" @save="saveSignature" />
    <DefaultReviewerEditor :reviewers="reviewers" :current-id="connection.operatorId" :selected="draft.defaultReviewer" :notice="reviewerNotice" @save="saveReviewer" />
    <form class="card stack-form" @submit.prevent="saveText">
      <h2>标题和正文</h2>
      <SubjectRuleEditor v-model="draft.subject" />
      <BodyRuleEditor v-model="draft.body" />
      <button class="solid" type="submit">保存标题和正文</button>
    </form>
    <form class="card stack-form" @submit.prevent="importRules">
      <h2>配置导入</h2>
      <label>规则 JSON <textarea v-model="importText" rows="4"></textarea></label>
      <button class="ghost" type="submit">导入到当前账号</button>
    </form>
  </template>
</template>
