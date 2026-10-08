<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { downloadXlsxRows } from '../../../customer/xlsx-table'
import { mappingExportRows } from '../../../mail/rules/description-import'
import MailTypeTreeSelect from '../../../shell/components/MailTypeTreeSelect.vue'
import type { DescriptionMailTypeMapping } from '../../../mail/types'

const props = defineProps<{
  mappings: DescriptionMailTypeMapping[]
  mailTypes: Array<{ id: string; name: string; parentId: string }>
  notice: string
  importing?: boolean
}>()
const emit = defineEmits<{
  save: [mapping: { description: string; mailTypeId: string; mailTypeName: string }]
  remove: [id: string]
  reload: []
  import: [file: File]
}>()
const description = ref('')
const mailTypeId = ref('')

const treeOptions = computed(() => props.mailTypes.map(item => ({
  value: item.id,
  label: item.name,
  ...(item.parentId ? { parent: item.parentId } : {})
})))
const byId = computed(() => new Map(props.mailTypes.map(item => [item.id, item])))

function typePath(id: string, fallback: string): string {
  const names: string[] = []
  let current = id
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const node = byId.value.get(current)
    if (!node) break
    names.unshift(node.name)
    current = node.parentId
  }
  return names.length ? names.join(' / ') : fallback
}

function exportSheet(): void {
  downloadXlsxRows(mappingExportRows(props.mappings, props.mailTypes), '发文映射.xlsx', '发文映射')
}

function onFile(event: Event): void {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('import', file)
}

function submit(): void {
  const picked = byId.value.get(mailTypeId.value)
  emit('save', {
    description: description.value.trim(),
    mailTypeId: picked?.id ?? '',
    mailTypeName: picked?.name ?? ''
  })
}

watch(() => props.mappings, (rows) => {
  const text = description.value.trim()
  if (!text || !mailTypeId.value) return
  if (rows.some(item => (item.fileDescriptionText ?? '').trim() === text && item.mailTypeId === mailTypeId.value)) {
    description.value = ''
    mailTypeId.value = ''
  }
})
</script>

<template>
  <section class="card mapping-board">
    <div class="mapping-head">
      <h2>文件描述映射</h2>
      <div class="mapping-actions">
        <button type="button" class="text-button" @click="exportSheet">导出 Excel</button>
        <label class="text-button file-button">
          {{ importing ? '正在导入…' : '导入 Excel' }}
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :disabled="importing" aria-label="导入 Excel" @change="onFile" />
        </label>
        <button type="button" class="text-button" @click="emit('reload')">重新读取发文类型</button>
      </div>
    </div>
    <p class="hint">发文类型由文件描述或发文内容决定。一行对应一种，文件描述填来文上的说法，发文类型在树里点选。也可以导入 Excel：认「文件描述」和「发文类型」两列，相同的不会重复写入，已经有的不会改。导出的表就是这个格式，发文类型写成从根到叶子的路径。</p>
    <p v-if="notice" class="hint">{{ notice }}</p>
    <table class="mapping-table">
      <thead>
        <tr><th>文件描述</th><th>发文类型</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in mappings" :key="item.id">
          <td>{{ item.fileDescriptionText || item.fileDescriptionId }}</td>
          <td>
            <div class="type-cell">
              <span>{{ typePath(item.mailTypeId, item.mailTypeName) }}</span>
              <button type="button" class="mapping-remove" @click="emit('remove', item.id)">删除</button>
            </div>
          </td>
        </tr>
        <tr v-if="mappings.length === 0">
          <td colspan="2" class="mapping-empty">还没有映射。在下面这一行添加第一对。</td>
        </tr>
        <tr class="mapping-add">
          <td><input v-model="description" type="text" placeholder="来文上的文件描述" aria-label="文件描述" @keydown.enter.prevent="submit" /></td>
          <td>
            <div class="type-cell">
              <MailTypeTreeSelect v-model="mailTypeId" :options="treeOptions" :disabled="mailTypes.length === 0" />
              <button type="button" class="solid" @click="submit">添加</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
