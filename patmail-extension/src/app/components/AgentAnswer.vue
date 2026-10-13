<script setup lang="ts">
import { computed, reactive } from 'vue'
import { renderAgentMarkdown } from '../../agent/markdown'
import { journalEntries, splitAgentReply, thoughtLead } from '../../agent/loop'

const props = defineProps<{ content: string; copied: boolean; startOpen?: boolean }>()
const emit = defineEmits<{ copy: [text: string] }>()
const view = reactive({ open: props.startOpen === true })
function toggleThought(): void {
  view.open = !view.open
}
const reply = computed(() => splitAgentReply(props.content))
const entries = computed(() => journalEntries(reply.value.thought))
const hasSteps = computed(() => entries.value.some(item => item.kind === 'step'))
const lead = computed(() => thoughtLead(reply.value.thought))
const thoughtTitle = computed(() => hasSteps.value ? '过程' : '已思考')
const answerHtml = computed(() => reply.value.answer ? renderAgentMarkdown(reply.value.answer) : '')
function thoughtHtml(text: string): string {
  return renderAgentMarkdown(text)
}
</script>

<template>
  <div class="agent-stack">
    <div v-if="reply.thought" class="think">
      <button type="button" class="think-bar" :aria-expanded="view.open" @click="toggleThought">
        <span class="think-chevron" :class="{ open: view.open }" aria-hidden="true"></span>
        <span class="think-label">{{ thoughtTitle }}</span>
        <span v-if="!view.open && lead" class="think-lead" v-hint.clip="lead">{{ lead }}</span>
      </button>
      <div v-if="view.open">
        <template v-for="(item, index) in entries" :key="index">
          <div v-if="item.kind === 'thought'" class="think-body" v-html="thoughtHtml(item.text)"></div>
          <p v-else class="think-step done">
            <span class="agent-step-mark" aria-hidden="true"></span>
            <span class="agent-step-label">{{ item.text }}</span>
            <span v-if="item.detail" class="agent-step-detail" v-hint.clip="item.detail">{{ item.detail }}</span>
          </p>
        </template>
      </div>
    </div>
    <div v-if="answerHtml" class="agent-bubble">
      <div class="agent-md" v-html="answerHtml"></div>
      <button type="button" class="agent-copy" :class="{ done: copied }" :aria-label="copied ? '已复制' : '复制回答'" @click="emit('copy', reply.answer)">
        <svg v-if="copied" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.4 6.3 11.5 12.8 4.6" /></svg>
        <svg v-else viewBox="0 0 16 16" aria-hidden="true"><rect x="5.2" y="5.2" width="8" height="8" rx="1.4" /><path d="M10.6 5.1V3.6A1.4 1.4 0 0 0 9.2 2.2H3.6A1.4 1.4 0 0 0 2.2 3.6v5.6A1.4 1.4 0 0 0 3.6 10.6H5" /></svg>
        <span>{{ copied ? '已复制' : '复制' }}</span>
      </button>
    </div>
  </div>
</template>
