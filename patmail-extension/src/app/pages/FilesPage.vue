<script setup lang="ts">
import { computed } from 'vue'
import FileSearchPanel from '../../floating/FileSearchPanel.vue'
import { useWorkspace } from '../composables/useWorkspace'

const { connection } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
</script>

<template>
  <section v-if="!ready" class="pm-card">
    <h2>文件查询</h2>
    <p class="empty">尚未连接 EASY。文件查询会通过已绑定的原网站标签页读取会话，不会使用本页地址。</p>
  </section>
  <FileSearchPanel v-else :page-origin="connection.easyOrigin" />
</template>
