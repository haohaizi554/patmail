<script setup lang="ts">
import { EASY_MAIL_WRITES_ENABLED } from '../../mail/easy/gate'
import { productionWriteAllowed } from '../../automation/contract-capture'
import { WORKFLOW_WRITES_ENABLED } from '../../workflow/gate'
import { useWorkspace } from '../composables/useWorkspace'

const { connection } = useWorkspace()
</script>

<template>
  <section class="pm-card">
    <h2>系统设置</h2>
    <p class="hint">站点 {{ connection.easyOrigin }}</p>
    <p class="hint">会话 {{ connection.sessionStatus }} · 标签页 {{ connection.easyTabId ?? '未绑定' }}</p>
    <p class="hint">Dry-run：只生成本地计划。</p>
    <p class="hint">Live Readonly：只读验收，不写邮件。</p>
    <p class="hint">Test Write：测试白名单为空，不会发起写请求。</p>
    <p class="hint">Production Write：{{ productionWriteAllowed() || EASY_MAIL_WRITES_ENABLED || WORKFLOW_WRITES_ENABLED ? '状态异常' : '关闭' }}</p>
  </section>
</template>
