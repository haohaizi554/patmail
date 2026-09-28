<script setup lang="ts">
import { computed, ref } from 'vue'
import PageHead from '../../../../src/components/PageHead.vue'
import { bg } from '../../../../src/assets'
import type { FileSearchQuery } from '../../api/file-search-params'
import { snapshotFromFileQuery } from '../../customer/mail-flow'
import FileSearchPanel from '../../floating/FileSearchPanel.vue'
import BindQueryBar from '../components/BindQueryBar.vue'
import { useWorkspace } from '../composables/useWorkspace'

const { connection } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const fields = ref<Record<string, string>>({})

function onSearched(query: FileSearchQuery): void {
  fields.value = snapshotFromFileQuery(query)
}
</script>

<template>
  <PageHead title="文件管理" desc="集中管理专利发文相关文件，安全、规范、高效。" :art="bg('让重复工作变简单.png')" />
  <section v-if="!ready" class="card">
    <h2>文件查询</h2>
    <p class="empty">尚未连接 EASY。文件查询会通过已绑定的原网站标签页读取会话，不会使用本页地址。</p>
  </section>
  <template v-else>
    <p class="hint">先套模板，再手工改条件。文件描述和发文类型是一对一，对照表在「发文规则与映射配置」，可以直接看，也可以随时改。</p>
    <BindQueryBar surface="file" :fields="fields" />
    <FileSearchPanel :page-origin="connection.easyOrigin" :show-session="false" @searched="onSearched" />
  </template>
</template>
