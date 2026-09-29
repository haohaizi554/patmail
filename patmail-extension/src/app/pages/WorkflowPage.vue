<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import Bunny from '../../../../src/components/Bunny.vue'
import MailTypeTreeSelect from '../../../../src/components/MailTypeTreeSelect.vue'
import PageHead from '../../../../src/components/PageHead.vue'
import ThemeSelect from '../../../../src/components/ThemeSelect.vue'
import { bg } from '../../../../src/assets'
import {
  cloneCatalog,
  cloneWorkflow,
  defaultPctWorkflow,
  defaultWorkflowCatalog,
  isBuiltinStep,
  isExtraParam,
  nextExtraId,
  paramWarning,
  pctRuntimeFrom,
  workflowFromSkills,
  type WorkflowCatalog,
  type WorkflowDefinition,
  type WorkflowParam,
  type WorkflowStep
} from '../../workflow/catalog'
import { loadWorkflowCatalog, saveWorkflowCatalog } from '../../workflow/catalog-store'
import {
  isStyleLabelParam,
  mailStyleChoiceOptions,
  mailTypeTreeOptions,
  procTreeOptions,
  reviewerChoiceOptions,
  selectedStyleValue,
  senderChoiceOptions,
  shownReviewerId,
  styleLabelFor,
  styleValueParamId,
  type ChoiceOption
} from '../../workflow/choices'
import { matchPctMailTypes, QUERY_SURFACES } from '../../customer/mail-flow'
import { useWorkspace } from '../composables/useWorkspace'
import type { TreeOption } from '../../query/option-tree'
import { SKILLS, skillById, skillTint } from '../../workflow/skills'
import { useWorkflowChoices } from '../composables/useWorkflowChoices'
import { confirmDialog } from '../dialog'

type Screen = 'sea' | 'ocean' | 'flow'

const screen = ref<Screen>('sea')
const catalog = ref<WorkflowCatalog>(defaultWorkflowCatalog())
const draft = ref<WorkflowDefinition | null>(null)
const selectedId = ref('')
const dirty = ref(false)
const saving = ref(false)
const notice = ref('')
const oceanNotice = ref('')
const newName = ref('')
const picked = ref<string[]>([])
const creating = ref(false)
const { rules, mailTypes, senders, procs, reviewers, notice: choiceNotice, load: loadChoices } = useWorkflowChoices()
const { connection } = useWorkspace()
const WORD_PARAMS = new Set(['type_keyword', 'customer_keyword', 'our_keyword', 'city_keyword', 'other_city_keyword'])
const LISTED_CHOICES = new Set(['sender_mailset', 'surface_label'])
let silence = false

const ID_CHOICES = new Set(['customer_type_id', 'our_type_id', 'sender_mailset'])

watch(draft, () => {
  if (!silence && screen.value === 'flow') dirty.value = true
}, { deep: true, flush: 'sync' })

function replaceDraft(next: WorkflowDefinition | null, markDirty: boolean): void {
  silence = true
  draft.value = next
  dirty.value = markDirty
  silence = false
}

onMounted(async () => {
  catalog.value = await loadWorkflowCatalog()
})

onActivated(() => {
  if (dirty.value || creating.value || saving.value) return
  replaceDraft(null, false)
  screen.value = 'sea'
})

watch(screen, (value) => {
  if (value === 'flow') void loadChoices(false)
})

const selected = computed(() => draft.value?.steps.find(step => step.id === selectedId.value) ?? null)
const visibleParams = computed(() => selected.value?.params.filter(param => !param.hidden && !WORD_PARAMS.has(param.id)) ?? [])
const matchedMail = computed(() => matchPctMailTypes(mailTypes.value, draft.value ? pctRuntimeFrom(draft.value) : undefined))
const stepHasChoice = computed(() => visibleParams.value.some(param => isIdChoice(param.id) || param.id === 'proc_label' || param.id === 'review_label'))

