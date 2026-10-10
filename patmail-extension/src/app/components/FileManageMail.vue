<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import ThemeSelect from '../../shell/components/ThemeSelect.vue'
import EmptyGuide from './EmptyGuide.vue'
import { assessQueryScope } from '../../api/file-search-params'
import { coerceFileSearchQuery } from '../../api/message-guards'
import type { PatentFile } from '../../api/file-search-types'
import type { MailSender } from '../../customer/mailset'
import { customerMailStyleLabel, summarizeBoundQuery } from '../../customer/mail-flow'
import { downloadNameText, type FileDownloadSelection } from '../../mail/download-name'
import { FILE_MANAGE_BATCH, planFileManageLetters, senderAddress, type FileManageFile, type FileManageLetterPlan } from '../../customer/file-manage-plan'
import { fileManageRunStatus } from '../../customer/file-manage-runs'
import { fileIdsOf, fileManageSubmitShouldHalt, runFileManageSubmit, type FileManageSubmitItem } from '../../customer/file-manage-submit'
import { runMailLetterPool } from '../../customer/limit-mail-submit'
import type { CustomerQueryProfile } from '../../customer/types'
import type { MailSignatureItem } from '../../mail/easy/signature-read'
import { defaultSignatureChoice, signatureChoices } from '../../mail/signature-catalog'
import { fetchMailboxSignature } from '../../mail/signature-load'
import type { MailRuleBundle } from '../../mail/types'
import { isQueryGuid } from '../../query/query-validator'
import { scopeFromConnection } from '../../shared/connection'
import { MessageType, type MessageBridge } from '../../shared/message'
import { useMailConcurrency } from '../../settings/use-mail-concurrency'
import { useWorkspace } from '../composables/useWorkspace'
import { beginProgress, classifySubmitText, endProgress, logProgress, progressSummaryLine, tallyProgress } from '../dialog'

const props = defineProps<{
  customers: CustomerQueryProfile[]
  rules: MailRuleBundle | null
  senders: MailSender[]
}>()

const bridge = inject<MessageBridge>('bridge')
const { connection, call } = useWorkspace()
const { concurrency } = useMailConcurrency()
const customerId = ref('')
const searching = ref(false)
const sending = ref(false)
const notice = ref('')
const letters = ref<FileManageLetterPlan[]>([])
const notes = ref<string[]>([])
const outcomes = ref<Record<string, string>>({})
const siteSignatures = ref<MailSignatureItem[]>([])
const reservedSignatureId = ref('')
const foundFiles = ref<FileManageFile[]>([])
const picked = ref<string[]>([])

const bound = computed(() => props.customers.filter(item => item.enabled !== false && item.workflowId === 'file-manage' && (item.querySurface ?? 'file') === 'file'))
const options = computed(() => bound.value.map(item => ({
  value: item.id,
  label: item.workflowRemark?.trim() ? `${item.name}（${item.workflowRemark.trim()}）` : item.name
})))
const customer = computed(() => bound.value.find(item => item.id === customerId.value) ?? null)
const pickedSender = computed(() => {
  const saved = props.rules?.defaultSender
  if (!saved || !isQueryGuid(saved.mailsetId)) return null
  const live = props.senders.find(item => item.id.toLowerCase() === saved.mailsetId.toLowerCase())
  const address = senderAddress(live ?? { label: saved.label })
  return address ? { id: saved.mailsetId, ...address, label: saved.label } : null
})
const reviewer = computed(() => {
  const saved = props.rules?.defaultReviewer
  if (!saved || !isQueryGuid(saved.userId) || !saved.name.trim()) return null
  return saved
})
const signatureChoice = computed(() => defaultSignatureChoice(
  signatureChoices(siteSignatures.value, props.rules?.signatures ?? [], connection.value.operatorId),
  props.rules?.defaultSignatureId ?? null,
  reservedSignatureId.value || null
))
const readyLetters = computed(() => letters.value.filter(item => !item.blocked && item.mailTypeId && item.subject))
const pickedLetters = computed(() => readyLetters.value.filter(item => picked.value.includes(item.key)))
const allReadyPicked = computed(() => readyLetters.value.length > 0 && readyLetters.value.every(item => picked.value.includes(item.key)))
const styleLabel = computed(() => customer.value ? customerMailStyleLabel(customer.value) : '')

function asFile(file: PatentFile): FileManageFile {
  return {
    fileId: file.fileId,
    fileName: file.fileName,
    fileDescription: file.fileDescription?.trim() ?? '',
    customerName: file.customerName?.trim() ?? '',
    ...(file.caseVolume ? { caseVolume: file.caseVolume } : {}),
    ...(file.customerVolume ? { customerVolume: file.customerVolume } : {}),
    ...(file.caseName ? { caseName: file.caseName } : {}),
    ...(file.applicationNo ? { applicationNo: file.applicationNo } : {}),
    ...(file.officialPostDate ? { officialPostDate: file.officialPostDate } : {})
  }
}

