<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CustomerQueryProfile } from '../customer/types'
import { planDrafts, type MailDraftPreview, type MailRuleBundle, type SelectedPatentFile, MailRuleRepository, emptyMailRules } from '../mail'
import { ChromeBundleRepository, storageKey } from '../storage/query-bundle'
import { MessageType, type MessageBridge } from '../shared/message'

const props = defineProps<{ bridge?: MessageBridge; userId: string; files: SelectedPatentFile[] }>()
const customers = ref<CustomerQueryProfile[]>([])
const bundle = ref<MailRuleBundle>(emptyMailRules('session'))
const scope = ref<'account' | 'session'>('session')
const message = ref('')
const mailTypes = ref<Array<{ id: string; name: string }>>([])
const drafts = ref<MailDraftPreview[]>([])
const repository = ref<MailRuleRepository | null>(null)
const policyCustomer = ref('')
const policyMode = ref<'merge_by_customer_description' | 'single_file'>('merge_by_customer_description')
const mapText = ref('')
const mapTypeId = ref('')
const recipientCustomer = ref('')
const recipientTo = ref('')
const recipientCc = ref('')
const signatureName = ref('默认签名')
const signatureContent = ref('')
const subjectTemplate = ref('关于{文件名称}的通知')
const countInjection = ref(false)
const missingAnchor = ref<'keep' | 'prefix' | 'confirm'>('keep')
const bodyTemplate = ref('请查收{文件数量}个文件。')
const bodySupplement = ref('')
const importText = ref('')

const owner = computed(() => props.userId || 'session')
const scopeLabel = computed(() => scope.value === 'account' ? '当前账号' : '本次页面，未套用其他账号配置')

