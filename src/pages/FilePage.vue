<script setup>
import { computed, inject, ref } from 'vue'
import PageHead from '../components/PageHead.vue'
import { bg, icon } from '../assets'
import { customers, files } from '../data'

const ui = inject('ui')
const picked = ref(files[0])
const rows = computed(() => files.filter((f) => !ui.search.value || f.name.includes(ui.search.value) || f.customer.includes(ui.search.value) || f.desc.includes(ui.search.value)))
</script>

<template>
  <PageHead title="文件管理" desc="集中管理专利发文相关文件，安全、规范、高效。" :art="bg('让重复工作变简单.png')" />
  <div class="with-rail">
    <div class="col">
      <div class="metric-row">
        <article class="metric tone-pink"><img :src="icon(12)" alt="" /><div><b>文件总数</b><strong>1,326</strong><small class="up">↑ 较上月 +12%</small></div></article>
        <article class="metric tone-blue"><img :src="icon(23)" alt="" /><div><b>待处理</b><strong>168</strong><small class="down">↓ 较上月 -8%</small></div></article>
        <article class="metric tone-green"><img :src="icon(25)" alt="" /><div><b>已归档</b><strong>1,089</strong><small class="up">↑ 较上月 +15%</small></div></article>
        <article class="metric tone-orange"><img :src="icon(18)" alt="" /><div><b>异常文件</b><strong>69</strong><small class="down">↓ 较上月 -20%</small></div></article>
      </div>
      <section class="card">
        <div class="form-grid">
          <label>客户<select><option>请选择客户</option><option v-for="c in customers" :key="c.name">{{ c.name }}</option></select></label>
          <label>文件描述<input v-model="ui.search.value" placeholder="请输入文件描述关键词" /></label>
          <label>发文类型<select><option>全部类型</option><option>官方来文</option><option>客户发文</option><option>内部文件</option></select></label>
          <label>上传日期<span class="date-pair"><input placeholder="开始日期" /><i>～</i><input placeholder="结束日期" /></span></label>
          <label>状态<select><option>全部状态</option><option>已归档</option><option>待处理</option><option>异常</option></select></label>
          <div class="form-actions"><button class="ghost" @click="ui.search.value = ''">重置</button><button class="solid" @click="ui.notify('查询完成')">查询</button></div>
        </div>
      </section>
      <section class="card">
        <div class="toolbar">
          <button class="solid" @click="ui.open('上传文件')">＋ 上传文件</button>
          <button class="ghost" @click="ui.notify('已准备批量下载')">↓ 批量下载</button>
          <button class="ghost" @click="ui.notify('已准备批量归档')">批量归档</button>
          <button class="ghost" @click="ui.open(picked.name)">预览附件</button>
          <button class="ghost" @click="ui.notify('正在同步查询结果')">同步查询结果</button>
          <span>已选择 0 项</span>
          <button class="ghost">批量操作 ▾</button>
        </div>
        <table class="grid">
          <thead><tr><th></th><th>附件名称</th><th>客户名称</th><th>文件描述</th><th>发文类型</th><th>上传时间</th><th>状态</th><th>预览</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="f in rows" :key="f.name" @click="picked = f">
              <td><input type="checkbox" /></td>
              <td><i class="file" :class="f.ext">{{ f.ext === 'pdf' ? 'PDF' : f.ext === 'docx' ? 'W' : f.ext === 'xlsx' ? 'X' : 'P' }}</i>{{ f.name }}</td>
              <td>{{ f.customer }}</td>
              <td>{{ f.desc }}</td>
              <td><em class="tag" :class="f.type">{{ f.type }}</em></td>
              <td>{{ f.time }}</td>
              <td><em class="status" :class="f.status">● {{ f.status }}</em></td>
              <td><button @click.stop="ui.open(f.name)">◎</button></td>
              <td><button @click.stop="ui.open(f.name)">···</button></td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
    <aside class="rail">
      <section class="card preview">
        <div class="card-head"><h2><img :src="icon(13)" alt="" />文件预览</h2></div>
        <div class="sheet">
          <i class="file pdf big">PDF</i>
          <b>{{ picked.name }}</b>
          <small>{{ picked.size }}</small>
          <button class="solid" @click="ui.open(picked.name)">预览文件</button>
        </div>
        <p><span>客户名称</span>{{ picked.customer }}</p>
        <p><span>文件描述</span>{{ picked.desc }}</p>
        <p><span>发文类型</span>{{ picked.type }}</p>
        <p><span>上传时间</span>{{ picked.time }}</p>
        <p><span>文件大小</span>{{ picked.size }}</p>
      </section>
      <section class="card">
        <div class="card-head"><h2>最近上传的文件</h2><button class="linkish">查看更多 ›</button></div>
        <div class="mini" v-for="f in files.slice(0, 5)" :key="f.name">
          <i class="file" :class="f.ext">{{ f.ext === 'docx' ? 'W' : f.ext === 'xlsx' ? 'X' : 'PDF' }}</i>
          <span><b>{{ f.name }}</b><small>{{ f.customer.slice(0, 8) }} · 刚刚</small></span>
          <button @click="ui.open(f.name)">⋮</button>
        </div>
      </section>
      <img class="rail-art" :src="bg('发文前预览一次.png')" alt="好好管理每一份文件，让创新的路更顺畅" />
    </aside>
  </div>
</template>