const LEGACY_STYLE_LABELS: Record<string, string> = {
  '合成一封': '同客户合并发文',
  '一件一封': '单个来文发文',
  '按第一联系人合成': '同客户第一联系人合并发文'
}
const STYLE_FIELD_LABEL = '发文方式'
const STYLE_NAME_LABELS = new Set([
  '同客户合并发文',
  '单个来文发文',
  '同客户第一联系人合并发文',
  ...Object.keys(LEGACY_STYLE_LABELS)
])
const LEGACY_STYLE_DETAILS = new Set([
  '具体用哪一种，在客户里选。这里改的是你看到的名字。',
  '客户里选的就是下面这几种。每一种的名字直接写出来。'
])
const PCT_STYLE_DETAIL = '这一条用同客户合并发文。同一客户的几件合成一封。'

function spellStyleNames(flow: WorkflowDefinition): boolean {
  let changed = false
  for (const step of flow.steps) {
    if ((step.skillId === 'send-style' || step.id === 'mail-style') && LEGACY_STYLE_DETAILS.has(step.detail.trim())) {
      step.detail = PCT_STYLE_DETAIL
      changed = true
    }
    for (const param of step.params) {
      if (!isStyleLabelParam(param.id)) continue
      if (!param.hidden && STYLE_NAME_LABELS.has(param.label.trim()) && param.label !== STYLE_FIELD_LABEL) {
        param.label = STYLE_FIELD_LABEL
        changed = true
      }
      if (!param.hidden && param.help.trim() === '客户看到这个名字。') {
        param.help = '从名单里点一种。'
        changed = true
      }
      const stored = step.params.find(item => item.id === styleValueParamId(param.id))?.value ?? ''
      const official = styleLabelFor(selectedStyleValue(param.value, stored))
      if (official && param.value !== official) {
        param.value = official
        changed = true
      }
    }
  }
  return changed
}

function openFlow(flow: WorkflowDefinition): void {
  const next = cloneWorkflow(flow)
  const changed = spellStyleNames(next)
  replaceDraft(next, changed)
  selectedId.value = next.steps[0]?.id ?? ''
  notice.value = ''
  screen.value = 'flow'
}

async function backToSea(): Promise<void> {
  if (dirty.value) {
    const ok = await confirmDialog({
      title: '先不保存？',
      message: '这一条还有没保存的修改。回到海边后，这些修改就丢掉了。',
      confirmLabel: '回到海边'
    })
    if (!ok) return
  }
  replaceDraft(null, false)
  screen.value = 'sea'
}

function openOcean(): void {
  picked.value = []
  newName.value = ''
  oceanNotice.value = ''
  screen.value = 'ocean'
}

function toggleSkill(id: string): void {
  const index = picked.value.indexOf(id)
  picked.value = index >= 0 ? picked.value.filter(item => item !== id) : [...picked.value, id]
}

async function createFromOcean(): Promise<void> {
  if (creating.value) return
  if (!picked.value.length) {
    oceanNotice.value = '先从海洋里挑至少一件事。'
    return
  }
  if (catalog.value.workflows.length >= 8) {
    oceanNotice.value = '已经有 8 条了，先删掉一条再加。'
    return
  }
  creating.value = true
  try {
    const created = workflowFromSkills(newName.value, picked.value, catalog.value.workflows.map(item => item.id))
    const saved = await saveWorkflowCatalog({ workflows: [...catalog.value.workflows, created] })
    catalog.value = saved
    const next = saved.workflows.find(item => item.id === created.id) ?? created
    openFlow(next)
  } finally {
    creating.value = false
  }
}

async function save(): Promise<void> {
  if (!draft.value || saving.value) return
  saving.value = true
  notice.value = ''
  const savedId = draft.value.id
  try {
    const current = cloneCatalog(catalog.value)
    const index = current.workflows.findIndex(item => item.id === savedId)
    if (index >= 0) current.workflows[index] = draft.value
    else current.workflows.push(draft.value)
    const saved = await saveWorkflowCatalog(current)
    catalog.value = saved
    const next = saved.workflows.find(item => item.id === savedId) ?? null
    if (next && screen.value === 'flow') {
      const keep = selectedId.value
      replaceDraft(cloneWorkflow(next), false)
      selectedId.value = next.steps.some(step => step.id === keep) ? keep : (next.steps[0]?.id ?? '')
    }
    notice.value = savedId === 'pct-reminder'
      ? '已保存。读表格和对信的种类，会按这里的写法走。'
      : '已保存。这条先记在这里，客户里现在自动用的仍是 PCT提醒。'
  } finally {
    saving.value = false
  }
}