async function renameForMail(files: FileManageFile[], selection: FileDownloadSelection | undefined): Promise<{ ok: true; files: FileManageFile[] } | { ok: false; message: string }> {
  if (!selection) return { ok: true, files }
  if (!bridge) return { ok: false, message: '没有连上页面，下载名称没有套上，没有继续发文。' }
  const response = await bridge.request({
    type: MessageType.ResolveDownloadNames,
    payload: { fileIds: files.map(file => file.fileId), selection }
  })
  if (response.type === MessageType.Error) return { ok: false, message: response.payload.message }
  if (response.type !== MessageType.ResolveDownloadNamesResult) return { ok: false, message: '下载名称没有返回，没有按原文件名发文。' }
  if (!response.payload.ok) return { ok: false, message: response.payload.error.message }
  const names = response.payload.data.names
  if (names.length !== files.length) return { ok: false, message: '生成的文件名数量和文件对不上，没有按原文件名发文。' }
  return { ok: true, files: files.map((file, index) => ({ ...file, fileName: names[index] ?? file.fileName })) }
}

function rebuild(files: FileManageFile[]): void {
  const profile = customer.value
  if (!profile) return
  foundFiles.value = files
  const planned = planFileManageLetters({
    customerName: profile.name,
    mailStyle: profile.fileMailStyle === 'single_file' ? 'single_file' : 'merge_by_customer_description',
    files,
    mappings: props.rules?.mappings ?? [],
    subject: props.rules?.subject ?? null,
    hasSender: Boolean(pickedSender.value),
    hasReviewer: Boolean(reviewer.value),
    hasSignature: Boolean(signatureToken())
  })
  letters.value = planned.letters
  notes.value = planned.notes
  const ready = new Set(planned.letters.filter(item => !item.blocked && item.mailTypeId && item.subject).map(item => item.key))
  picked.value = picked.value.filter(key => ready.has(key))
}

async function search(): Promise<void> {
  const profile = customer.value
  if (!bridge || !profile || searching.value) return
  if (connection.value.sessionStatus !== 'authenticated') {
    notice.value = '还没连上 EASY。'
    return
  }
  const fields = profile.boundQuery ?? {}
  if (profile.fileMailStyle !== 'merge_by_customer_description' && profile.fileMailStyle !== 'single_file') {
    notice.value = '这位客户还没选发文方式。'
    letters.value = []
    return
  }
  if (!assessQueryScope(fields).sufficient) {
    notice.value = '这位客户还没绑定足够的查询条件。先到文件查询里查一次并绑到这位客户。'
    letters.value = []
    return
  }
  const query = coerceFileSearchQuery({ resolvedFields: fields, pageIndex: 1, pageSize: 100 })
  if (!query) {
    notice.value = '绑定的查询条件不能用来查询。'
    return
  }
  searching.value = true
  notice.value = ''
  outcomes.value = {}
  letters.value = []
  notes.value = []
  foundFiles.value = []
  picked.value = []
  try {
    const files: FileManageFile[] = []
    let total = 0
    for (let page = 1; page <= 3; page += 1) {
      const response = await bridge.request({
        type: MessageType.SearchFiles,
        payload: { query: { ...query, pageIndex: page, pageSize: 100 } }
      })
      if (response.type !== MessageType.SearchFilesResult) {
        notice.value = response.type === MessageType.Error ? response.payload.message : '文件查询返回了意外结果。'
        return
      }
      if (!response.payload.ok) {
        notice.value = response.payload.error.message
        return
      }
      total = response.payload.data.total
      files.push(...response.payload.data.items.map(asFile))
      if (files.length >= total || response.payload.data.items.length === 0) break
    }
    if (!files.length) {
      notice.value = '按绑定条件没有查到文件。'
      return
    }
    const named = await renameForMail(files, profile.fileDownloadName)
    if (!named.ok) {
      notice.value = named.message
      return
    }
    rebuild(named.files)
    if (profile.fileDownloadName) notes.value = [`文件名已按「${downloadNameText(profile.fileDownloadName)}」生成。`, ...notes.value]
    if (total > files.length) notes.value = [`查询共 ${total} 个文件，这次先取前 ${files.length} 个。`, ...notes.value]
    notice.value = `查到 ${files.length} 个文件，收成 ${letters.value.length} 封。`
  } finally {
    searching.value = false
  }
}

