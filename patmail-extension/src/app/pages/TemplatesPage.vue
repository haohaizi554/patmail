<script setup lang="ts">
import { computed, inject } from 'vue'
import PageHead from '../../../../src/components/PageHead.vue'
import { bg } from '../../../../src/assets'
import QueryTemplateSection from '../../floating/QueryTemplateSection.vue'
import type { MessageBridge } from '../../shared/message'
import { useWorkspace } from '../composables/useWorkspace'

const bridge = inject<MessageBridge>('bridge')
const { connection, templates } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
</script>

<template>
  <PageHead title="查询模板" desc="把常用查询条件留下来，下次直接套用。" :art="bg('发文前预览一次.png')" />
  <section v-if="!ready" class="card"><p class="empty">尚未确认 EASY 用户，不能读取查询模板。</p></section>
  <template v-else>
    <section class="card">
      <h2>已保存模板</h2>
      <p v-if="templates.length === 0" class="empty">暂无查询模板</p>
      <table v-else class="grid">
        <thead><tr><th>名称</th><th>来源</th><th>版本</th></tr></thead>
        <tbody>
          <tr v-for="item in templates" :key="item.id"><td>{{ item.name }}</td><td>{{ item.source }}</td><td>{{ item.version }}</td></tr>
        </tbody>
      </table>
    </section>
    <QueryTemplateSection :bridge="bridge" :can-search="false" :user-id="connection.operatorId" :origin="connection.easyOrigin" mode="history" :page-size="20" />
  </template>
</template>