async function resetPct(): Promise<void> {
  if (draft.value?.id !== 'pct-reminder') return
  const ok = await confirmDialog({
    title: '恢复最初的样子',
    message: 'PCT提醒的每一步会回到一开始的写法。点保存之后，才会盖过已经保存的那份。',
    confirmLabel: '恢复'
  })
  if (!ok) return
  const next = defaultPctWorkflow()
  replaceDraft(next, true)
  selectedId.value = next.steps[0]?.id ?? ''
  notice.value = '已恢复。点保存后才会写上。'
}

async function removeFlow(flow: WorkflowDefinition): Promise<void> {
  if (flow.id === 'pct-reminder') return
  const ok = await confirmDialog({
    title: '拿掉这条',
    message: `拿掉「${flow.label}」？`,
    confirmLabel: '拿掉'
  })
  if (!ok) return
  const saved = await saveWorkflowCatalog({
    workflows: catalog.value.workflows.filter(item => item.id !== flow.id)
  })
  catalog.value = saved
}

async function removeStep(id: string): Promise<void> {
  if (!draft.value || isBuiltinStep(id)) return
  const step = draft.value.steps.find(item => item.id === id)
  const ok = await confirmDialog({
    title: '拿掉这一步',
    message: `拿掉「${step?.title || '这一步'}」？保存之后才会写上。`,
    confirmLabel: '拿掉'
  })
  if (!ok || !draft.value) return
  draft.value.steps = draft.value.steps.filter(item => item.id !== id)
  if (selectedId.value === id) selectedId.value = draft.value.steps[0]?.id ?? ''
}

function addSkillStep(skillId: string): void {
  if (!draft.value || draft.value.steps.length >= 16) return
  const step = workflowFromSkills('临时', [skillId], []).steps[0]
  if (!step) return
  step.id = nextExtraId(draft.value.steps.map(item => item.id), 'step')
  draft.value.steps.push(step)
  selectedId.value = step.id
}

function moveStep(id: string, direction: -1 | 1): void {
  if (!draft.value) return
  const index = draft.value.steps.findIndex(step => step.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= draft.value.steps.length) return
  const steps = [...draft.value.steps]
  const [item] = steps.splice(index, 1)
  if (!item) return
  steps.splice(target, 0, item)
  draft.value.steps = steps
}

function addNote(step: WorkflowStep): void {
  if (step.params.length >= 24) return
  step.params.push({
    id: nextExtraId(step.params.map(item => item.id), 'param'),
    label: '再记一笔',
    value: '',
    help: ''
  })
}

function removeNote(step: WorkflowStep, id: string): void {
  step.params = step.params.filter(item => item.id !== id)
}

function skillTitle(step: WorkflowStep): string {
  return skillById(step.skillId)?.blurb ?? '自己加的一步'
}

function isIdChoice(id: string): boolean {
  return ID_CHOICES.has(id)
}

function isMailTypeParam(id: string): boolean {
  return id === 'customer_type_id' || id === 'our_type_id'
}

function isListedChoice(id: string): boolean {
  return LISTED_CHOICES.has(id)
}

function showsText(id: string): boolean {
  return !isIdChoice(id) && !isListedChoice(id) && id !== 'review_label' && id !== 'proc_label' && !isStyleLabelParam(id)
}

function shownTypeId(param: WorkflowParam): string {
  if (param.value.trim()) return param.value
  if (param.id === 'customer_type_id') return matchedMail.value.customerVolume?.id ?? ''
  if (param.id === 'our_type_id') return matchedMail.value.ourVolumeShenzhen?.id ?? ''
  return ''
}

function surfaceOptions(current: string): ChoiceOption[] {
  const options = QUERY_SURFACES.map(item => ({ value: item.label, label: item.label }))
  const saved = current.trim()
  if (saved && !options.some(item => item.value === saved)) options.unshift({ value: saved, label: saved })
  return options
}

function hiddenName(id: string): string {
  const key = id === 'customer_type_id' ? 'customer_type_name' : id === 'our_type_id' ? 'our_type_name' : 'sender_mailset_label'
  return selected.value?.params.find(item => item.id === key)?.value ?? ''
}