function signatureToken(): string {
  const choice = signatureChoice.value
  if (!choice) return ''
  if (choice.source === 'site' && isQueryGuid(choice.id)) return choice.id
  return choice.content.trim().slice(0, 4000)
}

function itemOf(letter: FileManageLetterPlan): FileManageSubmitItem | null {
  const sender = pickedSender.value
  const person = reviewer.value
  const signature = signatureToken()
  if (!sender || !person || !signature || !letter.mailTypeId || !letter.subject || letter.blocked) return null
  const fileId = letter.files[0]?.fileId ?? ''
  if (!fileId) return null
  return {
    fileId,
    fileIds: letter.files.map(file => file.fileId),
    fileNames: letter.files.map(file => file.fileName),
    mailTypeId: letter.mailTypeId,
    mailStyle: '1',
    subject: letter.subject,
    senderId: sender.id,
    senderName: sender.name,
    senderEmail: sender.email,
    reviewerId: person.userId,
    reviewerName: person.name,
    signature
  }
}

function letterLabel(letter: FileManageLetterPlan): string {
  const volume = letter.files.map(file => file.caseVolume?.trim()).find(Boolean)
  return volume || letter.description || letter.files[0]?.fileName || '这一封'
}

function toggleLetter(key: string): void {
  picked.value = picked.value.includes(key) ? picked.value.filter(item => item !== key) : [...picked.value, key]
}

function toggleReady(on: boolean): void {
  picked.value = on ? readyLetters.value.map(item => item.key) : []
}

async function rememberRun(item: FileManageSubmitItem, letter: FileManageLetterPlan | undefined, text: string): Promise<void> {
  const scope = scopeFromConnection(connection.value)
  const name = customer.value?.name.trim()
  if (!scope || !name) return
  const subject = (item.subject || (letter ? letterLabel(letter) : '')).slice(0, 500)
  const note = text.replace(/\s+/g, ' ').trim().slice(0, 200)
  try {
    await call({
      action: 'recordFileManageRun',
      expectedScope: scope,
      run: {
        customerName: name.slice(0, 120),
        subject,
        fileCount: Math.max(1, Math.min(100, fileIdsOf(item).length)),
        status: fileManageRunStatus(text),
        note
      }
    })
  } catch {
    // 这一封已经处理完。记录写不上不影响发文结果。
  }
}

async function submit(): Promise<void> {
  if (!bridge || sending.value) return
  const queued = pickedLetters.value.flatMap(letter => {
    const item = itemOf(letter)
    return item ? [item] : []
  })
  if (!queued.length) {
    notice.value = readyLetters.value.length ? '先勾选要发的。' : '没有可以创建的发文。先看下面每一封为什么停住。'
    return
  }
  const batch = queued.slice(0, FILE_MANAGE_BATCH)
  const left = queued.length - batch.length
  sending.value = true
  beginProgress('提交到 EASY', batch.length + (left ? 1 : 0))
  try {
    let finished = 0
    const { halted, unstarted } = await runMailLetterPool(batch, concurrency.value, async (item) => {
      const letter = letters.value.find(entry => entry.files.some(file => file.fileId.toLowerCase() === item.fileId.toLowerCase()))
      const label = letter ? letterLabel(letter) : '这一封'
      logProgress(`正在处理 ${label}。`)
      const text = await runFileManageSubmit(bridge, connection.value.operatorId, [item])
      const kind = classifySubmitText(text)
      tallyProgress(kind, fileIdsOf(item).length)
      finished += 1
      text.split('\n').forEach((line, lineIndex) => logProgress(lineIndex === 0 ? `${label}：${line}` : line, finished))
      const next = { ...outcomes.value }
      for (const fileId of fileIdsOf(item)) next[fileId.toLowerCase()] = text
      outcomes.value = next
      await rememberRun(item, letter, text)
      return fileManageSubmitShouldHalt(text)
    })
    if (halted) tallyProgress('skipped', unstarted.reduce((sum, item) => sum + fileIdsOf(item).length, 0))
    if (left) logProgress(`还有 ${left} 封超过一次 20 封的上限，这次没有开始。`)
    logProgress(progressSummaryLine())
  } catch (error) {
    logProgress(error instanceof Error ? error.message : '提交中断了。')
    logProgress(progressSummaryLine())
  } finally {
    endProgress()
    sending.value = false
  }
}

watch(() => connection.value.sessionStatus, (status) => {
  if (status === 'authenticated') void loadSignatures()
}, { immediate: true })

watch(signatureChoice, () => {
  if (foundFiles.value.length) rebuild(foundFiles.value)
})

async function loadSignatures(): Promise<void> {
  if (!bridge) return
  const loaded = await fetchMailboxSignature(bridge, false)
  siteSignatures.value = loaded.data?.items ?? []
  reservedSignatureId.value = loaded.data?.reserved?.id ?? ''
}

