<script setup lang="ts">
import { computed } from 'vue'
import PageHead from '../../../../src/components/PageHead.vue'
import { bg } from '../../../../src/assets'
import FileSearchPanel from '../../floating/FileSearchPanel.vue'
import { useWorkspace } from '../composables/useWorkspace'

const { connection } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
</script>

<template>
  <PageHead title="文件管理" desc="集中管理专利发文相关文件，安全、规范、高效。" :art="bg('让重复工作变简单.png')" />
  <section v-if="!ready" class="card">
    <h2>文件查询</h2>
    <p class="empty">尚未连接 EASY。文件查询会通过已绑定的原网站标签页读取会话，不会使用本页地址。</p>
  </section>
  <FileSearchPanel v-else :page-origin="connection.easyOrigin" :show-session="false" />
</template>