function treeOptionsFor(param: WorkflowParam): TreeOption[] {
  return mailTypeTreeOptions({
    nodes: mailTypes.value,
    currentId: param.value,
    currentName: hiddenName(param.id)
  })
}

function procTreeFor(param: WorkflowParam): { options: TreeOption[]; selectedId: string } {
  return procTreeOptions(procs.value, param.value)
}

function hiddenStyle(labelId: string): string {
  const key = styleValueParamId(labelId)
  return selected.value?.params.find(item => item.id === key)?.value ?? ''
}

function shownStyle(param: WorkflowParam): string {
  return selectedStyleValue(param.value, hiddenStyle(param.id))
}

function styleOptionsFor(param: WorkflowParam): ChoiceOption[] {
  const options = mailStyleChoiceOptions()
  const current = shownStyle(param)
  if (current && !options.some(item => item.value === current)) {
    options.unshift({ value: current, label: param.value.trim() || styleLabelFor(current) || current })
  }
  return options
}

function chooseStyle(param: WorkflowParam, code: string): void {
  const label = styleLabelFor(code) || styleOptionsFor(param).find(item => item.value === code)?.label || ''
  if (!label || !selected.value) return
  param.value = label
  const hidden = selected.value.params.find(item => item.id === styleValueParamId(param.id))
  if (hidden) hidden.value = code
}

function reviewerOptions(): ChoiceOption[] {
  const stored = hiddenReview()
  const selectedId = shownReviewerId({
    stored,
    currentId: connection.value.operatorId,
    reviewers: reviewers.value
  })
  const selectedName = stored && stored !== 'self'
    ? reviewers.value.find(item => item.id.toLowerCase() === stored.toLowerCase())?.name || reviewLabel()
    : connection.value.displayName
  return reviewerChoiceOptions({
    reviewers: reviewers.value,
    currentId: connection.value.operatorId,
    currentName: connection.value.displayName,
    selectedId,
    selectedName
  })
}

function hiddenReview(): string {
  return selected.value?.params.find(item => item.id === 'review_value')?.value ?? ''
}

function reviewLabel(): string {
  return selected.value?.params.find(item => item.id === 'review_label')?.value ?? ''
}

function shownReviewer(): string {
  return shownReviewerId({
    stored: hiddenReview(),
    currentId: connection.value.operatorId,
    reviewers: reviewers.value
  })
}

function optionsFor(param: WorkflowParam): ChoiceOption[] {
  if (isMailTypeParam(param.id) || param.id === 'proc_label' || isStyleLabelParam(param.id) || param.id === 'review_label') return []
  if (param.id === 'surface_label') return surfaceOptions(param.value)
  if (param.id === 'sender_mailset') {
    const remembered = rules.value?.defaultSender
    return senderChoiceOptions({
      senders: senders.value,
      remembered: remembered ? { id: remembered.mailsetId, label: remembered.label } : null,
      currentId: param.value,
      currentName: hiddenName(param.id)
    })
  }
  return []
}

function chooseChoice(param: WorkflowParam, value: string): void {
  param.value = value
  const key = param.id === 'customer_type_id'
    ? 'customer_type_name'
    : param.id === 'our_type_id'
      ? 'our_type_name'
      : param.id === 'sender_mailset'
        ? 'sender_mailset_label'
        : ''
  if (!key || !selected.value) return
  const hidden = selected.value.params.find(item => item.id === key)
  if (!hidden) return
  if (!value) {
    hidden.value = ''
    return
  }
  if (param.id === 'sender_mailset') {
    hidden.value = senders.value.find(item => item.id === value)?.label
      || (rules.value?.defaultSender?.mailsetId === value ? rules.value.defaultSender.label : '')
      || hidden.value
    return
  }
  hidden.value = mailTypes.value.find(item => item.id === value)?.name
    || rules.value?.mappings.find(item => item.mailTypeId === value)?.mailTypeName
    || hidden.value
}

function chooseProc(param: WorkflowParam, id: string): void {
  if (!id || id.startsWith('saved:')) return
  const node = procs.value.find(item => item.id === id)
  if (!node) return
  const parents = new Set(procs.value.map(item => item.parentId).filter((item): item is string => Boolean(item)))
  if (parents.has(node.id)) return
  param.value = node.label
}

