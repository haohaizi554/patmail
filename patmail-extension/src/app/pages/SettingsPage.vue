<script setup lang="ts">
import { ref } from 'vue'
import PageHead from '../../../../src/components/PageHead.vue'
import ThemeSelect from '../../../../src/components/ThemeSelect.vue'
import { bg } from '../../../../src/assets'
import { AVATAR_PRESET_IDS, presetAvatarUrl } from '../../settings/avatar'
import { useAccountAvatar } from '../../settings/use-account-avatar'
import { confirmDialog } from '../dialog'
import { useMailConcurrency } from '../../settings/use-mail-concurrency'
import { useWriteSwitch } from '../../settings/use-write-switch'
import { useWorkspace } from '../composables/useWorkspace'

const { connection } = useWorkspace()
const { open, ready, setOpen } = useWriteSwitch()
const { concurrency, ready: concurrencyReady, setConcurrency } = useMailConcurrency()
const { src, presetId, uploadId, uploads, custom, note, signedIn, choosePreset, chooseUpload, upload, removeUpload, clear, openZoom } = useAccountAvatar()
const file = ref<HTMLInputElement | null>(null)
const presets = AVATAR_PRESET_IDS.map(id => ({ id, src: presetAvatarUrl(id) }))
const concurrencyOptions = [1, 2, 3, 4].map(count => ({ value: count, label: String(count) }))

function onToggle(event: Event): void {
  void setOpen((event.target as HTMLInputElement).checked)
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0]
  input.value = ''
  if (!picked) return
  try {
    await upload(picked)
  } catch (error) {
    note.value = error instanceof Error ? error.message : '头像没有保存。'
  }
}

async function onRemove(id: string): Promise<void> {
  const ok = await confirmDialog({
    title: '删除上传的头像',
    message: '删掉之后不能再选用这张。系统预存的头像不会被删。',
    confirmLabel: '删除'
  })
  if (!ok) return
  await removeUpload(id)
}

async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    note.value = error instanceof Error ? error.message : '头像没有保存。'
  }
}
</script>

<template>
  <PageHead title="系统设置" desc="头像和写开关都在这里。" :art="bg('今天也要高效发文.png')" />
  <section class="card avatar-panel">
    <h2>头像</h2>
    <p class="hint">还没单独设过头像时，用这台浏览器从 20 张里抽到的一张。上传的图片会按画面自动居中裁成正方形，留在这台浏览器里，出现在下面，之后还能再选。单击选用，双击放大。上传的可以删，系统预存的 20 张不能删。</p>
    <div class="avatar-current">
      <button type="button" class="avatar-zoom-open" :disabled="!src" aria-label="放大头像" @click="openZoom()">
        <img v-if="src" class="avatar-face" :src="src" alt="" />
      </button>
      <div class="avatar-actions">
        <button type="button" class="primary" :disabled="!signedIn" @click="file?.click()">上传图片</button>
        <button type="button" :disabled="!signedIn || !uploadId" @click="run(() => onRemove(uploadId))">删除</button>
        <button type="button" :disabled="!signedIn || !custom" @click="run(clear)">恢复默认</button>
        <input ref="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden @change="onFile" />
        <p>{{ signedIn ? (note || '可以从下面挑一张，也可以上传自己的图片。当前是上传的图时，可以点「删除」。双击任意一张可以放大。') : '先连上 EASY 并确认登录人，才能换成这个账号自己的头像。双击下面的头像仍可以放大。' }}</p>
      </div>
    </div>
    <div class="avatar-grid">
      <div v-for="item in uploads" :key="item.id" class="upload-slot">
        <button type="button" class="uploaded" :class="{ on: uploadId === item.id }" :aria-label="`上传的头像 ${item.id}`" @click="signedIn && run(() => chooseUpload(item.id))" @dblclick.stop="openZoom(item.image)">
          <img :src="item.image" alt="" />
        </button>
        <button type="button" class="upload-remove" :disabled="!signedIn" aria-label="删除这张上传的头像" @click.stop="run(() => onRemove(item.id))" @dblclick.stop>×</button>
      </div>
      <button v-for="(item, index) in presets" :key="item.id" type="button" :class="{ on: presetId === item.id }" :aria-label="`头像 ${index + 1}`" @click="signedIn && run(() => choosePreset(item.id))" @dblclick.stop="openZoom(item.src)">
        <img :src="item.src" alt="" />
      </button>
    </div>
  </section>
  <section class="card">
    <h2>发文写入</h2>
    <p class="hint">站点 {{ connection.easyOrigin }}</p>
    <p class="hint">会话 {{ connection.sessionStatus }} · 标签页 {{ connection.easyTabId ?? '未绑定' }}</p>
    <form class="stack-form" @submit.prevent>
      <label>
        <input type="checkbox" :checked="open" @change="onToggle" />
        写开关
      </label>
      <p v-if="!ready" class="hint">正在读取写开关。</p>
      <p v-else-if="open" class="hint">已打开。可以写回查询模板。创建邮件、保存草稿和流程提交还要等响应核对完，现在仍不会发出。</p>
      <p v-else class="hint">已关闭。不会写回查询模板，也不会创建邮件、保存草稿或提交流程。</p>
      <label>并发数
        <ThemeSelect :model-value="concurrency" :disabled="!concurrencyReady" :options="concurrencyOptions" @update:model-value="setConcurrency(Number($event))" />
      </label>
      <p class="hint">PCT 提醒、鹏城专案和复制出来的工作流，发文时都按这个数同时提交。一封里面仍是先创建，再写收件人，再提交。选 1 封时，上一封有结果再发下一封。有一封结果没确认时，还没开始的不再开始。已经开始的会做完。</p>
    </form>
  </section>
</template>
