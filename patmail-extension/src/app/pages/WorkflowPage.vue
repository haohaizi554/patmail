<script setup lang="ts">
import { WORKFLOW_WRITES_ENABLED } from '../../workflow/gate'
</script>

<template>
  <section class="pm-card">
    <h2>工作流</h2>
    <p class="hint">流程提交保持关闭。没有已核验的提交流程。</p>
    <p class="empty">暂无记录</p>
    <p class="hint">写开关：{{ WORKFLOW_WRITES_ENABLED ? '异常开启' : '关闭' }}</p>
  </section>
</template>