function statusOf(letter: FileManageLetterPlan): string {
  const hit = letter.files.map(file => outcomes.value[file.fileId.toLowerCase()]).find(Boolean)
  return hit || letter.blocked || '可以创建'
}

function fileNames(letter: FileManageLetterPlan): string {
  return letter.files.map(file => file.fileName).join('、')
}
</script>

<template>
  <div>
    <div v-if="options.length === 0">
      <EmptyGuide text="还没有绑到文件管理的客户。到客户管理里把查询入口设成文件查询，并选择文件管理。" action="去客户" hash="/customers" />
    </div>
    <template v-else>
      <div class="form-grid">
        <label>客户
          <ThemeSelect v-model="customerId" placeholder="选择客户" :options="options" />
        </label>
      </div>
      <template v-if="customer">
        <p class="hint">查询条件：{{ summarizeBoundQuery(customer.boundQuery) }}</p>
        <p v-if="customer.fileDownloadName" class="hint">发文文件名：{{ downloadNameText(customer.fileDownloadName) }}。查询仍用原来的条件，文件名在发文前按这个下载名称生成。</p>
        <p class="hint">发文方式：{{ styleLabel }}。收件人是案件联系人。抄送是默认发件人{{ pickedSender ? `（${pickedSender.label}）` : '' }}，同时抄送商务。审核人是{{ reviewer ? reviewer.name : '还没设' }}。签名是{{ signatureChoice ? signatureChoice.name : '还没设' }}。</p>
        <p v-if="!pickedSender" class="hint">还没有默认发件人。到发文映射里设一个。</p>
        <p v-if="!reviewer" class="hint">还没有默认审核人。到发文映射里设一个。</p>
        <p v-if="!rules?.subject.template.trim()" class="hint">还没有标题模板。到发文映射里写一条。</p>
        <p v-if="!signatureChoice" class="hint">还没有默认签名。到发文映射里选一条，或添加操作员签名。</p>
        <button type="button" class="solid" :disabled="searching || sending" @click="search">{{ searching ? '正在查询…' : '按绑定条件查询' }}</button>
      </template>
      <p v-if="notice" class="hint">{{ notice }}</p>
      <p v-for="note in notes" :key="note" class="hint">{{ note }}</p>
      <p v-if="letters.length" class="hint">勾选要发的。停住的不能勾。</p>
      <table v-if="letters.length" class="grid file-manage-grid">
        <colgroup>
          <col class="pick" />
          <col class="files" />
          <col class="desc" />
          <col class="type" />
          <col class="to" />
          <col class="cc" />
          <col class="title" />
          <col class="state" />
        </colgroup>
        <thead>
          <tr>
            <th class="pick"><input type="checkbox" aria-label="勾选可以创建的" :checked="allReadyPicked" :disabled="sending || readyLetters.length === 0" @change="toggleReady(($event.target as HTMLInputElement).checked)" /></th>
            <th>文件</th><th>文件描述</th><th>发文类型</th><th>收件人</th><th>抄送</th><th>标题</th><th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="letter in letters" :key="letter.key" :class="{ 'is-selected': picked.includes(letter.key) }">
            <td class="pick"><input type="checkbox" :aria-label="letterLabel(letter)" :checked="picked.includes(letter.key)" :disabled="sending || Boolean(letter.blocked) || !letter.mailTypeId || !letter.subject" @change="toggleLetter(letter.key)" /></td>
            <td class="files" :title="fileNames(letter)"><span class="clip wrap">{{ fileNames(letter) }}</span></td>
            <td class="desc" :title="letter.description || '没有描述'"><span class="clip wrap">{{ letter.description || '没有描述' }}</span></td>
            <td class="type" :title="letter.mailTypeName || '没对上'"><span class="clip wrap">{{ letter.mailTypeName || '没对上' }}</span></td>
            <td class="to" title="案件联系人"><span class="clip wrap">案件联系人</span></td>
            <td class="cc" title="默认发件人，商务"><span class="clip wrap">默认发件人，商务</span></td>
            <td class="title" :title="letter.subject || '还没有标题'"><span class="clip one">{{ letter.subject || '还没有标题' }}</span></td>
            <td class="state" :title="statusOf(letter)"><span class="clip wrap">{{ statusOf(letter) }}</span></td>
          </tr>
        </tbody>
      </table>
      <button v-if="letters.length" type="button" class="solid" :disabled="sending || pickedLetters.length === 0" @click="submit">{{ sending ? '正在创建并提交…' : (pickedLetters.length ? `创建并提交（${pickedLetters.length} 封）` : '创建并提交') }}</button>
    </template>
  </div>
</template>
