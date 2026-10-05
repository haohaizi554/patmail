<script setup lang="ts">
import { computed, reactive } from 'vue'
import { renderAgentMarkdown } from '../../agent/markdown'
import { splitAgentReply, thoughtLead } from '../../agent/loop'

const props = defineProps<{ content: string; copied: boolean }>()
const emit = defineEmits<{ copy: [text: string] }>()
const view = reactive({ open: false })
function toggleThought(): void {
  view.open = !view.open
}
const reply = computed(() => splitAgentReply(props.content))
const lead = computed(() => thoughtLead(reply.value.thought))
const answerHtml = computed(() => reply.value.answer ? renderAgentMarkdown(reply.value.answer) : '')
const thoughtHtml = computed(() => reply.value.thought ? renderAgentMarkdown(reply.value.thought) : '')
</script>

<template>
  <div class="agent-stack">
    <div v-if="reply.thought" class="think">
      <button type="button" class="think-bar" :aria-expanded="view.open" @click="toggleThought">
        <span class="think-chevron" :class="{ open: view.open }" aria-hidden="true"></span>
        <span class="think-label">已思考</span>
        <span v-if="!view.open && lead" class="think-lead">{{ lead }}</span>
      </button>
      <div v-if="view.open" class="think-body" v-html="thoughtHtml"></div>
    </div>
    <div v-if="answerHtml" class="agent-md" v-html="answerHtml"></div>
    <button v-if="answerHtml" type="button" class="agent-copy" @click="emit('copy', reply.answer)">{{ copied ? '已复制' : '复制' }}</button>
  </div>
</template>
