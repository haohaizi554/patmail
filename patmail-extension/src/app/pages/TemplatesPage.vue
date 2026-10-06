<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import PageHead from '../../shell/components/PageHead.vue'
import { bg } from '../../shell/assets'
import QueryTemplateSection from '../../floating/QueryTemplateSection.vue'
import LimitQuerySection from '../../floating/LimitQuerySection.vue'
import type { MessageBridge } from '../../shared/message'
import { useWorkspace } from '../composables/useWorkspace'

const bridge = inject<MessageBridge>('bridge')
const { connection } = useWorkspace()
const ready = computed(() => connection.value.sessionStatus === 'authenticated')
const surface = ref<'file' | 'limit'>('file')
</script>

<template>
  <PageHead title="查询模板" desc="文件管理和期限监控各用各的模板，条件不能混用。" :art="bg('发文前预览一次.png')" />
  <section v-if="!ready" class="card"><p class="empty">尚未确认 EASY 用户，不能读取查询模板。</p></section>
  <template v-else>
    <section class="card template-switch">
      <div class="inline-actions">
        <button type="button" :class="surface === 'file' ? 'solid' : 'ghost'" @click="surface = 'file'">文件管理</button>
        <button type="button" :class="surface === 'limit' ? 'solid' : 'ghost'" @click="surface = 'limit'">期限监控</button>
      </div>
      <p class="hint">{{ surface === 'file' ? '文件管理的模板。点上面的名字套用，改完可以存到本机和原网站。' : '期限监控的模板。点上面的名字套用，改完保存到原网站。' }}</p>
    </section>
    <QueryTemplateSection v-if="surface === 'file'" :bridge="bridge" :can-search="false" :user-id="connection.operatorId" :origin="connection.easyOrigin" mode="history" :page-size="20" />
    <LimitQuerySection v-else :bridge="bridge" :user-id="connection.operatorId" :can-search="false" />
  </template>
</template>