function chooseReviewer(param: WorkflowParam, id: string): void {
  const person = reviewers.value.find(item => item.id.toLowerCase() === id.toLowerCase())
  const name = person?.name.trim()
    || (id.toLowerCase() === connection.value.operatorId.trim().toLowerCase() ? connection.value.displayName.trim() : '')
  if (!name || !selected.value) return
  param.value = name
  const hidden = selected.value.params.find(item => item.id === 'review_value')
  if (!hidden) return
  const self = connection.value.operatorId.trim()
  hidden.value = self && id.toLowerCase() === self.toLowerCase() ? 'self' : id
}
</script>

<template>
  <header v-if="screen === 'flow' && draft" class="page-head flow-head">
    <Bunny />
    <div class="flow-head-fields">
      <button type="button" class="flow-text" @click="backToSea">回到海边</button>
      <label>名字
        <input v-model="draft.label" type="text" maxlength="40" />
      </label>
      <label>这句话怎么介绍
        <input v-model="draft.summary" type="text" maxlength="400" />
      </label>
    </div>
    <img class="page-art" :src="bg('专注每一次发文，让知识更有力量.png')" alt="" />
  </header>
  <PageHead
    v-else
    title="工作流"
    :desc="screen === 'ocean' ? '从知识海洋里挑几件会做的事，串成一条你自己的。' : '先挑一条，点开再看每一步。'"
    :art="bg('专注每一次发文，让知识更有力量.png')"
  />

  <section v-if="screen === 'sea'" class="sea">
    <article v-for="flow in catalog.workflows" :key="flow.id" class="sea-card">
      <button type="button" class="sea-open" @click="openFlow(flow)">
        <b>{{ flow.label }}</b>
        <small>{{ flow.summary }}</small>
        <em>{{ flow.steps.length }} 步</em>
      </button>
      <button v-if="flow.id !== 'pct-reminder'" type="button" class="sea-remove" @click="removeFlow(flow)">拿掉</button>
    </article>
    <button type="button" class="sea-card sea-add" @click="openOcean">
      <b>从知识海洋加一条</b>
      <small>把会做的事挑出来，按你点的顺序排好。</small>
    </button>
  </section>

  <section v-else-if="screen === 'ocean'" class="card ocean">
    <button type="button" class="flow-text" @click="screen = 'sea'">回到海边</button>
    <p class="hint">现在会自己跑起来的，仍是 PCT提醒。新加的会按你排的步骤保存下来。</p>
    <div class="skill-sea">
      <button
        v-for="skill in SKILLS"
        :key="skill.id"
        type="button"
        class="skill-bubble"
        :class="[skill.tint, { on: picked.includes(skill.id) }]"
        @click="toggleSkill(skill.id)"
      >
        <i v-if="picked.includes(skill.id)">{{ picked.indexOf(skill.id) + 1 }}</i>
        <b>{{ skill.title }}</b>
        <small>{{ skill.blurb }}</small>
      </button>
    </div>
    <label class="ocean-name">给这条起个名字
      <input v-model="newName" type="text" maxlength="40" placeholder="我的工作流" />
    </label>
    <div class="flow-actions">
      <button type="button" class="solid" :disabled="creating" @click="createFromOcean">{{ creating ? '正在放进去…' : '放进我的工作流' }}</button>
    </div>
    <p v-if="oceanNotice" class="hint">{{ oceanNotice }}</p>
  </section>

  <template v-else-if="draft">
    <div class="flow-board">
      <div class="mermaid">
        <template v-for="(step, index) in draft.steps" :key="step.id">
          <button type="button" class="flow-node" :class="[skillTint(step.skillId), { on: step.id === selectedId }]" @click="selectedId = step.id">
            <span>{{ index + 1 }}</span>
            <b>{{ step.title }}</b>
            <small>{{ skillTitle(step) }}</small>
          </button>
          <div v-if="index < draft.steps.length - 1" class="flow-link" aria-hidden="true">♥</div>
        </template>
        <p v-if="draft.steps.length === 0" class="hint">还没有步骤。在右边挑一件事加上。</p>
      </div>
      <section class="card flow-editor">
        <template v-if="selected">
          <h2>{{ selected.title }}</h2>
          <label>这一步叫什么 <input v-model="selected.title" type="text" maxlength="40" /></label>
          <label>它做什么 <textarea v-model="selected.detail" maxlength="800" /></label>
          <p v-if="stepHasChoice && choiceNotice" class="hint">{{ choiceNotice }}</p>
          <button v-if="stepHasChoice" type="button" class="flow-text" @click="loadChoices(true)">重新读取名单</button>
          <div v-for="param in visibleParams" :key="param.id" class="flow-param">
            <input v-model="param.label" type="text" maxlength="40" aria-label="叫什么" placeholder="叫什么" />
            <div class="flow-value">
              <template v-if="isMailTypeParam(param.id)">
                <MailTypeTreeSelect
                  :model-value="shownTypeId(param)"
                  :options="treeOptionsFor(param)"
                  :disabled="mailTypes.length === 0"
                  placeholder="点一种发文类型"
                  @update:model-value="chooseChoice(param, String($event))"
                />
              </template>
              <MailTypeTreeSelect
                v-else-if="param.id === 'proc_label'"
                :model-value="procTreeFor(param).selectedId"
                :options="procTreeFor(param).options"
                :disabled="procs.length === 0"
                leaves-only
                placeholder="从事项里点一个具体的"
                empty-text="没有匹配的事项。"
                search-label="搜索事项"
                @update:model-value="chooseProc(param, String($event))"
              />
              <ThemeSelect
                v-else-if="isStyleLabelParam(param.id)"
                :model-value="shownStyle(param)"
                :options="styleOptionsFor(param)"
                placeholder="点一种发文方式"
                empty-text="发文方式还没读到。"
                @update:model-value="chooseStyle(param, String($event))"
              />
              <ThemeSelect
                v-else-if="param.id === 'review_label'"
                :model-value="shownReviewer()"
                :options="reviewerOptions()"
                placeholder="点一个审核人"
                empty-text="审核人还没读到。点上面重新读取。"
                @update:model-value="chooseReviewer(param, String($event))"
              />
              <ThemeSelect
                v-else-if="isListedChoice(param.id)"
                :model-value="param.value"
                :options="optionsFor(param)"
                placeholder="点一个"
                empty-text="还没有可点的项。"
                @update:model-value="param.id === 'surface_label' ? param.value = String($event) : chooseChoice(param, String($event))"
              />
              <input v-if="showsText(param.id)" v-model="param.value" type="text" maxlength="200" aria-label="写成" placeholder="写成" />
              <button v-if="isExtraParam(param.id)" type="button" class="flow-text" @click="removeNote(selected, param.id)">拿掉</button>
            </div>
            <input v-model="param.help" class="help" type="text" maxlength="400" aria-label="说明" placeholder="给看的人一句说明" />
            <p v-if="paramWarning(param)" class="hint warn">{{ paramWarning(param) }}</p>
          </div>
          <div class="flow-actions">
            <button type="button" class="ghost" :disabled="draft.steps[0]?.id === selected.id" @click="moveStep(selected.id, -1)">上移</button>
            <button type="button" class="ghost" :disabled="draft.steps[draft.steps.length - 1]?.id === selected.id" @click="moveStep(selected.id, 1)">下移</button>
            <button v-if="!isBuiltinStep(selected.id)" type="button" class="ghost" @click="removeStep(selected.id)">拿掉这一步</button>
            <button type="button" class="flow-text" @click="addNote(selected)">再记一笔</button>
          </div>
        </template>
        <h3>再加一件会做的事</h3>
        <div class="skill-sea slim">
          <button v-for="skill in SKILLS" :key="skill.id" type="button" class="skill-bubble" :class="skill.tint" :disabled="draft.steps.length >= 16" @click="addSkillStep(skill.id)">
            <b>{{ skill.title }}</b>
            <small>{{ skill.blurb }}</small>
          </button>
        </div>
        <div class="flow-actions">
          <button v-if="draft.id === 'pct-reminder'" type="button" class="ghost" @click="resetPct">恢复最初的样子</button>
          <button type="button" class="solid" :disabled="saving" @click="save">{{ saving ? '正在保存…' : '保存' }}</button>
          <span v-if="dirty" class="hint">还有没保存的修改。</span>
        </div>
        <p v-if="notice" class="hint">{{ notice }}</p>
      </section>
    </div>
  </template>
</template>
