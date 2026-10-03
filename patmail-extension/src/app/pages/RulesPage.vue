<script setup lang="ts">
import PageHead from '../../../../src/components/PageHead.vue'
import { bg } from '../../../../src/assets'
import { computed, inject, ref, watch } from 'vue'
import { plainClone } from '../../automation/snapshot'
import { mergeImportedMappings, removeCustomerPolicy, upsertCustomerPolicy, upsertMapping } from '../../mail'
import { readXlsxRows } from '../../customer/xlsx-table'
import type { MailRuleBundle, SendMode } from '../../mail/types'
import type { LimitMailStyle, QuerySurfaceId } from '../../customer/types'
import { isQueryGuid } from '../../query/query-validator'
import { scopeFromConnection, type ExpectedAccountScope } from '../../shared/connection'
import { MessageType, type MessageBridge } from '../../shared/message'
import { useWorkspace } from '../composables/useWorkspace'
import DescriptionMailTypeEditor from '../components/rules/DescriptionMailTypeEditor.vue'
import RecipientEditor from '../components/rules/RecipientEditor.vue'
import SignatureEditor from '../components/rules/SignatureEditor.vue'
import SubjectRuleEditor from '../components/rules/SubjectRuleEditor.vue'
import BodyRuleEditor from '../components/rules/BodyRuleEditor.vue'
import DefaultReviewerEditor from '../components/rules/DefaultReviewerEditor.vue'
import DefaultSenderEditor from '../components/rules/DefaultSenderEditor.vue'
import { fetchMailSenders } from '../../customer/mailset-load'
import { fetchMailTypeNodes } from '../../customer/mail-type-load'
import { fetchMailboxSignature } from '../../mail/signature-load'
import type { MailSignatureItem } from '../../mail/easy/signature-read'
import { defaultSignatureChoice, signatureChoices, signatureKey } from '../../mail/signature-catalog'

const bridge = inject<MessageBridge>('bridge')
const { connection, customers, rules, accountEpoch, call } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const draft = ref<MailRuleBundle | null>(null)
const draftScope = ref<ExpectedAccountScope | null>(null)
const message = ref('')
const savingText = ref(false)
const textStatus = ref('')
const importText = ref('')
const reviewers = ref<Array<{ id: string; name: string }>>([])
const reviewerNotice = ref('')
const senders = ref<Array<{ id: string; label: string; isDefault: boolean; isPublic: boolean; signature: string }>>([])
const senderNotice = ref('')
const mailTypes = ref<Array<{ id: string; name: string; parentId: string }>>([])
const mailTypeNotice = ref('')
const importingMappings = ref(false)
const signatureReserved = ref<MailSignatureItem | null>(null)
const signatureItems = ref<MailSignatureItem[]>([])
const signatureNotice = ref('')
const signatureActiveKey = computed(() => defaultSignatureChoice(
  signatureChoices(signatureItems.value, draft.value?.signatures ?? [], connection.value.operatorId),
  draft.value?.defaultSignatureId ?? null,
  signatureReserved.value?.id ?? null
)?.key ?? '')

watch(rules, (bundle) => {
  draft.value = bundle ? plainClone(bundle) : null
  draftScope.value = scopeFromConnection(connection.value)
}, { immediate: true })
watch(accountEpoch, () => { importText.value = '' })
watch(ready, (ok) => { if (ok) { void loadReviewers(false); void loadSenders(false); void loadMailTypes(false); void loadSignatures(false) } }, { immediate: true })

async function loadReviewers(force: boolean): Promise<void> {
  if (!bridge || !ready.value) return
  reviewerNotice.value = '正在从原网站读取人员…'
  const response = await bridge.request({ type: MessageType.LoadDictionary, payload: { kind: 'reviewer', force } })
  if (response.type === MessageType.Error) {
    reviewerNotice.value = response.payload.message
    reviewers.value = []
    return
  }
  if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'reviewer') {
    reviewerNotice.value = response.type === MessageType.DictionaryResult && !response.payload.ok
      ? response.payload.error.message
      : '人员名单没有从原网站读到。'
    reviewers.value = []
    return
  }
  reviewers.value = response.payload.data.reviewers
  reviewerNotice.value = reviewers.value.length ? '' : '原网站没有返回可选人员。'
}

async function loadSenders(force: boolean): Promise<void> {
  if (!bridge || !ready.value) return
  senderNotice.value = '正在从原网站读取发件邮箱…'
  const loaded = await fetchMailSenders(bridge, force)
  senders.value = loaded.items.map(item => ({
    id: item.id,
    label: item.label,
    isDefault: item.isDefault,
    isPublic: item.isPublic,
    signature: item.signature
  }))
  senderNotice.value = loaded.message
}

