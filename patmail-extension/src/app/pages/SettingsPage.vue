<script setup lang="ts">
import PageHead from '../../../../src/components/PageHead.vue'
import { bg } from '../../../../src/assets'
import { useWriteSwitch } from '../../settings/use-write-switch'
import { useWorkspace } from '../composables/useWorkspace'

const { connection } = useWorkspace()
const { open, setOpen } = useWriteSwitch()

function onToggle(event: Event): void {
  void setOpen((event.target as HTMLInputElement).checked)
}
</script>

<template>
  <PageHead title="系统设置" desc="写开关在这里，默认打开。" :art="bg('今天也要高效发文.png')" />
  <section class="card">
    <h2>系统设置</h2>
    <p class="hint">站点 {{ connection.easyOrigin }}</p>
    <p class="hint">会话 {{ connection.sessionStatus }} · 标签页 {{ connection.easyTabId ?? '未绑定' }}</p>
    <form class="stack-form" @submit.prevent>
      <label>
        <input type="checkbox" :checked="open" @change="onToggle" />
        写开关
      </label>
      <p class="hint">{{ open ? '已打开。写开关不再拦截创建、保存和流程提交。' : '已关闭。不会创建邮件、保存草稿或提交流程。' }}</p>
    </form>
  </section>
</template>
