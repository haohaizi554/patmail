<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { productionGate } from '../mail/easy/gate'
import type { MailExecutionState, MailExecutionView } from '../mail/easy/types'
import type { MailDraftPreview, SelectedPatentFile } from '../mail/types'
import { MessageType, type MessageBridge } from '../shared/message'

const props = defineProps<{ bridge?: MessageBridge; draft: MailDraftPreview; files: SelectedPatentFile[]; revision: number }>()
const emit = defineEmits<{ changed: [view: MailExecutionView | null] }>()
const view = ref<MailExecutionView | null>(null)
const local = ref<'preview' | 'confirm-create' | 'confirm-save' | 'busy'>('preview')
const panelMessage = ref('')

const stageLabels: Record<MailExecutionState, string> = {
  PREVIEW_READY: '本地预览',
  CONFIRM_REQUIRED: '等待确认创建',
  CREATING: '正在创建邮件',
  CREATED: '已取得邮件 ID，准备读取',
  LOADING_MAIL: '正在读取 EASY 邮件',
  MAIL_LOADED: '已读取 EASY 草稿',
  SAVE_CONFIRM_REQUIRED: '等待确认保存',
  SAVING: '正在保存草稿',
  SAVED: '草稿已保存',
  BINDING_FILES: '正在关联文件',
  VERIFYING: '正在核对关联文件',
  COMPLETED: '已核对保存结果',
  PARTIAL_FAILURE: '部分完成，邮件已保留',
  BINDING_BLOCKED: '邮件已保存，文件关联未执行，不是完整成功',
  UNKNOWN: '结果未知，不能自动重试',
  FAILED: '这一步失败'
}

const gateReasons = computed(() => productionGate.blockers(props.draft.sendMode))
const stage = computed(() => view.value?.record.state ?? 'PREVIEW_READY')
const stageLabel = computed(() => stageLabels[stage.value])
const canAskCreate = computed(() => props.draft.status === 'ready' && gateReasons.value.length === 0 &&
  !view.value?.record.requestSent && stage.value !== 'UNKNOWN' && stage.value !== 'COMPLETED')
const canAskSave = computed(() => (stage.value === 'MAIL_LOADED' || stage.value === 'SAVE_CONFIRM_REQUIRED') && (view.value?.diffs.length ?? 0) > 0)
const canInspect = computed(() => Boolean(view.value?.record.mailId) && local.value !== 'busy')

watch(view, value => emit('changed', value))
watch(() => props.draft.fingerprint, () => { local.value = 'preview'; void loadExisting() })
onMounted(() => { void loadExisting() })

async function loadExisting(): Promise<void> {
  if (!props.bridge) return
  const response = await props.bridge.request({ type: MessageType.FindMailExecution, payload: { fingerprint: props.draft.fingerprint } })
  if (response.type === MessageType.MailExecutionResult) view.value = response.payload.view
}

async function createMail(): Promise<void> {
  if (!props.bridge || !canAskCreate.value) return
  local.value = 'busy'
  panelMessage.value = ''
  const response = await props.bridge.request({
    type: MessageType.CreateEasyMail,
    payload: { preview: props.draft, selection: { files: props.files, revision: props.revision }, confirmed: true }
  })
  local.value = 'preview'
  if (response.type !== MessageType.MailExecutionResult || !response.payload.view) {
    panelMessage.value = '创建没有返回执行记录。'
    return
  }
  view.value = response.payload.view
  panelMessage.value = response.payload.view.blockers[0] ?? response.payload.view.record.lastError
}

async function saveMail(): Promise<void> {
  if (!props.bridge || !view.value) return
  local.value = 'busy'
  panelMessage.value = ''
  const response = await props.bridge.request({
    type: MessageType.SaveEasyMail,
    payload: { executionId: view.value.record.executionId, preview: props.draft, selection: { files: props.files, revision: props.revision }, acknowledgedDigest: view.value.record.diffDigest, confirmed: true }
  })
  local.value = 'preview'
  if (response.type !== MessageType.MailExecutionResult || !response.payload.view) {
    panelMessage.value = '保存没有返回执行记录。'
    return
  }
  view.value = response.payload.view
  panelMessage.value = response.payload.view.blockers[0] ?? response.payload.view.record.lastError
}

async function inspect(): Promise<void> {
  if (!props.bridge || !view.value?.record.executionId) return
  local.value = 'busy'
  const response = await props.bridge.request({ type: MessageType.InspectEasyMail, payload: { executionId: view.value.record.executionId } })
  local.value = 'preview'
  if (response.type === MessageType.MailExecutionResult && response.payload.view) view.value = response.payload.view
}
</script>

<template>
  <section class="file-card" aria-label="发文执行">
    <p class="mail-stage" role="status">{{ stageLabel }}<template v-if="local === 'busy'"> · 正在等待这一步的结果</template></p>
    <p v-if="view?.record.mailId" class="hint">EASY mail_id：{{ view.record.mailId }}</p>
    <p v-if="view?.linkedFileIds.length" class="hint">已关联文件：{{ view.linkedFileIds.join('、') }}</p>
    <p v-if="panelMessage || view?.record.lastError" class="hint">{{ panelMessage || view?.record.lastError }}</p>
    <p v-for="reason in gateReasons" :key="reason" class="hint">{{ reason }}</p>
    <p v-if="stage === 'UNKNOWN'" class="hint">创建或保存的结果无法确认。不会自动再发同一请求，请到 EASY 人工核对。</p>

    <template v-if="local === 'confirm-create'">
      <p class="hint">客户配置 {{ draft.customerProfileId }} · {{ draft.mailTypeName || '未映射发文类型' }} · {{ draft.files.length }} 个文件 · 将创建 1 封草稿</p>
      <p class="hint">收件人 {{ draft.to.join('、') || '空' }}</p>
      <button type="button" class="search-submit" :disabled="local === 'confirm-create' && !canAskCreate" @click="createMail">确认创建</button>
      <button type="button" class="text-button" @click="local = 'preview'">返回</button>
    </template>
    <button v-else-if="canAskCreate && local !== 'busy'" type="button" class="text-button" @click="local = 'confirm-create'">创建当前草稿</button>
    <p v-else-if="draft.status !== 'ready'" class="hint">草稿还没通过校验，不能创建。</p>

    <table v-if="view?.diffs.length" class="mail-diff">
      <thead><tr><th>字段</th><th>EASY 原值</th><th>PatMail 计划</th><th>拟保存</th><th>来源</th><th>阻塞</th></tr></thead>
      <tbody>
        <tr v-for="diff in view.diffs" :key="diff.field">
          <td>{{ diff.label }}</td><td>{{ diff.easyValue }}</td><td>{{ diff.planValue }}</td><td>{{ diff.saveValue }}</td>
          <td>{{ diff.source }}</td><td>{{ diff.blocksSave ? '是' : '否' }}</td>
        </tr>
      </tbody>
    </table>

    <template v-if="local === 'confirm-save'">
      <p class="hint">确认后才会保存这封 EASY 草稿，不会发送，也不会提交流程。</p>
      <button type="button" class="search-submit" :disabled="!canAskSave" @click="saveMail">确认保存</button>
      <button type="button" class="text-button" @click="local = 'preview'">返回</button>
    </template>
    <button v-else-if="canAskSave && local !== 'busy'" type="button" class="text-button" @click="local = 'confirm-save'">准备保存</button>
    <button v-if="canInspect" type="button" class="text-button" @click="inspect">重新读取邮件</button>
  </section>
</template>