async function loadSignatures(force: boolean): Promise<void> {
  if (!bridge || !ready.value) return
  signatureNotice.value = '正在读取个人设置里的邮件签名…'
  const loaded = await fetchMailboxSignature(bridge, force)
  signatureReserved.value = loaded.data?.reserved ?? null
  signatureItems.value = loaded.data?.items ?? []
  signatureNotice.value = loaded.data ? loaded.data.note : loaded.message
}

async function loadMailTypes(force: boolean): Promise<void> {
  if (!bridge || !ready.value) return
  mailTypeNotice.value = '正在从原网站读取发文类型…'
  const loaded = await fetchMailTypeNodes(bridge, force)
  mailTypes.value = loaded.nodes.map(node => ({ id: node.id, name: node.name, parentId: node.parentId }))
  mailTypeNotice.value = mailTypes.value.length ? '' : (loaded.message || '原网站没有返回发文类型。')
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

async function savePolicy(policy: { customerProfileId: string; querySurface: QuerySurfaceId | ''; sendMode: SendMode | ''; limitMailStyle: LimitMailStyle | ''; remark: string; replaceKey: string }): Promise<void> {
  if (!draft.value) return
  if (!policy.customerProfileId) { message.value = '请选择客户。'; return }
  if (policy.querySurface !== 'file' && policy.querySurface !== 'limit') {
    message.value = '请选择查询方式。'
    return
  }
  if (policy.querySurface === 'file' && policy.sendMode !== 'merge_by_customer_description' && policy.sendMode !== 'single_file') {
    message.value = '请选择这个查询方式下的发文方式。'
    return
  }
  if (policy.querySurface === 'limit' && policy.limitMailStyle !== '1' && policy.limitMailStyle !== '2' && policy.limitMailStyle !== '3') {
    message.value = '请选择这个查询方式下的发文方式。'
    return
  }
  const result = upsertCustomerPolicy(draft.value.policies, {
    customerProfileId: policy.customerProfileId,
    querySurface: policy.querySurface,
    sendMode: policy.sendMode,
    limitMailStyle: policy.limitMailStyle,
    remark: policy.remark,
    replaceKey: policy.replaceKey
  })
  if (!result.ok) { message.value = result.message; return }
  await persist(bundle => { bundle.policies = result.policies })
}

async function removePolicy(target: { customerProfileId: string; querySurface: QuerySurfaceId; remark: string }): Promise<void> {
  await persist(bundle => {
    bundle.policies = removeCustomerPolicy(bundle.policies, target)
  })
}

async function saveMapping(input: { description: string; mailTypeId: string; mailTypeName: string }): Promise<void> {
  if (!draft.value) return
  if (!input.description.trim() || !isQueryGuid(input.mailTypeId) || !input.mailTypeName.trim()) {
    message.value = '请填写文件描述，并从发文类型里选择。'
    return
  }
  const result = upsertMapping(draft.value.mappings, {
    id: crypto.randomUUID(),
    fileDescriptionText: input.description,
    mailTypeId: input.mailTypeId,
    mailTypeName: input.mailTypeName,
    enabled: true,
    version: 1,
    updatedAt: new Date().toISOString()
  })
  if (!result.ok) { message.value = result.message; return }
  await persist(bundle => { bundle.mappings = result.mappings })
}

async function removeMapping(id: string): Promise<void> {
  await persist(bundle => { bundle.mappings = bundle.mappings.filter(item => item.id !== id) })
}

async function importMappingFile(file: File): Promise<void> {
  if (!draft.value || importingMappings.value) return
  if (!/\.xlsx$/i.test(file.name)) {
    message.value = '请选择 .xlsx 文件。'
    return
  }
  if (!mailTypes.value.length) {
    message.value = '发文类型还没读到。先重新读取发文类型，再导入。'
    return
  }
  importingMappings.value = true
  try {
    const table = await readXlsxRows(await file.arrayBuffer())
    const merged = mergeImportedMappings(draft.value.mappings, table, mailTypes.value, {
      now: new Date().toISOString(),
      createId: () => crypto.randomUUID()
    })
    if (!merged.ok) {
      message.value = merged.message
      return
    }
    if (!merged.added) {
      message.value = merged.notice
      return
    }
    await persist(bundle => { bundle.mappings = merged.mappings })
    if (message.value.includes('已保存')) message.value = `${merged.notice}发文规则已保存。`
  } catch (error) {
    message.value = error instanceof Error ? error.message : '表格没有读出来。'
  } finally {
    importingMappings.value = false
  }
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
  const name = input.name.trim().slice(0, 80)
  const content = input.content.trim().slice(0, 4000)
  if (!name || !content) { message.value = '请填写签名名称和内容。'; return }
  await persist(bundle => {
    bundle.signatures = bundle.signatures.concat({
      id: crypto.randomUUID(),
      operatorId: connection.value.operatorId,
      name,
      content,
      enabled: true,
      isDefault: false,
      version: 1,
      updatedAt: new Date().toISOString()
    })
  })
}

async function removeSignature(id: string): Promise<void> {
  await persist(bundle => {
    bundle.signatures = bundle.signatures.filter(item => item.id !== id)
    if (bundle.defaultSignatureId === signatureKey('diy', id)) bundle.defaultSignatureId = null
  })
}

async function preferSignature(key: string): Promise<void> {
  await persist(bundle => {
    bundle.defaultSignatureId = key
    const diyId = key.startsWith('diy:') ? key.slice(4) : ''
    bundle.signatures = bundle.signatures.map(item => ({ ...item, isDefault: Boolean(diyId) && item.id === diyId }))
  })
}

async function saveReviewer(input: { userId: string; name: string }): Promise<void> {
  if (!isQueryGuid(input.userId) || !input.name.trim()) { message.value = '请从当前账号的人员里选择审核人。'; return }
  await persist(bundle => { bundle.defaultReviewer = { userId: input.userId, name: input.name.trim() } })
}

async function saveSender(input: { mailsetId: string; label: string }): Promise<void> {
  if (!isQueryGuid(input.mailsetId) || !input.label.trim()) { message.value = '请从原网站的发件邮箱里选择默认发件人。'; return }
  await persist(bundle => { bundle.defaultSender = { mailsetId: input.mailsetId, label: input.label.trim() } })
}

async function saveText(): Promise<void> {
  if (savingText.value) return
  savingText.value = true
  textStatus.value = ''
  try {
    await persist(bundle => {
      if (!draft.value) return
      bundle.subject = { ...draft.value.subject, version: (draft.value.subject.version || 0) + 1 }
      bundle.body = { ...draft.value.body, version: (draft.value.body.version || 0) + 1 }
    })
    textStatus.value = message.value.includes('已保存') ? '标题和正文已保存。' : (message.value || '标题和正文没有保存。')
  } catch (error) {
    textStatus.value = error instanceof Error ? error.message : '标题和正文没有保存。'
    message.value = textStatus.value
  } finally {
    savingText.value = false
  }
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
    bundle.defaultSender = parsed.defaultSender ?? null
    bundle.defaultSignatureId = parsed.defaultSignatureId ?? null
  })
}
</script>