async function reloadCustomers(): Promise<void> {
  const key = storageKey(location.origin, props.userId || null)
  if (typeof chrome === 'undefined' || !chrome.storage?.local || !props.userId) {
    customers.value = []
    return
  }
  const loaded = await new ChromeBundleRepository(key).load()
  customers.value = loaded.bundle.customers
}
async function reloadRules(): Promise<void> {
  repository.value = new MailRuleRepository(owner.value, location.origin, props.userId && typeof chrome !== 'undefined' ? chrome.storage?.local ?? null : null)
  const loaded = await repository.value.load()
  bundle.value = loaded.bundle
  scope.value = loaded.scope
  message.value = loaded.warning ?? ''
  subjectTemplate.value = loaded.bundle.subject.template
  countInjection.value = loaded.bundle.subject.countInjection
  missingAnchor.value = loaded.bundle.subject.missingAnchor
  bodyTemplate.value = loaded.bundle.body.template
  bodySupplement.value = loaded.bundle.body.supplement
  drafts.value = []
}
async function loadMailTypes(): Promise<void> {
  if (!props.bridge) return
  const response = await props.bridge.request({ type: MessageType.LoadDictionary, payload: { kind: 'mailType', force: false } })
  if (response.type !== MessageType.DictionaryResult || !response.payload.ok || response.payload.data.kind !== 'mailType') {
    message.value = response.type === MessageType.DictionaryResult && !response.payload.ok ? response.payload.error.message : '发文类型加载失败，不会生成虚构类型。'
    return
  }
  mailTypes.value = response.payload.data.nodes.map(node => ({ id: node.id, name: node.name }))
}
async function save(mutate: (draft: MailRuleBundle) => void): Promise<void> {
  if (!repository.value) return
  try {
    bundle.value = await repository.value.update(mutate)
    message.value = scope.value === 'session' ? '已保存在本次页面。没有稳定用户 ID 时不会写入其他账号的配置。' : '已保存。'
    drafts.value = []
  } catch (error) {
    message.value = error instanceof Error ? error.message : '保存失败，原配置未覆盖。'
  }
}
function newId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`
}
async function importRules(): Promise<void> {
  if (!repository.value) return
  try {
    bundle.value = await repository.value.importJson(importText.value)
    drafts.value = []
    message.value = '已导入当前账号的发文配置。'
  } catch (error) {
    message.value = error instanceof Error ? error.message : '导入失败，原配置未覆盖。'
  }
}
function preview(): void {
  if (!bundle.value) return
  drafts.value = planDrafts({
    selectedAt: new Date().toISOString(),
    files: props.files.map(file => ({ ...file })),
    configVersion: bundle.value.revision
  }, bundle.value, customers.value, owner.value)
}

watch(() => props.userId, () => { void reloadCustomers(); void reloadRules() }, { immediate: true })
</script>

<template>
  <section class="card query-template" aria-label="发文规则">
    <strong>发文规则</strong>
    <p class="hint">配置归属：{{ scopeLabel }}。这里只生成 PatMail 本地草稿，不会在 EASY 创建或发送邮件。</p>
    <p v-if="message" class="hint">{{ message }}</p>
    <label>客户发文方式
      <select v-model="policyCustomer">
        <option value="">选择已有客户配置</option>
        <option v-for="item in customers" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
    </label>
    <label>方式
      <select v-model="policyMode">
        <option value="merge_by_customer_description">同客户同文件描述合并</option>
        <option value="single_file">单个来文发文</option>
      </select>
    </label>
    <button type="button" class="text-button" @click="save(draft => {
      if (!policyCustomer) return
      const current = draft.policies.find(item => item.customerProfileId === policyCustomer)
      const next = { customerProfileId: policyCustomer, sendMode: policyMode, enabled: true, version: (current?.version ?? 0) + 1, updatedAt: new Date().toISOString() }
      draft.policies = draft.policies.filter(item => item.customerProfileId !== policyCustomer).concat(next)
    })">保存发文方式</button>

    <label>文件描述原文<input v-model="mapText" type="text" /></label>
    <label>发文类型
      <select v-model="mapTypeId" @focus="loadMailTypes">
        <option value="">选择发文类型</option>
        <option v-for="item in mailTypes" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
    </label>
    <button type="button" class="text-button" @click="save(draft => {
      const mailType = mailTypes.find(item => item.id === mapTypeId)
      if (!mapText.trim() || !mailType) return
      draft.mappings.push({ id: newId('map'), fileDescriptionText: mapText.trim(), mailTypeId: mailType.id, mailTypeName: mailType.name, enabled: true, version: 1, updatedAt: new Date().toISOString() })
    })">保存描述映射</button>

    <label>收件人客户
      <select v-model="recipientCustomer">
        <option value="">选择客户</option>
        <option v-for="item in customers" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
    </label>
    <label>收件人<input v-model="recipientTo" type="text" placeholder="多个邮箱用逗号分隔" /></label>
    <label>抄送<input v-model="recipientCc" type="text" /></label>
    <button type="button" class="text-button" @click="save(draft => {
      if (!recipientCustomer) return
      draft.recipients = draft.recipients.filter(item => item.customerProfileId !== recipientCustomer)
      draft.recipients.push({ id: newId('to'), customerProfileId: recipientCustomer, name: '默认', to: recipientTo.split(/[,，]/), cc: recipientCc.split(/[,，]/), enabled: true, isDefault: true, version: 1, updatedAt: new Date().toISOString() })
    })">保存收件人</button>

    <label>签名名称<input v-model="signatureName" type="text" /></label>
    <label>签名内容<textarea v-model="signatureContent" rows="3" /></label>
    <button type="button" class="text-button" @click="save(draft => {
      draft.signatures = draft.signatures.filter(item => item.operatorId !== owner)
      draft.signatures.push({ id: newId('sign'), operatorId: owner, name: signatureName, content: signatureContent, enabled: true, isDefault: true, version: 1, updatedAt: new Date().toISOString() })
    })">保存当前操作员签名</button>

    <label>标题模板<input v-model="subjectTemplate" type="text" /></label>
    <label class="check-line"><input v-model="countInjection" type="checkbox" />多个文件时在“关于”后注入数量</label>
    <label>没有“关于”时
      <select v-model="missingAnchor">
        <option value="keep">保留原标题</option>
        <option value="prefix">添加前缀</option>
        <option value="confirm">标记人工确认</option>
      </select>
    </label>
    <label>正文<textarea v-model="bodyTemplate" rows="3" /></label>
    <label>补充文本<textarea v-model="bodySupplement" rows="2" /></label>
    <button type="button" class="text-button" @click="save(draft => {
      draft.subject = { template: subjectTemplate, countInjection, anchor: '关于', missingAnchor, version: draft.subject.version + 1 }
      draft.body = { template: bodyTemplate, supplement: bodySupplement, version: draft.body.version + 1 }
    })">保存标题和正文</button>
    <button type="button" class="text-button" @click="importText = repository?.exportJson(bundle) ?? ''">导出配置</button>
    <label>导入配置<textarea v-model="importText" rows="3" /></label>
    <button type="button" class="text-button" @click="importRules">导入配置</button>
    <button type="button" class="search-submit" :disabled="files.length === 0" @click="preview">重新生成预览</button>
    <article v-for="draft in drafts" :key="draft.id" class="file-card">
      <strong>{{ draft.status === 'ready' ? '可核对' : draft.status === 'warning' ? '需确认' : '不能发文' }} · {{ draft.sendMode === 'single_file' ? '单个来文' : '同描述合并' }}</strong>
      <p class="hint">客户配置 {{ draft.customerProfileId || '未绑定' }} · {{ draft.files.length }} 个文件 · {{ draft.mailTypeName || '未映射发文类型' }}</p>
      <p class="hint">收件人 {{ draft.to.join('、') || '空' }} · 抄送 {{ draft.cc.join('、') || '空' }}</p>
      <p>{{ draft.subject || '无主题' }}</p>
      <pre class="hint">{{ draft.body }}</pre>
      <p v-if="draft.signature" class="hint">签名：{{ draft.signature }}</p>
      <p class="hint">规则来源 {{ JSON.stringify(draft.ruleVersions) }}</p>
      <p v-for="issue in draft.issues" :key="issue.code + issue.field" class="hint">{{ issue.message }}</p>
    </article>
  </section>
</template>
