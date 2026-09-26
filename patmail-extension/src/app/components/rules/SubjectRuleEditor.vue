<script setup lang="ts">
import type { SubjectRule } from '../../../mail/types'

const model = defineModel<SubjectRule>({ required: true })
</script>

<template>
  <label>标题模板 <textarea v-model="model.template" rows="3"></textarea></label>
</template>
