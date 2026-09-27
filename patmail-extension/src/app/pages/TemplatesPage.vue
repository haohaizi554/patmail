<script setup lang="ts">
import { computed, inject } from 'vue'
import PageHead from '../../../../src/components/PageHead.vue'
import { bg } from '../../../../src/assets'
import QueryTemplateSection from '../../floating/QueryTemplateSection.vue'
import type { MessageBridge } from '../../shared/message'
import { useWorkspace } from '../composables/useWorkspace'

const bridge = inject<MessageBridge>('bridge')
const { connection } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
</script>

<template>
  <PageHead title="文件查询模板" desc="文件管理页的查询条件。和期限监控不是同一张表。" :art="bg('发文前预览一次.png')" />
  <section v-if="!ready" class="card"><p class="empty">尚未确认 EASY 用户，不能读取查询模板。</p></section>
  <QueryTemplateSection v-else :bridge="bridge" :can-search="false" :user-id="connection.operatorId" :origin="connection.easyOrigin" mode="history" :page-size="20" />
</template>