<template>
  <PageHead title="发文映射" desc="文件描述对上发文类型，并记下收件人、签名、标题和正文。" :art="bg('规则配置好，发文更轻松.png')" art-large />
  <section v-if="!ready || !draft" class="card"><p class="empty">尚未确认当前登录的人，不能读取发文映射。</p></section>
  <div v-else class="rules-page">
    <p v-if="message" class="hint">{{ message }}</p>
    <DescriptionMailTypeEditor :mappings="draft.mappings" :mail-types="mailTypes" :notice="mailTypeNotice" :importing="importingMappings" @save="saveMapping" @remove="removeMapping" @reload="loadMailTypes(true)" @import="importMappingFile" />
    <div class="rule-columns">
      <RecipientEditor :recipients="draft.recipients" :customers="customers" @save="saveRecipient" />
      <SignatureEditor :signatures="draft.signatures" :items="signatureItems" :active-key="signatureActiveKey" :notice="signatureNotice" @save="saveSignature" @remove="removeSignature" @prefer="preferSignature" @reload="loadSignatures(true)" />
    </div>
    <div class="rule-columns">
      <DefaultReviewerEditor :reviewers="reviewers" :current-id="connection.operatorId" :selected="draft.defaultReviewer" :notice="reviewerNotice" @save="saveReviewer" @reload="loadReviewers(true)" />
      <DefaultSenderEditor :senders="senders" :selected="draft.defaultSender" :notice="senderNotice" @save="saveSender" @reload="loadSenders(true)" />
    </div>
    <form class="card stack-form" @submit.prevent="saveText">
      <h2>标题和正文</h2>
      <p class="hint">原站默认主题按「客户文号-我方文号-案件名称+发文类型」拼接，空的段会自动去掉。可以删掉其中几段，再写上自己的字，例如把文号改成第一件-最后一件，或改成「18件」。</p>
      <div class="rule-fields">
        <SubjectRuleEditor v-model="draft.subject" />
        <BodyRuleEditor v-model="draft.body" />
      </div>
      <button class="solid" type="submit" :disabled="savingText">{{ savingText ? '正在保存…' : '保存标题和正文' }}</button>
      <p v-if="textStatus" class="save-status" role="status">{{ textStatus }}</p>
    </form>
    <form class="card stack-form" @submit.prevent="importRules">
      <h2>配置导入</h2>
      <label>规则 JSON <textarea v-model="importText" rows="4"></textarea></label>
      <button class="ghost" type="submit">导入到当前账号</button>
    </form>
  </div>
</template>
