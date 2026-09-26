<script setup lang="ts">
import type { BodyRule } from '../../../mail/types'

const model = defineModel<BodyRule>({ required: true })
</script>

<template>
  <label>正文模板 <textarea v-model="model.template" rows="5"></textarea></label>
</template>
